// Τρέχει χωρίς καμία εξάρτηση:  node --test
//
// ⛔ ΚΑΝΕΝΑ ΑΙΤΗΜΑ ΠΡΟΣ ΤΟ GOOGLE Ή ΤΟΝ WORKER ΑΠΟ ΕΔΩ. Η ανάλυση τρέχει ΜΟΝΟ
// στους runners του GitHub (κανάλι 2523: ποτέ από τον υπολογιστή του χειριστή).
// Ο αναλυτής και η D1 είναι ψεύτικοι, και το `fetch` αντικαθίσταται.
//
// Τι ελέγχεται (απόφαση 3236, «με όριο και στάση στο 429», και η διόρθωση 3266):
// ό,τι η D1 έχει ήδη δεν αλλάζει ποτέ διεύθυνση· χωρίς απάντηση της D1 τίποτα
// δεν αναλύεται· η άρνηση σταματά κάθε ανάλυση του run· το ταβάνι κόβει τα
// παλαιότερα· η μνήμη επιβιώνει και σβήνει.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEMO_TTL_DAYS,
  RESOLVE_WINDOW,
  isGoogleNewsPrimary,
  loadMemo,
  markRefused,
  memoKey,
  newRunContext,
  primaryItems,
  resolvePrimaryLinks,
  saveMemo,
} from "./link-memo.mjs";
import {
  garturlFrom,
  resolveAggregatorLinks,
  resolveGoogleNewsUrl,
} from "./resolve-google.mjs";

const BASE = Date.UTC(2026, 9, 5, 12, 0, 0);
const TODAY = Math.floor(BASE / 86_400_000);
const gn = (id) => `https://news.google.com/rss/articles/${id}?oc=5`;
const pub = (id) => `https://ekdotis.gr/${id.toLowerCase()}/`;

// Ένα στοιχείο όπως το γράφει το Google News: ο σύνδεσμος και στο <link> και
// στην περιγραφή.
const item = (id, hoursAgo) =>
  `<item><title>Τίτλος ${id} - Εκδότης</title><link>${gn(id)}</link>` +
  `<guid isPermaLink="false">${id}</guid>` +
  (hoursAgo == null ? "" : `<pubDate>${new Date(BASE - hoursAgo * 3_600_000).toUTCString()}</pubDate>`) +
  `<description>&lt;a href="${gn(id)}" target="_blank"&gt;Τίτλος ${id}&lt;/a&gt;</description>` +
  `<source url="https://ekdotis.gr">Εκδότης</source></item>`;

const feed = (...items) =>
  `<?xml version="1.0"?><rss><channel><title>x</title>` +
  `<link>https://news.google.com/search?q=site:ekdotis.gr</link>${items.join("")}</channel></rss>`;

/** Ψεύτικος αναλυτής: κρατά τις κλήσεις, και ανά κλήση κάνει ό,τι λέει το `how`. */
function fakeResolver(how = () => "ok") {
  const calls = [];
  const fn = async (link) => {
    calls.push(link);
    const id = link.match(/articles\/([^?]+)/)[1];
    const b = how(id, calls.length);
    if (b === "refuse") {
      const e = new Error("Google HTTP 429");
      e.refused = true;
      e.status = 429;
      throw e;
    }
    if (b === "null") return null;
    if (b === "throw") throw new Error("δίκτυο");
    return pub(id);
  };
  fn.calls = calls;
  return fn;
}

/** Ψεύτικη D1: τα ids που «υπάρχουν ήδη»· κρατά τι ρωτήθηκε. `down` = δεν απαντά. */
function fakeD1(ids = [], { down = false } = {}) {
  const asked = [];
  const fn = async (links) => {
    asked.push([...links]);
    if (down) throw new Error("known-urls HTTP 503");
    return new Set(links.filter((l) => ids.some((id) => l === gn(id))));
  };
  fn.asked = asked;
  return fn;
}

