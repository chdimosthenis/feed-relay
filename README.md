# feed-relay

Scheduled GitHub Action that fetches a list of public RSS, sitemap and
WordPress endpoints and forwards the raw payloads to a configured HTTP
endpoint. Runs every 30 minutes, and on manual dispatch.

Configuration is two repository Actions secrets, `FETCHER_URL` and
`FETCHER_SECRET`. Nothing else is required. The only state is
`gn-links.json` in the Actions cache (see below); nothing is committed.

## Publisher links for Google News targets

Targets whose own URL is a Google News query receive opaque
`news.google.com/rss/articles/...` links. For new articles the relay asks
Google for the publisher's link and forwards that instead (`link-memo.mjs`).
Each run makes at most `GN_PRIMARY_RESOLVE_CAP` lookups (two requests each)
and stops at the first 429 or 503. Whatever is not looked up keeps its Google
link. `gn-links.json` remembers which link each article left with, so an
article never changes link between runs; a target missing from it sends its
current articles unchanged. Setting the cap to `"0"` stops all lookups and
keeps the memory.

## targets.json is generated

The target list is produced by a script in the consuming application, not
edited here. The receiving endpoint keeps its own allowlist built from the
same source, so a hand-edited entry is simply rejected on arrival.

## Why fetch from here at all

Some publishers refuse one hosting provider's IP ranges while answering an
ordinary datacenter egress normally, so the request has to originate
somewhere else. Separately, aggregator queries are rate-limited per egress,
and moving them here takes them off a shared ceiling.
