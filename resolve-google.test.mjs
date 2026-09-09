// Τρέχει χωρίς καμία εξάρτηση:  node --test
//
// ⛔ ΓΙΑΤΙ ΥΠΑΡΧΕΙ. Το `RESOLVE_CAP` έκοβε πάνω στη σειρά εγγράφου με το
// σχόλιο «το feed είναι νεότερα πρώτα». Κανένα σκέλος του RSS δεν το
// επιβάλλει. Τα τεστ εδώ κάτω δεν ελέγχουν ότι «δουλεύει»· ελέγχουν ότι η
// ΥΠΟΘΕΣΗ έχει πάψει να είναι φέρουσα, και ότι η οπισθοδρόμηση σε φορτίο
// χωρίς ημερομηνίες δίνει ΑΚΡΙΒΩΣ τη σημερινή συμπεριφορά.

import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregatorLinksNewestFirst } from "./resolve-google.mjs";

const gn = (id) => `https://news.google.com/rss/articles/${id}`;

const item = (id, date) =>
  `<item><title>t</title><link>${gn(id)}</link>` +
  (date ? `<pubDate>${date}</pubDate>` : "") +
  `</item>`;

const feed = (...items) =>
  `<?xml version="1.0"?><rss><channel><title>x</title>${items.join("")}</channel></rss>`;

test("ΤΟ ΚΥΡΙΟ: διαλέγει τις ΝΕΟΤΕΡΕΣ, όχι τις πρώτες του εγγράφου", () => {
  // Το παλιό είναι ΠΡΩΤΟ στο έγγραφο. Με σειρά εγγράφου θα κέρδιζε.
  const xml = feed(
    item("PALIO", "Mon, 01 Sep 2026 06:00:00 GMT"),
    item("MESAIO", "Sat, 06 Sep 2026 06:00:00 GMT"),
    item("NEO", "Tue, 09 Sep 2026 06:00:00 GMT"),
  );
  assert.deepEqual(aggregatorLinksNewestFirst(xml), [
    gn("NEO"),
    gn("MESAIO"),
    gn("PALIO"),
  ]);
});

test("ΟΠΙΣΘΟΔΡΟΜΗΣΗ: χωρίς καμία ημερομηνία, ΑΚΡΙΒΩΣ η σειρά εγγράφου", () => {
  const xml = feed(item("A"), item("B"), item("C"));
  assert.deepEqual(aggregatorLinksNewestFirst(xml), [gn("A"), gn("B"), gn("C")]);
});

test("σταθερή: ίδια ημερομηνία σημαίνει σειρά εγγράφου, όχι σειρά μηχανής", () => {
  const d = "Tue, 09 Sep 2026 06:00:00 GMT";
  const xml = feed(item("A", d), item("B", d), item("C", d));
  assert.deepEqual(aggregatorLinksNewestFirst(xml), [gn("A"), gn("B"), gn("C")]);
});

test("⛔ ΔΟΛΙΟΦΘΟΡΑ: αχρονολόγητη ΔΕΝ χάνεται, πάει τελευταία", () => {
  // Δεν μπορεί να αποδείξει ότι είναι νεότερη, αλλά πρέπει να ΥΠΑΡΧΕΙ στη
  // λίστα — αλλιώς θα έβγαινε σιωπηλά εκτός ταβανιού και δεν θα λυνόταν ποτέ.
  const xml = feed(
    item("ADATI"),
    item("NEO", "Tue, 09 Sep 2026 06:00:00 GMT"),
  );
  assert.deepEqual(aggregatorLinksNewestFirst(xml), [gn("NEO"), gn("ADATI")]);
});

test("⛔ ΔΟΛΙΟΦΘΟΡΑ: διεύθυνση ΕΞΩ από <item> επιβιώνει", () => {
  const xml =
    `<?xml version="1.0"?><rss><channel><description>${gn("EKTOS")}</description>` +
    item("NEO", "Tue, 09 Sep 2026 06:00:00 GMT") +
    `</channel></rss>`;
  const out = aggregatorLinksNewestFirst(xml);
  assert.equal(out[0], gn("NEO"));
  assert.ok(out.includes(gn("EKTOS")), "η εκτός <item> διεύθυνση εξαφανίστηκε");
});

test("⛔ ΔΟΛΙΟΦΘΟΡΑ: άκυρη ημερομηνία μετρά ως ΑΠΟΥΣΑ, δεν γίνεται NaN-σκουπίδι", () => {
  const xml = feed(
    item("SKOUPIDI", "όχι ημερομηνία"),
    item("NEO", "Tue, 09 Sep 2026 06:00:00 GMT"),
  );
  assert.deepEqual(aggregatorLinksNewestFirst(xml), [gn("NEO"), gn("SKOUPIDI")]);
});

test("διπλότυπη διεύθυνση σε δύο στοιχεία: κρατά τη ΝΕΟΤΕΡΗ ημερομηνία, μία φορά", () => {
  const xml = feed(
    item("DIPLO", "Mon, 01 Sep 2026 06:00:00 GMT"),
    item("MESAIO", "Sat, 06 Sep 2026 06:00:00 GMT"),
    item("DIPLO", "Tue, 09 Sep 2026 06:00:00 GMT"),
  );
  const out = aggregatorLinksNewestFirst(xml);
  assert.deepEqual(out, [gn("DIPLO"), gn("MESAIO")]);
  assert.equal(out.length, 2, "η διεύθυνση πρέπει να είναι μοναδική");
});

test("άδειο φορτίο δεν σκάει", () => {
  assert.deepEqual(aggregatorLinksNewestFirst(""), []);
  assert.deepEqual(aggregatorLinksNewestFirst("<rss><channel/></rss>"), []);
});