const run = (xml, memo, ctx, resolve, known = fakeD1(), source = "Εκδότης") =>
  resolvePrimaryLinks({ source, xml, memo, ctx, today: TODAY, resolve, known, concurrency: 1 });

/** Μνήμη όπου ο στόχος υπάρχει ήδη, χωρίς εγγραφές. */
const warm = (source = "Εκδότης") => ({ v: 1, t: { [source]: {} } });

test("ΤΟ ΠΕΡΙΣΤΑΤΙΚΟ ΤΟΥ TAXHEAVEN (12:14Z): λείπει από τη μνήμη, υπάρχει στη D1 → κρατά το Google, κανένα αίτημα", async () => {
  const memo = warm();
  const ctx = newRunContext(100);
  const r0 = fakeResolver();
  // Μια σελίδα του 31/8 ξαναφαίνεται· η D1 την έχει ήδη με σύνδεσμο Google.
  const xml = feed(item("NEO", 0), item("PALIA", 24 * 35));
  const r = await run(xml, memo, ctx, r0, fakeD1(["PALIA"]));
  assert.deepEqual(r0.calls, [gn("NEO")]);
  assert.equal(r.stored, 1);
  assert.ok(r.xml.includes(`<link>${gn("PALIA")}</link>`));
  assert.ok(r.xml.includes(`<link>${pub("NEO")}</link>`));
  assert.equal(memo.t["Εκδότης"][memoKey(gn("PALIA"))][0], 0);
  assert.equal(ctx.stored, 1);
});

test("ΣΤΟΧΟΣ ΧΩΡΙΣ ΜΝΗΜΗ (πρώτο run ή χαμένη cache): ό,τι έχει η D1 μένει, ό,τι δεν έχει αναλύεται", async () => {
  const memo = { v: 1, t: {} };
  const ctx = newRunContext(100);
  const r0 = fakeResolver();
  const xml = feed(item("A", 1), item("B", 2), item("C", 3));
  const r = await run(xml, memo, ctx, r0, fakeD1(["B", "C"]));
  assert.equal(r.cold, true);
  assert.deepEqual(r0.calls, [gn("A")]);
  assert.equal(r.stored, 2);
  assert.ok(r.xml.includes(`<link>${pub("A")}</link>`));
  assert.ok(r.xml.includes(`<link>${gn("B")}</link>`));
  assert.equal(Object.keys(memo.t["Εκδότης"]).length, 3);
});

test("Η D1 ΔΕΝ ΑΠΑΝΤΑ: καμία ανάλυση, καμία εγγραφή στη μνήμη, το φορτίο αυτούσιο· το επόμενο run ξαναρωτά", async () => {
  const memo = warm();
  const ctx = newRunContext(100);
  const r0 = fakeResolver();
  const xml = feed(item("N1", 0), item("N2", 1));
  const down = fakeD1([], { down: true });
  const r = await run(xml, memo, ctx, r0, down);
  assert.equal(r.checkFailed, true);
  assert.equal(r0.calls.length, 0);
  assert.equal(r.xml, xml);
  assert.deepEqual(memo.t["Εκδότης"], {});
  assert.equal(ctx.checkFailed, 1);
  // Στο μεταξύ ο Worker τα έβαλε με Google: το επόμενο run τα βρίσκει «γνωστά».
  const up = fakeD1(["N1", "N2"]);
  const r2 = await run(xml, memo, newRunContext(100), r0, up);
  assert.equal(up.asked.length, 1);
  assert.equal(r0.calls.length, 0);
  assert.equal(r2.xml, xml);
});

