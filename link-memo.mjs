// ── Η ΜΝΗΜΗ ΣΥΝΔΕΣΜΩΝ ΤΩΝ ΚΥΡΙΩΝ ΣΤΟΧΩΝ GOOGLE NEWS ──────────────────────────
//
// ΑΠΟΦΑΣΗ ΧΕΙΡΙΣΤΗ 2026-10-05 (κανάλι 3236): «Ναι, με όριο και στάση στο 429».
// Οι στόχοι που ΖΟΥΝ από το Google News (το `url` τους είναι ερώτημα
// news.google.com, όχι ο εκδότης· 23 στις 5/10) αποθήκευαν μόνο διευθύνσεις
// `news.google.com/rss/articles/…`: 2.590 από 2.590 άρθρα σε 3 ημέρες. Ο
// αναγνώστης πήγαινε μέσω Google. Από εδώ και πέρα τα ΝΕΑ άρθρα τους φεύγουν με
// τη διεύθυνση του εκδότη· τα αποθηκευμένα μένουν όπως είναι.
//
// ⛔⛔ ΓΙΑΤΙ ΜΝΗΜΗ ΚΑΙ ΟΧΙ «ΑΝΑΛΥΣΕ ΚΑΘΕ ΦΟΡΑ». Ο Worker αναγνωρίζει ένα άρθρο
// που ξαναστέλνεται ΜΟΝΟ από τη διεύθυνσή του (`loadKnownUrls`)· ο έλεγχος
// τίτλου πιάνει ό,τι μπήκε τις τελευταίες 6 ώρες. Το ίδιο άρθρο ξαναστέλνεται σε
// ΚΑΘΕ κύκλο όσο μένει στα 25 νεότερα, μέρες ολόκληρες για μια μικρή πηγή. Αν
// μία φορά φύγει με τη διεύθυνση του εκδότη και την επόμενη με του Google
// (επειδή το Google αρνήθηκε ή τελείωσε το ταβάνι), μπαίνει ΔΕΥΤΕΡΗ φορά. Ο
// κανόνας λοιπόν: η διεύθυνση με την οποία ένα άρθρο έφυγε μία φορά δεν αλλάζει
// ποτέ. Η μνήμη κρατά αυτή την απόφαση ανά σύνδεσμο Google, και ένα άρθρο που
// αναλύθηκε δεν ξαναρωτά το Google: η ίδια διεύθυνση βγαίνει από τη μνήμη.
//
// ⛔ Η ΠΡΩΤΗ ΦΟΡΑ ΚΡΑΤΑ ΤΟ GOOGLE. Ένας στόχος που λείπει από τη μνήμη (όλοι στο
// πρώτο run, κάθε νέος στόχος αργότερα) έχει ήδη στείλει τα τρέχοντα άρθρα του
// με διεύθυνση Google. Αν τα αναλύαμε τώρα, θα έμπαιναν όλα δεύτερη φορά. Γι'
// αυτό καταγράφονται «μένει Google» χωρίς κανένα αίτημα.
//
// ⚠ ΤΙ ΜΕΝΕΙ ΑΚΑΛΥΠΤΟ. Αν χαθεί η κρυφή μνήμη του GitHub, το επόμενο run είναι
// «πρώτη φορά» για όλους, και όσα άρθρα είχαν φύγει με διεύθυνση εκδότη και
// μένουν στα 25 νεότερα ξαναφεύγουν με του Google. Όσα μπήκαν τις τελευταίες 6
// ώρες τα πιάνει ο έλεγχος τίτλου· τα παλαιότερα μπαίνουν δεύτερη φορά, το πολύ
// 25 ανά πηγή, μία φορά. Το ίδιο ισχύει για ένα `git revert` αυτού του αρχείου:
// η ήπια επαναφορά είναι `GN_PRIMARY_RESOLVE_CAP: "0"` στο relay.yml, που
// σταματά κάθε νέο αίτημα και κρατά τη μνήμη.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/** Πόσα νεότερα του φορτίου κρατά ο Worker (`AGGREGATOR_ITEMS_PER_POST`). Μόνο
 * αυτά αναλύονται· ό,τι πέφτει πιο κάτω δεν μπαίνει ποτέ στη βάση. */
export const RESOLVE_WINDOW = 25;
/** Πόσα νεότερα καταγράφονται. Πέντε παραπάνω: ο Worker κόβει τις μελλοντικές
 * ημερομηνίες στο «τώρα» πριν ταξινομήσει, οπότε στο όριο των 25 μπορεί να
 * διαφωνήσουμε κατά μία θέση. Ό,τι πέσει εκεί καταγράφεται «μένει Google» ώστε
 * να μην αλλάξει ποτέ διεύθυνση. */
export const RECORD_WINDOW = 30;
/** Μέρες χωρίς εμφάνιση πριν σβηστεί μια εγγραφή. Το ευρύτερο ερώτημα είναι
 * `when:7d` (`wideUrl`), άρα μετά από 8 ημέρες ένα άρθρο δεν ξαναφαίνεται. */
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

/** `found: false` σημαίνει πρώτο run (ή χαμένη μνήμη): όλοι οι στόχοι «πρώτη φορά». */
export function loadMemo(path) {
  try {
    const m = JSON.parse(readFileSync(path, "utf8"));
    if (m && m.v === 1 && m.t && typeof m.t === "object") return { memo: m, found: true };
  } catch {
    // λείπει ή είναι χαλασμένη: ίδια μεταχείριση με την πρώτη φορά
  }
  return { memo: { v: 1, t: {} }, found: false };
}

/** Σβήνει ό,τι δεν φάνηκε για `MEMO_TTL_DAYS`· κρατά πάντα το κλειδί του στόχου,
 * γιατί στόχος χωρίς κλειδί θα ξαναγινόταν «πρώτη φορά». */
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
  return { budget, refused: false, refusedAt: null, calls: 0, fresh: 0, resolved: 0, keptCap: 0, keptRefused: 0, failures: 0 };
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
 * `resolve(link)` γυρίζει τη διεύθυνση ή null· πετά σφάλμα με `refused: true`
 * όταν το Google αρνείται (429/503). Τότε σταματά ΚΑΘΕ ανάλυση του run, και ό,τι
 * δεν αναλύθηκε φεύγει με τον σύνδεσμο του Google, για πάντα.
 */
export async function resolvePrimaryLinks({ source, xml, memo, ctx, today, resolve, concurrency = 4 }) {
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
    if (pos < RECORD_WINDOW) fresh.push({ link: it.link, key, pos });
  });

  const got = new Map();
  const queue = cold ? [] : fresh.filter((f) => f.pos < RESOLVE_WINDOW);
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

  for (const f of fresh) entries[f.key] = [got.get(f.link) ?? 0, today];

  let out = xml;
  for (const [link, key] of seen) {
    const url = entries[key]?.[0];
    if (url) out = out.split(link).join(escapeXml(url));
  }

  // Ό,τι έμεινε στην ουρά δεν ρωτήθηκε ποτέ: λόγω στάσης ή λόγω ταβανιού.
  const notTried = queue.length;
  if (!cold) {
    ctx.fresh += attempted;
    ctx.resolved += got.size;
    ctx.failures += failures;
    ctx.keptRefused += refusedHere;
    if (ctx.refused) ctx.keptRefused += notTried;
    else ctx.keptCap += notTried;
  }
  return {
    xml: out,
    cold,
    fresh: cold ? 0 : attempted,
    recorded: fresh.length,
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
