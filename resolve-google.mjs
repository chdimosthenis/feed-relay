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
const RESOLVE_CONCURRENCY = 4;

export async function resolveGoogleNewsUrl(gurl, BROWSER_HEADERS) {
  const page = await fetch(gurl, {
    headers: { ...BROWSER_HEADERS, Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
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
  if (!rpc.ok) return null;
  const txt = await rpc.text();
  const hit = txt.match(/https?:\/\/(?!news\.google|www\.google)[^"\\]{10,400}/);
  return hit ? hit[0] : null;
}

/** Αντικαθιστά όσες διευθύνσεις συλλέκτη λύνονται· κρατά αυτούσιες όσες όχι. */
export async function resolveAggregatorLinks(xml, BROWSER_HEADERS) {
  const found = xml.match(GN_ARTICLE) ?? [];
  const all = [...new Set(found)];
  // ⛔ Η ΠΕΡΙΚΟΠΗ ΛΕΓΕΤΑΙ, ΔΕΝ ΣΙΩΠΑ. Μετρημένο: ένα ερώτημα συλλέκτη γυρίζει
  // ΕΚΑΤΟ στοιχεία, ενώ ο Worker κρατά τα πρώτα 25 (AGGREGATOR_ITEMS_PER_POST).
  // Άρα η οροφή των 30 καλύπτει ό,τι πράγματι προσγειώνεται — αλλά «30/30» σε
  // φορτίο με 102 διευθύνσεις διαβάζεται ως ΠΛΗΡΕΣ ενώ δεν είναι, και μια
  // απουσία μέτρησης δεν επιτρέπεται να διαβάζεται ως καθαρό αποτέλεσμα. Η
  // σειρά είναι η σειρά του feed, δηλαδή νεότερα πρώτα: ίδια τα 25 που μένουν.
  const uniq = all.slice(0, RESOLVE_CAP);
  const dropped = all.length - uniq.length;
  if (uniq.length === 0) return { xml, total: 0, resolved: 0, dropped: 0 };
  const map = new Map();
  const queue = [...uniq];
  await Promise.all(
    Array.from({ length: Math.min(RESOLVE_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const g = queue.shift();
        if (!g) return;
        try {
          const real = await resolveGoogleNewsUrl(g, BROWSER_HEADERS);
          if (real) map.set(g, real);
        } catch {
          // σιωπηλά: κρατά την αρχική
        }
      }
    }),
  );
  let out = xml;
  for (const [g, real] of map) out = out.split(g).join(escapeXml(real));
  return { xml: out, total: uniq.length, resolved: map.size, dropped };
}

function escapeXml(u) {
  return u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