test("ΝΕΟ ΑΡΘΡΟ: αναλύεται, και η διεύθυνση του εκδότη μπαίνει στο <link> ΚΑΙ στην περιγραφή", async () => {
  const memo = warm();
  const r0 = fakeResolver();
  const r = await run(feed(item("NEO", 0), item("A", 2)), memo, newRunContext(100), r0, fakeD1(["A"]));
  assert.deepEqual(r0.calls, [gn("NEO")]);
  assert.equal(r.resolved, 1);
  assert.ok(r.xml.includes(`<link>${pub("NEO")}</link>`));
  assert.ok(r.xml.includes(`href="${pub("NEO")}"`));
  assert.ok(!r.xml.includes(gn("NEO")));
  assert.ok(r.xml.includes(`<link>${gn("A")}</link>`));
});

test("ΑΜΕΤΑΒΛΗΤΟ: στο επόμενο run το ίδιο άρθρο φεύγει με την ίδια διεύθυνση, χωρίς D1 και χωρίς Google", async () => {
  const memo = warm();
  const first = fakeResolver();
  const xml = feed(item("NEO", 0), item("A", 2));
  const r1 = await run(xml, memo, newRunContext(100), first);
  assert.equal(first.calls.length, 2);
  // Ακόμη κι αν το Google τώρα αρνείται, η διεύθυνση βγαίνει από τη μνήμη.
  const refusing = fakeResolver(() => "refuse");
  const d1 = fakeD1();
  const ctx2 = newRunContext(100);
  const r2 = await run(xml, memo, ctx2, refusing, d1);
  assert.equal(refusing.calls.length, 0);
  assert.equal(d1.asked.length, 0);
  assert.equal(r2.xml, r1.xml);
  assert.equal(r2.reused, 2);
  assert.equal(ctx2.refused, false);
});

test("ΣΤΑΣΗ ΣΤΟ 429: μετά την πρώτη άρνηση κανένα αίτημα, και ό,τι δεν αναλύθηκε κρατά το Google για πάντα", async () => {
  const memo = warm();
  memo.t["Άλλος"] = {};
  const ctx = newRunContext(100);
  const refusing = fakeResolver(() => "refuse");
  const xml = feed(item("N1", 0), item("N2", 1), item("N3", 2), item("N4", 3), item("N5", 4));
  const r = await run(xml, memo, ctx, refusing);
  assert.equal(refusing.calls.length, 1);
  assert.equal(ctx.refused, true);
  assert.equal(r.refused, 1);
  assert.equal(r.notTried, 4);
  assert.equal(r.resolved, 0);
  assert.equal(r.xml, xml);
  assert.equal(ctx.keptRefused, 5);
  assert.equal(ctx.keptCap, 0);
  // Άλλος στόχος στο ΙΔΙΟ run: κανένα αίτημα.
  const other = fakeResolver();
  await run(feed(item("X", 0)), memo, ctx, other, fakeD1(), "Άλλος");
  assert.equal(other.calls.length, 0);
  // Επόμενο run, το Google απαντά: τα πέντε ΔΕΝ ξαναρωτιούνται, κρατούν το Google.
  const ok = fakeResolver();
  const r2 = await run(xml, memo, newRunContext(100), ok);
  assert.equal(ok.calls.length, 0);
  assert.equal(r2.xml, xml);
});

test("ΚΟΙΝΗ ΣΤΑΣΗ: αν η εφεδρική είδε ήδη άρνηση στο run, ο κύριος στόχος δεν ρωτά", async () => {
  const memo = warm();
  const ctx = newRunContext(100);
  markRefused(ctx);
  const r0 = fakeResolver();
  const r = await run(feed(item("N1", 0), item("N2", 1)), memo, ctx, r0);
  assert.equal(r0.calls.length, 0);
  assert.equal(r.notTried, 2);
  assert.deepEqual(Object.values(memo.t["Εκδότης"]).map((e) => e[0]), [0, 0]);
});

