# What the tests cover

`npm test` runs 255 tests: all pass, none skipped. Everything runs offline, against fakes of the Atlassian APIs and four recorded real responses.

| Area | Files | What it checks |
|---|---|---|
| Rules and engine | `engine`, `rules2`, `rule6`, `rule7`, `limits`, `messy`, `weakness`, `roast`, `scale` | Each rule fires on its case and stays silent on near misses, dated and historical lines, real-world version formats, batching and rate-limit retries. |
| Panel, actions, triage | `app`, `actions`, `apply`, `propose`, `noisy`, `metrics`, `release` | The panel model, Apply (re-verified before writing), snooze and dismiss, the noisy-rule hint, counters. |
| Numbers, dates, descriptions | `facts` | R8 to R10 fire on the review's own example and stay silent on equal values in other units, other subjects, qualifiers, ranges, history and defaults; ADF descriptions become text; the panel shows no Apply for them. |
| Soft gate and weekly scan | `softgate` | Only a move to Done counts, one notice per set of blockers, names rules and a count and never page text; the scan keeps per-project counts and marks what is new. |
| Gate | `gate`, `ruleCatalog` | Fail-open behaviour, cache rules, the refusal message, page-text redaction, per-rule severity settings. |
| Security | `security`, `receipt`, `pin` | Permission-based redaction, the hash chain and tamper detection, the pin guard. |
| Agent tools, overview, byline | `tools`, `overview`, `platform` | Tool answers, the project overview, the page check. |
| Demo data | `seeddeps` | Demo creation and resume after a partial failure. |

## Contract tests against real responses
`test/payloads.test.ts` checks the adapters against four real, redacted Atlassian responses captured from a live site on 2026-11-06 and kept in `payloads/`: a Jira changelog, a work item's remote links, a Confluence page and a Confluence search. People are replaced with aliases and the site name with a placeholder. The search response holds an empty result list, so it proves the shape only, not how results are read. Re-capture with `scripts/capture-payloads.mjs`.

## What the tests cannot show
They do not run inside Forge. The panel rendering, the workflow validator, the byline and the Rovo agent were checked on real
sites by hand, not by an automated test.
