# feed-relay

Scheduled GitHub Action that fetches a list of public RSS, sitemap and
WordPress endpoints and forwards the raw payloads to a configured HTTP
endpoint. Runs every 30 minutes, and on manual dispatch.

Configuration is two repository Actions secrets, `FETCHER_URL` and
`FETCHER_SECRET`. Nothing else is required and nothing is stored here.

## targets.json is generated

The target list is produced by a script in the consuming application, not
edited here. The receiving endpoint keeps its own allowlist built from the
same source, so a hand-edited entry is simply rejected on arrival.

## Why fetch from here at all

Some publishers refuse one hosting provider's IP ranges while answering an
ordinary datacenter egress normally, so the request has to originate
somewhere else. Separately, aggregator queries are rate-limited per egress,
and moving them here takes them off a shared ceiling.
