// ── Η ΑΝΑΛΥΣΗ ΤΗΣ ΔΙΕΥΘΥΝΣΗΣ ΤΟΥ ΣΥΛΛΕΚΤΗ ─────────────────────────────────
//
// ΤΟ ΠΡΟΒΛΗΜΑ, ΜΕΤΡΗΜΕΝΟ 2026-08-18. Όταν ο εκδότης αρνείται και ο Worker
// αποφασίζει «aggregator», ό,τι στέλνουμε κουβαλά διευθύνσεις
// `news.google.com/rss/articles/...`. Στη βάση μπήκαν έτσι **584 άρθρα σε 24
// ώρες**, από 30 πηγές που όλες έχουν δική τους πόρτα. Ο αναγνώστης πατά και
// φεύγει σε ανακατεύθυνση του Google αντί για τον εκδότη, και το αρχείο κρατά
// διεύθυνση που δεν ελέγχουμε και μπορεί να πάψει να λύνεται.
//
// ⛔⛔ ΓΙΑΤΙ ΕΔΩ ΚΑΙ ΟΧΙ ΣΤΟΝ WORKER. Η ανάλυση χρειάζεται ΔΥΟ αιτήματα προς το
// Google ανά άρθρο, και το πρώτο κατεβάζει ~580 KB. Ο Worker τρέχει από το
// ΚΟΙΝΟ ΕΥΡΟΣ ΔΙΕΥΘΥΝΣΕΩΝ ΤΗΣ CLOUDFLARE, που το Google ήδη περιορίζει: την ίδια
// μέρα, δύο διαφορετικά ερωτήματα από τον Worker γύρισαν **HTTP 503 «Sorry...»**
// ενώ από άλλη γραμμή έδιναν 200. Ανάλυση από εκεί δεν θα δούλευε, και θα
// έτρωγε τον ίδιο προϋπολογισμό που χρειάζεται η ίδια η εφεδρεία. Ο
// αναμεταδότης τρέχει από αλλού και ΗΔΗ μιλά επιτυχώς με το Google — αυτός
// έφερε το feed που διορθώνουμε.
//
// ⚠ Η ΜΟΡΦΗ ΔΕΝ ΑΠΟΚΩΔΙΚΟΠΟΙΕΙΤΑΙ ΤΟΠΙΚΑ, ΔΟΚΙΜΑΣΤΗΚΕ. Το φορτίο `CBMi…` είναι
// σήμερα η αδιαφανής μορφή `AU_yq…` και ΔΕΝ ενσωματώνει τη διεύθυνση: το
// base64 δίνει σκουπίδια. Ούτε αρκεί ένα GET — η σελίδα που γυρίζει είναι το
// κέλυφος 590 KB και ο τομέας του εκδότη εμφανίζεται **μηδέν φορές** μέσα του.
// Χρειάζεται το ζεύγος `data-n-a-sg` / `data-n-a-ts` / `data-n-a-id` από τη
// σελίδα και μία εσωτερική κλήση. Μετρήθηκε **8 στα 8**, μέσος χρόνος 1,3s.
//
// ⛔ ΚΑΙ ΠΟΤΕ ΔΕΝ ΧΑΝΕΤΑΙ ΑΡΘΡΟ. Κάθε αστοχία κρατά την ΑΡΧΙΚΗ διεύθυνση: μια
// διεύθυνση Google είναι χειρότερη από του εκδότη, αλλά ασύγκριτα καλύτερη από
// άρθρο που δεν μπήκε. Η εναλλακτική «απόρριψε το υποκατάστατο» απορρίφθηκε
// ρητά από τον χειριστή γι' αυτόν ακριβώς τον λόγο.
const GN_ARTICLE = /https?:\/\/news\.google\.com\/rss\/articles\/[A-Za-z0-9_-]+(?:\?[^<"\s]*)?/g;

/** Πόσες μοναδικές διευθύνσεις λύνονται ανά φορτίο. Ο συλλέκτης δίνει ως 25. */
const RESOLVE_CAP = 30;
/** Πόσες παράλληλα. Τέσσερις: αρκετά για να μη διαρκεί λεπτά, λίγα για να μη
 * μοιάζει με επίθεση σε endpoint που δεν είναι δημόσιο συμβόλαιο. */
export const RESOLVE_CONCURRENCY = 4;

/** ⛔ Η ΑΡΝΗΣΗ ΤΟΥ GOOGLE ΔΕΝ ΕΙΝΑΙ null (κανάλι 3236, «στάση στο 429»). Ένα
 * null λέει «αυτό το άρθρο δεν λύθηκε, πήγαινε στο επόμενο»· μια άρνηση λέει
 * «σταμάτα να ρωτάς». Το 503 μετρά επίσης: είναι η σελίδα «Sorry…» που το
 * Google έδωσε για τον ίδιο λόγο στον Worker στις 18/8. */
const REFUSAL_STATUS = new Set([429, 503]);
function refusal(status) {
  const e = new Error(`Google HTTP ${status}`);
  e.refused = true;
  e.status = status;
  return e;
}

/**
 * ⛔ Η ΑΠΑΝΤΗΣΗ ΔΙΑΒΑΖΕΤΑΙ ΩΣ JSON, ΟΧΙ ΜΕ REGEX ΠΑΝΩ ΣΤΟ ΚΕΙΜΕΝΟ (5/10).
 * Η διεύθυνση έρχεται ΔΙΠΛΑ κωδικοποιημένη (JSON μέσα σε συμβολοσειρά JSON), και
 * το Google γράφει το «=» ως `\u003d` και το «&» ως `\u0026`. Η regex σταματά
 * στο πρώτο «\», άρα κάθε διεύθυνση με ερώτημα κοβόταν. Μετρημένα στη D1:
 * «…generate-post-pdf.php?id» (Metafores Press), «…?query-b1700bfd-page»
 * (Thesstoday). Δύο άρθρα κομμένα στην ίδια διεύθυνση γίνονται ΕΝΑ για τον
 * Worker: το δεύτερο κρίνεται «γνωστό» και δεν μπαίνει ποτέ. Η regex μένει μόνο
 * ως εφεδρεία, αν η μορφή αλλάξει: τότε η συμπεριφορά είναι η παλιά.
 */
export function garturlFrom(txt) {
  try {
    const outer = JSON.parse(txt.slice(txt.indexOf("[")));
    for (const row of outer) {
      if (!Array.isArray(row) || row[0] !== "wrb.fr" || typeof row[2] !== "string") continue;
      const inner = JSON.parse(row[2]);
      const u = Array.isArray(inner) && inner[0] === "garturlres" ? inner[1] : null;
      if (typeof u === "string" && /^https?:\/\/(?!news\.google|www\.google)/.test(u)) return u;
    }
  } catch {
    // άλλη μορφή: η παλιά ανάγνωση από κάτω
  }
  const hit = txt.match(/https?:\/\/(?!news\.google|www\.google)[^"\\]{10,400}/);
  return hit ? hit[0] : null;
}

export async function resolveGoogleNewsUrl(gurl, BROWSER_HEADERS) {
  const page = await fetch(gurl, {
    headers: { ...BROWSER_HEADERS, Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (REFUSAL_STATUS.has(page.status)) throw refusal(page.status);
  if (!page.ok) return null;
  const body = await page.text();
  const sg = body.match(/data-n-a-sg="([^"]+)"/);
  const ts = body.match(/data-n-a-ts="([^"]+)"/);
  const id = body.match(/data-n-a-id="([^"]+)"/);
  // ⚠ ΑΝ ΤΑ ΤΡΙΑ ΛΕΙΨΟΥΝ, ΤΟ GOOGLE ΑΛΛΑΞΕ ΣΕΛΙΔΑ. Δεν μαντεύουμε· γυρίζουμε
  // null και το άρθρο κρατά την αρχική του διεύθυνση.
  if (!sg || !ts || !id) return null;
  const req = JSON.stringify([
    [
      [
        "Fbv4je",
        JSON.stringify([
          "garturlreq",
          [
            ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
            "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0,
          ],
          id[1], Number(ts[1]), sg[1],
        ]),
        null,
        "generic",
      ],
    ],
  ]);
  const rpc = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: "f.req=" + encodeURIComponent(req),
    signal: AbortSignal.timeout(20_000),
  });
  if (REFUSAL_STATUS.has(rpc.status)) throw refusal(rpc.status);
  if (!rpc.ok) return null;
  return garturlFrom(await rpc.text());
}

const ITEM_BLOCK = /<item\b[\s\S]*?<\/item>/gi;
const PUBDATE = /<pubDate>([\s\S]*?)<\/pubDate>/i;

/**
 * ⛔ ΤΟ ΤΑΒΑΝΙ ΔΙΑΛΕΓΕΙ ΤΙΣ ΝΕΟΤΕΡΕΣ, ΟΧΙ ΤΙΣ ΠΡΩΤΕΣ — κανάλι 1267/1268.
 *
 * Το `RESOLVE_CAP` έκοβε πάνω στη ΣΕΙΡΑ ΕΓΓΡΑΦΟΥ, με το σχόλιο «η σειρά του
 * feed είναι νεότερα πρώτα». Αυτό είναι ΥΠΟΘΕΣΗ για τον εκδότη, όχι ιδιότητα
 * του φορτίου: κανένα σκέλος του RSS δεν την επιβάλλει, και όταν δεν ισχύει, οι
 * τριάντα που λύνονται είναι απλώς οι τριάντα που τυπώθηκαν πρώτες. Το ζεύγος
 * διεύθυνσης/ημερομηνίας υπάρχει ήδη μέσα στο ίδιο `<item>` — απλώς δεν το
 * διαβάζαμε.
 *
 * ⚠ ΚΑΙ ΤΙ ΔΕΝ ΑΛΛΑΖΕΙ: ΠΟΙΟ άρθρο μπαίνει στη D1 το κλειδώνει ο συλλέκτης
 * μετά την επίλυση. Εδώ κρίνεται μόνο αν το γνήσια νεότερο κρατά αδιαφανές
 * `news.google.com` URL. Καμία διεύθυνση δεν χάνεται ποτέ — ό,τι δεν λυθεί
 * κρατά την αρχική του μορφή, όπως και πριν.
 *
 * ⚠ ΚΑΙ ΤΟ ΣΚΕΛΟΣ ΤΗΣ ΟΠΙΣΘΟΔΡΟΜΗΣΗΣ: αν ΚΑΜΙΑ διεύθυνση δεν κουβαλά έγκυρη
 * ημερομηνία, γυρίζει ΑΚΡΙΒΩΣ τη σειρά εγγράφου — δηλαδή τη σημερινή
 * συμπεριφορά, χαρακτήρα προς χαρακτήρα. Οσες ζουν ΕΞΩ από `<item>` (atom
 * `<link>`, περιγραφή καναλιού) δεν έχουν δική τους ημερομηνία: μπαίνουν
 * αχρονολόγητες και πάνε τελευταίες, γιατί δεν μπορούν να αποδείξουν ότι είναι
 * νεότερες — αλλά ΔΕΝ εξαφανίζονται από τη λίστα.
 *
 * Εξαγόμενη για να ελέγχεται μόνη της, χωρίς δίκτυο.
 */
export function aggregatorLinksNewestFirst(xml) {
  const ts = new Map();
  const order = [];
  const push = (u, t) => {
    if (!ts.has(u)) {
      ts.set(u, t);
      order.push(u);
      return;
    }
    // Ιδια διεύθυνση σε δύο στοιχεία: κρατά τη ΝΕΟΤΕΡΗ ημερομηνία.
    const prev = ts.get(u);
    if (Number.isFinite(t) && (!Number.isFinite(prev) || t > prev)) ts.set(u, t);
  };

  for (const block of xml.match(ITEM_BLOCK) ?? []) {
    const d = block.match(PUBDATE);
    const t = d ? Date.parse(d[1].trim()) : NaN;
    for (const u of block.match(GN_ARTICLE) ?? []) push(u, t);
  }
  for (const u of xml.match(GN_ARTICLE) ?? []) if (!ts.has(u)) push(u, NaN);

  if (!order.some((u) => Number.isFinite(ts.get(u)))) return order;

  // Σταθερή: ίδια ημερομηνία σημαίνει σειρά εγγράφου, όχι σειρά μηχανής.
  return order
    .map((u, i) => ({ u, i, t: Number.isFinite(ts.get(u)) ? ts.get(u) : -Infinity }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : b.t - a.t))
    .map((e) => e.u);
}

/** Αντικαθιστά όσες διευθύνσεις συλλέκτη λύνονται· κρατά αυτούσιες όσες όχι.
 *
 * ⚠ Η ΕΦΕΔΡΙΚΗ ΔΕΝ ΣΤΑΜΑΤΑ ΣΤΗΝ ΑΡΝΗΣΗ, ΚΑΙ ΕΙΝΑΙ ΣΚΟΠΙΜΟ (3236 αφορά μόνο τους
 * κύριους στόχους). Εδώ τα ίδια άρθρα ξαναλύνονται σε κάθε run χωρίς μνήμη, άρα
 * ένα άρθρο που δεν ρωτήθηκε θα άλλαζε διεύθυνση και θα έμπαινε δεύτερη φορά. Η
 * άρνηση μόνο μετριέται και περνά στο `onRefused`, ώστε να σταματήσουν οι
 * αναλύσεις των κύριων στόχων (`link-memo.mjs`). */
export async function resolveAggregatorLinks(xml, BROWSER_HEADERS, onRefused = () => {}) {
  const all = aggregatorLinksNewestFirst(xml);
  // ⛔ Η ΠΕΡΙΚΟΠΗ ΛΕΓΕΤΑΙ, ΔΕΝ ΣΙΩΠΑ. Μετρημένο: ένα ερώτημα συλλέκτη γυρίζει
  // ΕΚΑΤΟ στοιχεία, ενώ ο Worker κρατά τα πρώτα 25 (AGGREGATOR_ITEMS_PER_POST).
  // Άρα η οροφή των 30 καλύπτει ό,τι πράγματι προσγειώνεται — αλλά «30/30» σε
  // φορτίο με 102 διευθύνσεις διαβάζεται ως ΠΛΗΡΕΣ ενώ δεν είναι, και μια
  // απουσία μέτρησης δεν επιτρέπεται να διαβάζεται ως καθαρό αποτέλεσμα. Η
  // σειρά ΔΕΝ είναι πια η σειρά του εγγράφου: είναι κατά `<pubDate>` φθίνουσα,
  // ώστε τα 30 να είναι τα ΝΕΟΤΕΡΑ και όχι τα πρώτα που τυπώθηκαν. Δες
  // `aggregatorLinksNewestFirst` από πάνω για το γιατί και για την οπισθοδρόμηση.
  const uniq = all.slice(0, RESOLVE_CAP);
  const dropped = all.length - uniq.length;
  if (uniq.length === 0) return { xml, total: 0, resolved: 0, dropped: 0, refused: 0 };
  const map = new Map();
  const queue = [...uniq];
  let refused = 0;
  await Promise.all(
    Array.from({ length: Math.min(RESOLVE_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const g = queue.shift();
        if (!g) return;
        try {
          const real = await resolveGoogleNewsUrl(g, BROWSER_HEADERS);
          if (real) map.set(g, real);
        } catch (e) {
          // κρατά την αρχική· μόνο η άρνηση μετριέται
          if (e && e.refused) {
            refused++;
            onRefused();
          }
        }
      }
    }),
  );
  let out = xml;
  for (const [g, real] of map) out = out.split(g).join(escapeXml(real));
  return { xml: out, total: uniq.length, resolved: map.size, dropped, refused };
}

function escapeXml(u) {
  return u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

