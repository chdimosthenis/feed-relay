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
 * KIND (rss | sitemap), FROM / TO (optional ISO window), DRY ("1" = report only).
 *
 * KIND sitemap is for a publisher whose feed has no older pages (SKAI, 21/10/2026):
 * its news sitemap holds the gap. The fetcher keeps only the newest 25 items of a
 * POST, so a whole 48-hour sitemap would hand over only what we already have.
 * FROM / TO cut the page to the gap BEFORE the POST; with no window the page goes
 * as it is. DRY prints what the page holds (and an index's child sitemaps) and
 * posts nothing, so the right URL and window are measured before any write.
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

const ENTRY = { rss: /<item[\s>][\s\S]*?<\/item>/g, sitemap: /<url[\s>][\s\S]*?<\/url>/g };
const DATE = {
  rss: /<pubDate>([^<]*)<\/pubDate>/,
  sitemap: /<news:publication_date>([^<]*)<\/news:publication_date>|<lastmod>([^<]*)<\/lastmod>/,
};

/** The date an entry carries (rss pubDate; sitemap news:publication_date, else lastmod). */
export function entryDate(entry, kind = "rss") {
  const m = entry.match(DATE[kind]);
  return m ? (m[1] ?? m[2] ?? "").trim() || null : null;
}

export function summarize(xml, kind = "rss") {
  const entries = xml.match(ENTRY[kind]) ?? [];
  const dates = entries.map((e) => entryDate(e, kind)).filter(Boolean);
  return { items: entries.length, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null };
}

/**
 * Keep only the entries dated inside [from, to). An entry with no readable date is
 * dropped when a window is set: a gap fill must not hand over what it cannot place.
 */
export function cutToWindow(xml, kind, from, to) {
  if (!from && !to) return xml;
  const lo = from ? Date.parse(from) : -Infinity;
  const hi = to ? Date.parse(to) : Infinity;
  if (Number.isNaN(lo) || Number.isNaN(hi)) throw new Error(`bad window ${from} / ${to}`);
  return xml.replace(ENTRY[kind], (e) => {
    const t = Date.parse(entryDate(e, kind) ?? "");
    return t >= lo && t < hi ? e : "";
  });
}

/** Child sitemaps of a <sitemapindex>, for the DRY report. */
export function indexLocs(xml) {
  if (!/<sitemapindex[\s>]/.test(xml)) return [];
  return [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]*)<\/loc>/g)].map((m) => m[1].trim());
}

async function main() {
  const { FETCHER_URL, FETCHER_SECRET, SOURCE, URL: url, REFERER, FROM, TO } = process.env;
  const KIND = process.env.KIND || "rss";
  const DRY = process.env.DRY === "1";
  if (!DRY && (!FETCHER_URL || !FETCHER_SECRET)) throw new Error("FETCHER_URL / FETCHER_SECRET not configured");
  if (!SOURCE || !url || !REFERER) throw new Error("SOURCE, URL and REFERER are required");
  if (!(KIND in ENTRY)) throw new Error(`kind ${KIND} not supported (rss | sitemap)`);
  if (!sameSite(url, REFERER)) throw new Error(`url and referer are not the same site: ${url} / ${REFERER}`);
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, Referer: REFERER },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  const page = await res.text();
  console.log(`GET ${url} -> HTTP ${res.status}, ${page.length} chars`);
  if (!res.ok) throw new Error(`publisher HTTP ${res.status}: ${page.slice(0, 120)}`);
  const whole = summarize(page, KIND);
  console.log(`page: ${KIND} entries ${whole.items} · first ${whole.first} · last ${whole.last}`);
  const children = indexLocs(page);
  if (children.length) console.log(`sitemap index, ${children.length} children:\n  ${children.slice(0, 30).join("\n  ")}`);
  const payload = cutToWindow(page, KIND, FROM, TO);
  const s = summarize(payload, KIND);
  console.log(`window ${FROM || "-"} → ${TO || "-"}: entries ${s.items} · first ${s.first} · last ${s.last}`);
  if (DRY) {
    for (const e of (payload.match(ENTRY[KIND]) ?? []).slice(0, 40)) {
      const loc = (e.match(/<loc>([^<]*)<\/loc>/) ?? e.match(/<link>([^<]*)<\/link>/) ?? [])[1] ?? "?";
      console.log(`  ${entryDate(e, KIND)}  ${loc.trim().slice(0, 140)}`);
    }
    console.log("DRY: nothing posted");
    return;
  }
  if (payload.length > MAX_PAYLOAD) throw new Error(`payload ${payload.length} > ${MAX_PAYLOAD}`);
  if (s.items === 0) throw new Error(`no ${KIND} entry in the page/window, nothing to hand over`);
  if (s.items > 25) throw new Error(`${s.items} entries > 25: the fetcher keeps only the newest 25 of a POST; narrow the window`);
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
