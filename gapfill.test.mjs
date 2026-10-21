import { test } from "node:test";
import assert from "node:assert/strict";
import { sameSite, summarize, cutToWindow, indexLocs } from "./gapfill.mjs";

test("sameSite: same host with or without www passes, another host fails", () => {
  assert.equal(sameSite("https://www.orthodoxtimes.gr/feed/?paged=2", "https://www.orthodoxtimes.gr"), true);
  assert.equal(sameSite("https://orthodoxtimes.gr/feed/", "https://www.orthodoxtimes.gr"), true);
  assert.equal(sameSite("https://evil.example/feed/", "https://www.orthodoxtimes.gr"), false);
  assert.equal(sameSite("not a url", "https://www.orthodoxtimes.gr"), false);
});

test("summarize: counts items and reports the first and last pubDate", () => {
  const xml = "<rss><channel><item><pubDate>A</pubDate></item><item><pubDate>B</pubDate></item></channel></rss>";
  assert.deepEqual(summarize(xml), { items: 2, first: "A", last: "B" });
  assert.deepEqual(summarize("<rss></rss>"), { items: 0, first: null, last: null });
});

test("summarize sitemap: counts <url> and reads news:publication_date, else lastmod", () => {
  const xml = "<urlset><url><loc>a</loc><news:news><news:publication_date>2026-10-21T13:00:00Z</news:publication_date></news:news></url><url><loc>b</loc><lastmod>2026-10-21T14:00:00Z</lastmod></url></urlset>";
  assert.deepEqual(summarize(xml, "sitemap"), { items: 2, first: "2026-10-21T13:00:00Z", last: "2026-10-21T14:00:00Z" });
});

test("cutToWindow: keeps [from, to), drops undated entries, no window = untouched", () => {
  const u = (d, l) => `<url><loc>${l}</loc>${d ? `<news:publication_date>${d}</news:publication_date>` : ""}</url>`;
  const xml = `<urlset>${u("2026-10-21T12:40:00Z", "early")}${u("2026-10-21T13:10:00+00:00", "in")}${u("2026-10-21T15:00:00Z", "edge")}${u(null, "nodate")}</urlset>`;
  const cut = cutToWindow(xml, "sitemap", "2026-10-21T12:45:00Z", "2026-10-21T15:00:00Z");
  assert.equal(summarize(cut, "sitemap").items, 1);
  assert.match(cut, /<loc>in<\/loc>/);
  assert.equal(cutToWindow(xml, "sitemap", "", ""), xml);
  const rss = "<rss><item><pubDate>Wed, 21 Oct 2026 13:30:00 GMT</pubDate></item><item><pubDate>Wed, 21 Oct 2026 16:30:00 GMT</pubDate></item></rss>";
  assert.equal(summarize(cutToWindow(rss, "rss", "2026-10-21T13:00:00Z", "2026-10-21T15:00:00Z")).items, 1);
  assert.throws(() => cutToWindow(xml, "sitemap", "nonsense", ""));
});

test("indexLocs: children of a sitemapindex, nothing for a urlset", () => {
  assert.deepEqual(indexLocs("<sitemapindex><sitemap><loc> https://x/a.xml </loc></sitemap><sitemap><loc>https://x/b.xml</loc></sitemap></sitemapindex>"), ["https://x/a.xml", "https://x/b.xml"]);
  assert.deepEqual(indexLocs("<urlset><url><loc>https://x/1</loc></url></urlset>"), []);
});
