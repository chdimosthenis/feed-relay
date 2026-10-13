// ⛔ ΤΟ ΤΕΙΧΟΣ ΠΟΥ ΑΠΑΝΤΑ 200.
//
// Μέτρηση 13/10/2026 (YouWeekly): ο εκδότης έβαλε Anubis (proof-of-work της
// Techaro) μπροστά από το /feed. Ο runner, η λωρίδα EU και ο συλλέκτης παίρνουν
// και οι τρεις HTTP 200, `content-type: text/html`, 8.139 bytes, ουρά
// «</footer></body></html>». Το `fetchPayload` το θεωρούσε επιτυχία και το
// έστελνε ως rss: ο Worker μετρούσε 0 στοιχεία (relay_no_items) και η εφεδρική
// διαδρομή του Google ΔΕΝ άνοιγε ποτέ, γιατί ανοίγει μόνο όταν το fetch ρίξει
// σφάλμα. Άρα η πηγή έμεινε χωρίς άρθρο 7+ ώρες ενώ ο εκδότης έβγαζε ≈4 την ώρα.
//
// ΔΕΝ λύνουμε την πρόκληση: το τείχος είναι επιλογή του εκδότη, και ο δρόμος
// για να καλύψουμε την πηγή είναι ο συλλέκτης που ήδη υπάρχει για τα 403.
//
// Η συνάρτηση είναι ΣΤΕΝΗ επίτηδες: μόνο έγγραφο HTML που δεν περιέχει κανέναν
// δείκτη ροής ή χάρτη. Μια ροή που τυλίγεται σε HTML (π.χ. μέσα σε <pre>) ή ένας
// χάρτης με στυλ XSLT έχει <rss>/<feed>/<urlset>, άρα δεν πιάνεται.

const FEED_MARKERS = /<(rss|feed|rdf:rdf|channel|urlset|sitemapindex|item|entry)[\s>]/i;

/** @param {string} kind  το είδος του στόχου (rss, sitemap, wpjson, html)
 *  @param {string} body  το σώμα της απάντησης 200 */
export function isHtmlWall(kind, body) {
  if (kind !== "rss" && kind !== "sitemap") return false;
  const head = body.slice(0, 2048).trimStart();
  if (!/^(<!doctype\s+html|<html[\s>])/i.test(head)) return false;
  return !FEED_MARKERS.test(body);
}
