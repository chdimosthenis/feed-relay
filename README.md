# tokastoraki-relay

Scheduled GitHub Action (every 30 minutes + manual dispatch) that fetches the
public surfaces of the publishers whose WAFs block Cloudflare's IP ranges but
answer generic datacenter egress — Contra + News247 (wp-json) and Sport24
(homepage HTML) — and relays the raw payloads to the tokastoraki fetcher's
`POST /ingest-external` endpoint, where the existing mappers parse and insert
them. Companion of `chdimosthenis/tokastoraki` (PR #17) and the egress-probe
findings in `chdimosthenis/tokastoraki-egress-probe`.

Secrets: `FETCHER_URL`, `FETCHER_SECRET` (repo Actions secrets). Budget:
~48 runs/day × ~1 min ≈ 1,440 minutes/month, inside the free 2,000.

## The target list is generated, not hand-written

`targets.json` is produced by `scripts/build-relay-targets.ts` in the app
repository, from the `relayed` flag on each entry of `config/feeds.ts`. The
fetcher's `/ingest-external` allowlist is built from the same flag, so both
halves of the contract move together: a source has to be marked relayed in
the app repo, deployed there, and regenerated here. Editing `targets.json`
by hand produces payloads the fetcher answers with 403.

Two reasons a source is relayed. Some publishers 403 Cloudflare's egress
ranges specifically while answering generic datacenter egress normally, so
the fetch has to happen from somewhere else. The rest are aggregator
queries: Google News rate-limits Cloudflare's shared egress once the whole
roster crosses roughly 110 requests an hour, and moving those queries here
takes them off that ceiling entirely.
