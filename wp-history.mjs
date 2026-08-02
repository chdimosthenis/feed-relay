/**
 * Walk the archives of publishers that refuse Cloudflare, from GitHub's
 * runners, and hand every page back to the walker Worker.
 *
 * WHY THIS EXISTS. Seven of the thirty-eight WordPress archives answer HTTP
 * 403 to Cloudflare while answering 200 from an ordinary connection — four of
 * them Greek government sites — and Chaniotika Nea serves a JS bot challenge to
 * the same egress. Between them that is over half a million posts we can see
 * and cannot fetch. It is not a property of the archive, it is a property of
 * where the request comes from, so the request moves and nothing else does.
 *
 * THIS SCRIPT IS DELIBERATELY STUPID. It asks the Worker which URL to read
 * next, reads it, and posts the bytes back. It does not know what a window is,
 * how pages become years, when a source is finished, or what a part file is
 * called. Every one of those decisions stays in workers/wp-walk, where it is
 * already written and already tested. A second copy of that logic living here,
 * in a different runtime on a different schedule, is exactly the thing that
 * would drift apart quietly.
 *
 * It is resumable by construction: the cursor lives in R2 on the Worker's side,
 * so a run that is cut off mid-archive loses at most the page it was reading,
 * and the next run continues from the same place.
 *
 * Env: WALK_URL, WALK_SECRET.
 */
const WALK_URL = process.env.WALK_URL;
const WALK_SECRET = process.env.WALK_SECRET;

/** Leave headroom under the workflow's own timeout so the summary still prints. */
const BUDGET_MS = 9 * 60 * 1000;
/** Politeness: one reader per origin, and a breath between pages. */
const PAGE_GAP_MS = 400;
const FETCH_TIMEOUT_MS = 30_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "el-GR,el;q=0.9,en;q=0.8",
};

if (!WALK_URL || !WALK_SECRET) {
  console.error("WALK_URL / WALK_SECRET not configured");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${WALK_SECRET}` };
const started = Date.now();
const left = () => BUDGET_MS - (Date.now() - started);

async function walkApi(path, init = {}) {
  const res = await fetch(`${WALK_URL}${path}`, {
    ...init,
    headers: { ...auth, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`walker HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function readPage(url) {
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, Referer: new URL(url).origin },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // 400 is WordPress saying there is no such page: the archive floor, which
  // the Worker recognises from an empty array.
  if (res.status === 400) return "[]";
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    const ray = res.headers.get("cf-ray") ?? "";
    const server = res.headers.get("server") ?? "";
    const body = buf.toString("utf8").replace(/\s+/g, " ").slice(0, 120);
    throw new Error(
      `publisher HTTP ${res.status}` +
        (server ? ` server=${server}` : "") +
        (ray ? ` cf-ray=${ray}` : "") +
        (body ? ` body=${body}` : ""),
    );
  }
  // Honour a byte-order mark. antenna.gr serves its feed as UTF-16LE under
  // `Content-Type: text/xml` with no charset, and reading that as UTF-8 finds
  // no <item> at all — 134,584 bytes delivered, a 200 recorded, zero rows
  // written, discovered the hard way on 2026-08-02. None of today's
  // relay-only archives are UTF-16, but the next one might be, and this is
  // the same check the Worker itself makes on the pages it fetches directly.
  const utf16 =
    (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff);
  return buf.toString(utf16 ? "utf16le" : "utf8");
}

const { domains } = await walkApi("/relay/domains");
if (domains.length === 0) {
  console.log("Nothing to relay: no source is blocked to the Worker.");
  process.exit(0);
}
console.log(`${domains.length} archive(s) to relay:`);
for (const d of domains) console.log(`  ${d.domain} (${d.posts} staged so far)`);

let staged = 0;
let pages = 0;
const finished = [];
const failed = [];

// Round-robin rather than one archive at a time, so a run that is cut short
// has advanced every source a little instead of one source a lot. The small
// archives finish and drop out on their own.
let queue = domains.map((d) => ({ ...d }));
while (queue.length > 0 && left() > 15_000) {
  const next = [];
  for (const d of queue) {
    if (left() < 15_000) {
      next.push(d);
      continue;
    }
    let payload;
    try {
      payload = await readPage(d.url);
    } catch (e) {
      console.log(`  x ${d.domain}: ${e.message}`);
      failed.push(d.domain);
      continue;
    }
    let result;
    try {
      result = await walkApi("/relay/page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d.domain, payload }),
      });
    } catch (e) {
      console.log(`  x ${d.domain}: handing back failed - ${e.message}`);
      failed.push(d.domain);
      continue;
    }
    staged += result.staged ?? 0;
    pages += 1;
    if (result.done) {
      console.log(`  = ${d.domain}: finished, ${result.posts} posts in total`);
      finished.push(d.domain);
      continue;
    }
    if (result.nextUrl) next.push({ ...d, url: result.nextUrl });
    await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
  }
  queue = next;
}

console.log(
  `\nRelayed ${pages} pages, ${staged} articles. ` +
    `${finished.length} archive(s) finished, ${failed.length} failing, ` +
    `${queue.length} still going (they resume next run).`,
);
if (failed.length) console.log(`Failing: ${[...new Set(failed)].join(", ")}`);
