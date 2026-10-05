// ── Η ΜΝΗΜΗ ΣΥΝΔΕΣΜΩΝ ΤΩΝ ΚΥΡΙΩΝ ΣΤΟΧΩΝ GOOGLE NEWS ──────────────────────────
//
// ΑΠΟΦΑΣΗ ΧΕΙΡΙΣΤΗ 2026-10-05 (κανάλι 3236): «Ναι, με όριο και στάση στο 429».
// Οι στόχοι που ΖΟΥΝ από το Google News (το `url` τους είναι ερώτημα
// news.google.com, όχι ο εκδότης· 23 στις 5/10) αποθήκευαν μόνο διευθύνσεις
// `news.google.com/rss/articles/…`: 2.590 από 2.590 άρθρα σε 3 ημέρες. Ο
// αναγνώστης πήγαινε μέσω Google. Από εδώ και πέρα τα ΝΕΑ άρθρα τους φεύγουν με
// τη διεύθυνση του εκδότη· τα αποθηκευμένα μένουν όπως είναι.
//
// ⛔⛔ Ο ΚΑΝΟΝΑΣ: Η ΔΙΕΥΘΥΝΣΗ ΜΕ ΤΗΝ ΟΠΟΙΑ ΕΝΑ ΑΡΘΡΟ ΜΠΗΚΕ ΔΕΝ ΑΛΛΑΖΕΙ ΠΟΤΕ. Ο
// Worker αναγνωρίζει ένα άρθρο που ξαναστέλνεται ΜΟΝΟ από τη διεύθυνσή του
// (`loadKnownUrls`)· ο έλεγχος τίτλου πιάνει μόνο ό,τι δημοσιεύτηκε τις
// τελευταίες 6 ώρες. Άρθρο που μπήκε με σύνδεσμο Google και ξαναστέλνεται με
// διεύθυνση εκδότη μπαίνει ΔΕΥΤΕΡΗ φορά.
//
// ⛔⛔ ΚΑΙ ΤΟ ΤΙ ΕΧΕΙ ΜΠΕΙ ΤΟ ΞΕΡΕΙ ΜΟΝΟ Η D1 (κανάλι 3266). Η πρώτη γραφή
// έκρινε από τη μνήμη: ό,τι έλειπε από αυτήν στο πρώτο run, το θεωρούσε νέο.
// Μετρημένο 5/10 12:14Z: το Google News ΔΕΝ δίνει τα ίδια άρθρα σε κάθε run, και
// 4 του Taxheaven που η D1 είχε ήδη με σύνδεσμο Google (μία σελίδα του 31/8)
// μπήκαν ξανά με διεύθυνση εκδότη. Τώρα κάθε σύνδεσμος που λείπει από τη μνήμη
// ελέγχεται πρώτα στη D1 (`/known-urls` του fetcher): αν υπάρχει, κρατά το
// Google χωρίς κανένα αίτημα. Αν η D1 δεν απαντήσει, καμία ανάλυση και καμία
// εγγραφή: το φορτίο φεύγει όπως ήρθε, και το επόμενο run ξαναρωτά.
//
// Η ΜΝΗΜΗ ΕΙΝΑΙ ΟΙΚΟΝΟΜΙΑ, ΟΧΙ ΑΛΗΘΕΙΑ. Γλιτώνει την ερώτηση στη D1 και το
// αίτημα στο Google για ό,τι αποφασίστηκε ήδη, και κρατά τη διεύθυνση του
// εκδότη σταθερή. Αν χαθεί, η D1 ξαναδίνει τα ίδια: ό,τι μπήκε με Google είναι
// «γνωστό», ό,τι μπήκε με διεύθυνση εκδότη ξαναλύνεται στην ίδια διεύθυνση.
//
// ⚠ ΤΙ ΜΕΝΕΙ ΑΚΑΛΥΠΤΟ. (1) Χαμένη μνήμη ΚΑΙ άρνηση του Google στο ίδιο run: όσα
// είχαν μπει με διεύθυνση εκδότη ξαναφεύγουν με του Google. (2) Νέος σύνδεσμος
// Google για ΑΝΑΝΕΩΜΕΝΟ άρθρο: μπαίνει δεύτερη φορά, όπως έμπαινε και πριν με
// δύο συνδέσμους Google. (3) Ένα `git revert` αυτού του αρχείου: όσα έφυγαν με
// διεύθυνση εκδότη ξαναφεύγουν με του Google, ως 25 ανά πηγή. Γι' αυτό η ήπια
// επαναφορά είναι `GN_PRIMARY_RESOLVE_CAP: "0"` στο relay.yml.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/** Πόσα νεότερα του φορτίου κρατά ο Worker (`AGGREGATOR_ITEMS_PER_POST`). Μόνο
 * αυτά ελέγχονται και αναλύονται· ό,τι πέφτει πιο κάτω δεν μπαίνει στη βάση, και
 * αν ανέβει αργότερα, η D1 θα πει τότε αν το έχει. */
