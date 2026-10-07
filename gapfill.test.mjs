import { test } from "node:test";
import assert from "node:assert/strict";
import { sameSite, summarize } from "./gapfill.mjs";

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