test("ΤΑΒΑΝΙ: με 2 αναλύσεις και 4 νέα, λύνονται τα 2 ΝΕΟΤΕΡΑ και τα άλλα κρατούν το Google", async () => {
  const memo = warm();
  const ctx = newRunContext(2);
  const r0 = fakeResolver();
  // Σειρά εγγράφου ανακατεμένη: το ταβάνι κόβει κατά ημερομηνία.
  const xml = feed(item("N3", 2), item("N1", 0), item("N4", 3), item("N2", 1));
  const r = await run(xml, memo, ctx, r0);
  assert.deepEqual(r0.calls, [gn("N1"), gn("N2")]);
  assert.equal(ctx.budget, 0);
  assert.equal(ctx.keptCap, 2);
  assert.equal(r.notTried, 2);
  const e = memo.t["Εκδότης"];
  assert.equal(e[memoKey(gn("N1"))][0], pub("N1"));
  assert.equal(e[memoKey(gn("N3"))][0], 0);
  assert.ok(r.xml.includes(`<link>${gn("N3")}</link>`));
});

test("ΠΑΡΑΘΥΡΟ: ελέγχονται και αναλύονται μόνο τα 25 νεότερα· τα παλαιότερα ούτε καταγράφονται", async () => {
  const memo = warm();
  const r0 = fakeResolver();
  const d1 = fakeD1();
  const ids = Array.from({ length: 35 }, (_, i) => `I${String(i).padStart(2, "0")}`);
  await run(feed(...ids.map((id, i) => item(id, i))), memo, newRunContext(100), r0, d1);
  assert.equal(r0.calls.length, RESOLVE_WINDOW);
  assert.equal(d1.asked[0].length, RESOLVE_WINDOW);
  const e = memo.t["Εκδότης"];
  assert.equal(Object.keys(e).length, RESOLVE_WINDOW);
  assert.equal(e[memoKey(gn("I24"))][0], pub("I24"));
  assert.equal(e[memoKey(gn("I25"))], undefined);
});

test("ΑΠΟΤΥΧΙΑ (όχι άρνηση): το άρθρο κρατά το Google και οι αναλύσεις συνεχίζουν", async () => {
  const memo = warm();
  const ctx = newRunContext(100);
  const r0 = fakeResolver((id, n) => (n === 1 ? "null" : n === 2 ? "throw" : "ok"));
  const r = await run(feed(item("N1", 0), item("N2", 1), item("N3", 2)), memo, ctx, r0);
  assert.equal(r0.calls.length, 3);
  assert.equal(r.failures, 2);
  assert.equal(r.resolved, 1);
  assert.equal(ctx.refused, false);
  assert.equal(ctx.failures, 2);
});

test("ΣΕΙΡΑ: όπως ο Worker, νεότερα πρώτα, ισοπαλία με τη σειρά του εγγράφου, χωρίς ημερομηνία στο τέλος", () => {
  const xml = feed(item("X", null), item("B", 5), item("A", 1), item("C", 5));
  assert.deepEqual(primaryItems(xml).map((i) => i.link), [gn("A"), gn("B"), gn("C"), gn("X")]);
});

test("ΜΝΗΜΗ: γράφεται και διαβάζεται· ό,τι δεν φάνηκε 8+ ημέρες σβήνεται, ο στόχος μένει", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gnmemo-"));
  const path = join(dir, "gn-links.json");
  const memo = {
    v: 1,
    t: {
      Εκδότης: { a: ["https://ekdotis.gr/a/", TODAY], b: [0, TODAY - MEMO_TTL_DAYS - 1] },
      Άδειος: { c: [0, TODAY - 30] },
    },
  };
  assert.deepEqual(saveMemo(path, memo, TODAY), { kept: 1, pruned: 2 });
  const { memo: m2, found } = loadMemo(path);
  assert.equal(found, true);
  assert.deepEqual(m2.t["Άδειος"], {});
  const r = await run(feed(item("Z", 0)), m2, newRunContext(10), fakeResolver(), fakeD1(), "Άδειος");
  assert.equal(r.cold, false);
  assert.equal(r.resolved, 1);
  // Χωρίς αρχείο ή με χαλασμένο: found false, κρίνει η D1.
  assert.equal(loadMemo(join(dir, "δεν-υπάρχει.json")).found, false);
  writeFileSync(join(dir, "χαλασμένο.json"), "{");
  assert.equal(loadMemo(join(dir, "χαλασμένο.json")).found, false);
});

