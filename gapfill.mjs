/**
 * ONE PAGE, ONE SOURCE: fetch a single publisher URL from a GitHub runner and
 * hand it to the fetcher's /ingest-external, exactly as relay.mjs does for a
 * relayed source. Used to fill a gap that opened while the cron fetcher was
 * refused (the publisher's feed only keeps its newest 10-25 items, so the older
 * ones are on /feed/?paged=2, ?paged=3 ...).
 *
 * It does NOT decide what is new: the fetcher's insertArticle dedups by URL and
 * title, so re-sending a page it already has inserts nothing. It does not touch
 * targets.json and does not run on a schedule; it only runs when dispatched.
 *
 * Guard: the URL must be on the same site as the referer, so a dispatch cannot
 * be turned into "post any URL's bytes as source X".
 *
 * Env: FETCHER_URL, FETCHER_SECRET (repo Actions secrets), SOURCE, URL, REFERER,
 * KIND (rss only).
 */
import { pathToFileURL } from "node:url";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Accept-Language": "el-GR,el;q=0.9,en;q=0.8",
  Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
};
const MAX_PAYLOAD = 1_900_000;

/** Same registrable site, ignoring a leading "www.". */
export function sameSite(url, referer) {
  const bare = (h) => h.replace(/^www\./, "").toLowerCase();
  try {
    return bare(new URL(url).hostname) === bare(new URL(referer).hostname);
  } catch {
    return false;
  }
}

export function summarize(xml) {
  const items = (xml.match(/<item[\s>]/g) ?? []).length;
  const dates = [...xml.matchAll(/<pubDate>([^<]*)<\/pubDate>/g)].map((m) => m[1]);
  return { items, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };
}

async function main() {
  const { FETCHER_URL, FETCHER_SECRET, SOURCE, URL: url, REFERER, KIND = "rss" } = process.env;
  if (!FETCHER_URL || !FETCHER_SECRET) throw new Error("FETCHER_URL / FETCHER_SECRET not configured");
  if (!SOURCE || !url || !REFERER) throw new Error("SOURCE, URL and REFERER are required");
  if (KIND !== "rss") throw new Error(`kind ${KIND} not supported (rss only)`);
  if (!sameSite(url, REFERER)) throw new Error(`url and referer are not the same site: ${url} / ${REFERER}`);
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, Referer: REFERER },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  const payload = await res.text();
  console.log(`GET ${url} -> HTTP ${res.status}, ${payload.length} chars`);
  if (!res.ok) throw new Error(`publisher HTTP ${res.status}: ${payload.slice(0, 120)}`);
  if (payload.length > MAX_PAYLOAD) throw new Error(`payload ${payload.length} > ${MAX_PAYLOAD}`);
  const s = summarize(payload);
  console.log(`items ${s.items} · first pubDate ${s.first} · last pubDate ${s.last}`);
  if (s.items === 0) throw new Error("no <item> in the page, nothing to hand over");
  const post = await fetch(`${FETCHER_URL}/ingest-external`, {
    method: "POST",
    headers: { Authorization: `Bearer ${FETCHER_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source: SOURCE, kind: KIND, payload, viaFallback: false, refusalStatus: null, refusalMessage: null }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await post.text()).trim();
  console.log(`POST /ingest-external -> HTTP ${post.status}: ${body.slice(0, 500)}`);
  if (!post.ok) throw new Error(`fetcher HTTP ${post.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(String(e.message ?? e).slice(0, 400));
    process.exit(1);
  });
}
