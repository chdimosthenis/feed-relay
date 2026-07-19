/**
 * tokastoraki publisher relay (2026-07-19).
 *
 * The egress probe (chdimosthenis/tokastoraki-egress-probe) proved that
 * Contra, News247 and Sport24 answer 200 from generic datacenter egress
 * (GitHub Actions = Azure) while 403-ing Cloudflare's IP ranges, which is
 * where the tokastoraki fetcher Worker lives. This script fetches each
 * publisher's PUBLIC surface — the same wp-json query / homepage the
 * fetcher's Browser-Rendering lane used to fetch — and relays the raw
 * payload to the fetcher's POST /ingest-external endpoint, which parses it
 * with its existing mappers and inserts through the normal ingest loop.
 *
 * No dependencies; runs on the runner's Node 20+ (global fetch).
 * Secrets: FETCHER_URL + FETCHER_SECRET (repo Actions secrets).
 */

const FETCHER_URL = process.env.FETCHER_URL;
const FETCHER_SECRET = process.env.FETCHER_SECRET;

// Mirrors lib/scrapers/wp.ts::fetchWpPosts — same per_page, same _fields,
// so the fetcher-side mapper sees an identical payload shape.
const WP_QUERY =
  "/wp-json/wp/v2/posts?per_page=20&_embed=wp:featuredmedia" +
  "&_fields=id,date,date_gmt,title,link,excerpt,content,_embedded";

const TARGETS = [
  {
    source: "Contra",
    kind: "wpjson",
    url: `https://www.contra.gr${WP_QUERY}`,
    referer: "https://www.contra.gr",
  },
  {
    source: "News247",
    kind: "wpjson",
    url: `https://www.news247.gr${WP_QUERY}`,
    referer: "https://www.news247.gr",
  },
  {
    source: "Sport24",
    kind: "html",
    url: "https://www.sport24.gr/",
    referer: "https://www.sport24.gr",
  },
];

// The fetcher's guard is 2 MiB. Truncate oversized HTML (cheerio parses a
// truncated homepage fine — the top cards survive); never truncate JSON.
const MAX_PAYLOAD = 1_900_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Accept-Language": "el-GR,el;q=0.9,en;q=0.8",
};

async function relayOne(t) {
  const res = await fetch(t.url, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: t.kind === "wpjson" ? "application/json, text/plain, */*" : "text/html,*/*",
      Referer: t.referer,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`publisher HTTP ${res.status}`);
  let payload = await res.text();
  if (payload.length > MAX_PAYLOAD) {
    if (t.kind === "html") {
      payload = payload.slice(0, MAX_PAYLOAD);
    } else {
      throw new Error(`wpjson payload too large (${payload.length} bytes)`);
    }
  }
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
  console.log(
    `✓ ${t.source}: relayed ${payload.length} bytes → ${post.status} ${bodyText}`,
  );
}

if (!FETCHER_URL || !FETCHER_SECRET) {
  console.error("FETCHER_URL / FETCHER_SECRET not configured");
  process.exit(1);
}

let failures = 0;
for (const t of TARGETS) {
  try {
    await relayOne(t);
  } catch (e) {
    failures++;
    console.error(`✗ ${t.source}: ${e.message}`);
  }
}
// Red run only when NOTHING got through — a single publisher hiccup is
// routine and self-heals on the next half-hour fire.
if (failures === TARGETS.length) process.exit(1);