test("ΚΥΡΙΟΣ ΣΤΟΧΟΣ: όποιος ρωτά το Google News στο κύριο url του, κανείς άλλος", () => {
  assert.equal(isGoogleNewsPrimary({ url: "https://news.google.com/rss/search?q=site:lamiafm1.gr" }), true);
  assert.equal(isGoogleNewsPrimary({ url: "https://lamiafm1.gr/feed/" }), false);
  assert.equal(isGoogleNewsPrimary({}), false);
});

test("ΑΠΑΝΤΗΣΗ GOOGLE: διεύθυνση με «=» και «&» βγαίνει ΟΛΟΚΛΗΡΗ (η παλιά regex την έκοβε)", () => {
  const url = "https://www.ekdotis.gr/article.php?id=123&cat=4";
  const inner = JSON.stringify(["garturlres", url, 1])
    .replace(/=/g, "\\u003d")
    .replace(/&/g, "\\u0026");
  const body =
    ")]}'\n\n" +
    JSON.stringify([
      ["wrb.fr", "Fbv4je", inner, null, null, null, "generic"],
      ["di", 42],
      ["af.httprm", 41, "-123", 7],
    ]);
  // Μάρτυρας: η παλιά ανάγνωση δίνει την κομμένη μορφή που βρέθηκε στη D1.
  const old = body.match(/https?:\/\/(?!news\.google|www\.google)[^"\\]{10,400}/)[0];
  assert.equal(old, "https://www.ekdotis.gr/article.php?id");
  assert.equal(garturlFrom(body), url);
});

test("ΑΠΑΝΤΗΣΗ GOOGLE: άγνωστη μορφή → η παλιά ανάγνωση· καμία διεύθυνση → null", () => {
  assert.equal(garturlFrom('x "https://www.ekdotis.gr/a-slug/" y'), "https://www.ekdotis.gr/a-slug/");
  assert.equal(garturlFrom(')]}\'\n\n[["wrb.fr","Fbv4je",null]]'), null);
});

test("ΑΡΝΗΣΗ: 429 και 503 πετούν σφάλμα με refused· 404 γυρίζει null όπως πριν", async () => {
  const orig = globalThis.fetch;
  try {
    for (const status of [429, 503]) {
      globalThis.fetch = async () => new Response("", { status });
      await assert.rejects(resolveGoogleNewsUrl(gn("A"), {}), (e) => e.refused === true && e.status === status);
    }
    globalThis.fetch = async () => new Response("", { status: 404 });
    assert.equal(await resolveGoogleNewsUrl(gn("A"), {}), null);
  } finally {
    globalThis.fetch = orig;
  }
});

test("ΕΦΕΔΡΙΚΗ: η άρνηση μετριέται και περνά παρακάτω, χωρίς να σταματά ή να χάνει διεύθυνση", async () => {
  const orig = globalThis.fetch;
  let fetches = 0;
  try {
    globalThis.fetch = async () => {
      fetches++;
      return new Response("", { status: 429 });
    };
    let told = 0;
    const xml = feed(item("A", 0), item("B", 1));
    const r = await resolveAggregatorLinks(xml, {}, () => told++);
    assert.equal(r.xml, xml);
    assert.equal(r.resolved, 0);
    assert.equal(r.refused, 2);
    assert.equal(told, 2);
    // Η εφεδρική ΔΕΝ σταματά: ρώτησε και τις δύο, όπως πριν.
    assert.equal(fetches, 2);
  } finally {
    globalThis.fetch = orig;
  }
});
