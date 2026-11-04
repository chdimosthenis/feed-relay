/**
 * Which targets a run relays. relay.yml runs them all; relay-fast.yml sets
 * RELAY_ONLY to a short comma-separated list of source names and relays just
 * those, every ~14 minutes, because a publisher feed keeps only its newest ~10
 * items and the full relay (~47 min) loses the rest of a high-rate source.
 *
 * Unknown names are an ERROR, not a silent skip: a renamed source would
 * otherwise leave the fast job green and empty, which is exactly the shape of
 * failure a fast lane must not have.
 */
export function selectTargets(all, onlyCsv) {
  const only = String(onlyCsv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (only.length === 0) return { fast: false, targets: [...all], unknown: [] };
  const known = new Set(all.map((t) => t.source));
  const unknown = only.filter((n) => !known.has(n));
  const want = new Set(only);
  return { fast: true, targets: all.filter((t) => want.has(t.source)), unknown };
}
