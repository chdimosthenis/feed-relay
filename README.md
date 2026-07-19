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
