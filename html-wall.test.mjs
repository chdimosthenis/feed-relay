// Τρέχει χωρίς καμία εξάρτηση:  node --test
// Καμία δικτυακή κλήση. Βλ. html-wall.mjs για το γιατί (YouWeekly, Anubis, 13/10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isHtmlWall } from "./html-wall.mjs";

const ANUBIS =
  '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <script id="anubis_version" type="application/json">"v1.26.2"</script>' +
  "</head><body><footer></footer></body></html>";

test("το τείχος Anubis σε στόχο rss πιάνεται", () => {
  assert.equal(isHtmlWall("rss", ANUBIS), true);
});
test("το ίδιο τείχος σε στόχο sitemap πιάνεται", () => {
  assert.equal(isHtmlWall("sitemap", ANUBIS), true);
});
test("το «Just a moment» της Cloudflare με 200 πιάνεται", () => {
  assert.equal(isHtmlWall("rss", "<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>"), true);
});
test("αληθινή ροή rss δεν πιάνεται", () => {
  assert.equal(isHtmlWall("rss", '<?xml version="1.0"?><rss version="2.0"><channel><item/></channel></rss>'), false);
});
test("atom και χάρτης δεν πιάνονται", () => {
  assert.equal(isHtmlWall("rss", '<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), false);
  assert.equal(isHtmlWall("sitemap", '<?xml version="1.0"?><urlset></urlset>'), false);
});
test("ροή μέσα σε σελίδα HTML δεν πιάνεται (δείκτης ροής παρών)", () => {
  assert.equal(isHtmlWall("rss", "<!doctype html><html><body><pre>&lt;rss&gt;</pre><rss><channel></channel></rss></body></html>"), false);
});
test("στόχοι wpjson και html δεν κρίνονται ποτέ", () => {
  assert.equal(isHtmlWall("wpjson", ANUBIS), false);
  assert.equal(isHtmlWall("html", ANUBIS), false);
});
test("κενό σώμα δεν είναι τείχος (το πιάνει άλλος έλεγχος)", () => {
  assert.equal(isHtmlWall("rss", ""), false);
});