export const RESOLVE_WINDOW = 25;
/** Μέρες χωρίς εμφάνιση πριν σβηστεί μια εγγραφή. Το ευρύτερο ερώτημα είναι
 * `when:7d` (`wideUrl`)· ό,τι ξαναφανεί μετά, το κρίνει η D1. */
export const MEMO_TTL_DAYS = 8;

const ITEM_BLOCK = /<item\b[\s\S]*?<\/item>/gi;
const LINK = /<link>\s*([\s\S]*?)\s*<\/link>/i;
const PUBDATE = /<pubDate>([\s\S]*?)<\/pubDate>/i;
const GN_LINK = /^https?:\/\/news\.google\.com\/rss\/articles\//;

/** 27 χαρακτήρες αντί για τους ~250 του συνδέσμου: η μνήμη μένει ~1 MB. */
export const memoKey = (link) => createHash("sha1").update(link).digest("base64url");
export const dayOf = (ms) => Math.floor(ms / 86_400_000);

/** Στόχος που ΖΕΙ από το Google News: το κύριο `url` του είναι ερώτημα εκεί. */
export const isGoogleNewsPrimary = (t) =>
  /^https:\/\/news\.google\.com\//.test(t.url ?? "");

/** `found: false` σημαίνει πρώτο run ή χαμένη μνήμη· την απόφαση την παίρνει η D1. */
export function loadMemo(path) {
  try {
    const m = JSON.parse(readFileSync(path, "utf8"));
    if (m && m.v === 1 && m.t && typeof m.t === "object") return { memo: m, found: true };
  } catch {
    // λείπει ή είναι χαλασμένη: ίδια μεταχείριση με την πρώτη φορά
  }
  return { memo: { v: 1, t: {} }, found: false };
}

/** Σβήνει ό,τι δεν φάνηκε για `MEMO_TTL_DAYS`· κρατά το κλειδί του στόχου. */
export function saveMemo(path, memo, today) {
  let kept = 0;
  let pruned = 0;
  for (const entries of Object.values(memo.t)) {
    for (const [k, e] of Object.entries(entries)) {
      if (e[1] < today - MEMO_TTL_DAYS) {
        delete entries[k];
        pruned++;
      } else kept++;
    }
  }
  writeFileSync(path, JSON.stringify(memo));
  return { kept, pruned };
}

/** Τα στοιχεία με σύνδεσμο Google, νεότερα πρώτα, με τη σειρά του Worker
 * (`newestFirstForCap`): σταθερή, ισοπαλία με τη σειρά του εγγράφου, χωρίς
 * ημερομηνία στο τέλος. */
export function primaryItems(xml) {
  const out = [];
  for (const block of xml.match(ITEM_BLOCK) ?? []) {
    const l = block.match(LINK);
    if (!l || !GN_LINK.test(l[1])) continue;
    const d = block.match(PUBDATE);
    const t = d ? Date.parse(d[1].trim()) : NaN;
    out.push({ link: l[1], t: Number.isFinite(t) ? t : -Infinity, i: out.length });
  }
  return out.sort((a, b) => b.t - a.t || a.i - b.i);
}

/** Κοινό για όλο το run: το ταβάνι και η στάση ισχύουν για όλους τους στόχους μαζί. */
export function newRunContext(budget) {
  return {
    budget,
    refused: false,
    refusedAt: null,
    calls: 0,
    fresh: 0,
    stored: 0,
    resolved: 0,
    keptCap: 0,
    keptRefused: 0,
    failures: 0,
    checkFailed: 0,
  };
}

