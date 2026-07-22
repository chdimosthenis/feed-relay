/**
 * tokastoraki publisher relay.
 *
 * Two different problems land here, and both are about WHERE the request
 * comes from rather than what it asks for.
 *
 * The first is the IP-range block: Contra, News247, Sport24 and a handful
 * of others answer 200 from generic datacenter egress (GitHub Actions runs
 * on Azure) while 403-ing Cloudflare's ranges specifically, which is where
 * the tokastoraki fetcher Worker lives. The second, added 2026-07-22, is a
 * budget ceiling: Google News starts 503-ing Cloudflare's shared egress
 * once the whole roster crosses roughly 110 requests an hour, so the
 * aggregator queries move here and stop competing for it.
 *
 * Either way this script fetches each publisher's PUBLIC surface and
 * relays the raw payload to the fetcher's POST /ingest-external endpoint,
 * which parses it with the existing mappers and inserts through the normal
 * ingest loop, so a relayed article is indistinguishable from a directly
 * fetched one.
 *
 * targets.json is GENERATED from the app repository's config/feeds.ts by
 * scripts/build-relay-targets.ts — never hand-edit it, or the two halves of
 * the allowlist drift and the fetcher starts rejecting perfectly good
 * payloads with a 403.
 *
 * No dependencies; runs on the runner's Node 20+ (global fetch).
 * Secrets: FETCHER_URL + FETCHER_SECRET (repo Actions secrets).
 */
import { readFileSync } from "node:fs";

const FETCHER_URL = process.env.FETCHER_URL;
const FETCHER_SECRET = process.env.FETCHER_SECRET;

const TARGETS = JSON.parse(
  readFileSync(new URL("./targets.json", import.meta.url), "utf8"),
);

/** How many publishers are in flight at once. Small on purpose: the run has
 * half an hour of headroom, and a burst of seventy simultaneous requests is
 * exactly the shape that gets an egress range rate-limited — the problem
 * this relay exists to solve. */
const CONCURRENCY = 6;

/** Per-request ceiling. Publishers that are slow rather than blocked used
 * to eat the Worker's whole fetch budget; here a straggler costs only its
 * own slot. */
const FETCH_TIMEOUT_MS = 20_000;

// The fetcher's guard is 2 MiB. Truncate oversized HTML (cheerio parses a
// truncated homepage fine — the top cards survive); never truncate JSON,
// and never truncate XML (a half-closed document parses to nothing).
const MAX_PAYLOAD = 1_900_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Accept-Language": "el-GR,el;q=0.9,en;q=0.8",
};

const ACCEPT = {
  wpjson: "application/json, text/plain, */*",
  html: "text/html,*/*",
  rss: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
  sitemap: "application/xml, text/xml;q=0.9, */*;q=0.8",
};

async function fetchPayload(t) {
  const res = await fetch(t.url, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: ACCEPT[t.kind] ?? "*/*",
      Referer: t.referer,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // A single 503 from an aggregator is usually a momentary rate-limit
  // rather than a wall; one cheap retry recovers most of them.
  if (res.status === 503) {
    await new Promise((r) => setTimeout(r, 3000));
    return fetchPayload({ ...t, _retried: true });
  }
  if (!res.ok) throw new Error(`publisher HTTP ${res.status}`);
  const payload = await res.text();
  if (payload.length > MAX_PAYLOAD) {
    if (t.kind === "html") return payload.slice(0, MAX_PAYLOAD);
    throw new Error(`payload too large (${payload.length} bytes)`);
  }
  return payload;
}

async function relayOne(t) {
  const payload = await fetchPayload(t);
  const post = await fetch(`${FETCHER_URL}/ingest-external`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FETCHER_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: t.source, kind: t.kind, payload }),
    signal: AbortSignal.timeout(30_000),
  });
  const bodyText = (await post.text()).trim();
  if (!post.ok) throw new Error(`fetcher HTTP ${post.status}: ${bodyText}`);
  return payload.length;
}

if (!FETCHER_URL || !FETCHER_SECRET) {
  console.error("FETCHER_URL / FETCHER_SECRET not configured");
  process.exit(1);
}

let ok = 0;
let failures = 0;
const queue = [...TARGETS];

async function worker() {
  for (;;) {
    const t = queue.shift();
    if (!t) return;
    try {
      const bytes = await relayOne(t);
      ok++;
      console.log(`✓ ${t.source} (${t.kind}): relayed ${bytes} bytes`);
    } catch (e) {
      failures++;
      console.error(`✗ ${t.source} (${t.kind}): ${e.message}`);
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, TARGETS.length) }, worker),
);

console.log(`\n${ok} relayed · ${failures} failed · ${TARGETS.length} targets`);
// Red run only when NOTHING got through — individual publisher hiccups are
// routine at this roster size and self-heal on the next half-hour fire.
if (ok === 0) process.exit(1);