/** Σημειώνει την άρνηση του Google μία φορά· από εκεί και πέρα καμία νέα ανάλυση. */
export function markRefused(ctx) {
  if (!ctx.refused) {
    ctx.refused = true;
    ctx.refusedAt = new Date().toISOString().slice(11, 19);
  }
}

/**
 * Διαλέγει, ανά σύνδεσμο Google των νεότερων, ποια διεύθυνση φεύγει, και
 * γυρίζει το φορτίο με τις διευθύνσεις του εκδότη στη θέση τους.
 *
 * `known(links)` γυρίζει το σύνολο όσων συνδέσμων η D1 έχει ήδη· πετά σφάλμα αν
 * δεν απαντήσει. `resolve(link)` γυρίζει τη διεύθυνση ή null· πετά σφάλμα με
 * `refused: true` όταν το Google αρνείται (429/503). Τότε σταματά ΚΑΘΕ ανάλυση
 * του run, και ό,τι δεν αναλύθηκε φεύγει με τον σύνδεσμο του Google, για πάντα.
 */
export async function resolvePrimaryLinks({ source, xml, memo, ctx, today, resolve, known, concurrency = 4 }) {
  const cold = !Object.hasOwn(memo.t, source);
  if (cold) memo.t[source] = {};
  const entries = memo.t[source];
  const seen = new Map();
  const fresh = [];
  let reused = 0;
  primaryItems(xml).forEach((it, pos) => {
    if (seen.has(it.link)) return;
    const key = memoKey(it.link);
    seen.set(it.link, key);
    const e = entries[key];
    if (e) {
      e[1] = today;
      if (e[0] && pos < RESOLVE_WINDOW) reused++;
      return;
    }
    if (pos < RESOLVE_WINDOW) fresh.push({ link: it.link, key });
  });

  // Η D1 πρώτα: ό,τι έχει ήδη μπει κρατά τη διεύθυνση με την οποία μπήκε.
  let stored = new Set();
  let checkFailed = false;
  if (fresh.length) {
    try {
      stored = await known(fresh.map((f) => f.link));
    } catch {
      checkFailed = true;
    }
  }

  const got = new Map();
  const queue = checkFailed ? [] : fresh.filter((f) => !stored.has(f.link));
  const attempted = queue.length;
  let failures = 0;
  let refusedHere = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        if (ctx.refused || ctx.budget <= 0) return;
        const f = queue.shift();
        if (!f) return;
        ctx.budget--;
        ctx.calls++;
        try {
          const real = await resolve(f.link);
          if (real) got.set(f.link, real);
          else failures++;
        } catch (e) {
          if (e && e.refused) {
            refusedHere++;
            markRefused(ctx);
          } else failures++;
        }
      }
    }),
  );

  // Χωρίς απάντηση της D1 δεν καταγράφεται τίποτα: το επόμενο run ξαναρωτά.
  if (!checkFailed) for (const f of fresh) entries[f.key] = [got.get(f.link) ?? 0, today];

  let out = xml;
  for (const [link, key] of seen) {
    const url = entries[key]?.[0];
    if (url) out = out.split(link).join(escapeXml(url));
  }

  // Ό,τι έμεινε στην ουρά δεν ρωτήθηκε ποτέ: λόγω στάσης ή λόγω ταβανιού.
  const notTried = queue.length;
  const storedHere = checkFailed ? 0 : fresh.length - attempted;
  ctx.fresh += attempted;
  ctx.stored += storedHere;
  ctx.resolved += got.size;
  ctx.failures += failures;
  ctx.keptRefused += refusedHere;
  if (ctx.refused) ctx.keptRefused += notTried;
  else ctx.keptCap += notTried;
  if (checkFailed) ctx.checkFailed++;
  return {
    xml: out,
    cold,
    checkFailed,
    fresh: attempted,
    stored: storedHere,
    resolved: got.size,
    failures,
    refused: refusedHere,
    notTried,
    reused,
  };
}

function escapeXml(u) {
  return u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
