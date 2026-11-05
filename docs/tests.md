# What the tests cover

`npm test` runs 235 tests: 231 pass, 4 skipped, 0 fail. Everything runs offline against fakes of the Atlassian APIs.

| Area | Files | What it checks |
|---|---|---|
| Rules and engine | `engine`, `rules2`, `rule6`, `rule7`, `limits`, `messy`, `weakness`, `roast`, `scale` | Each rule fires on its case and stays silent on near misses, dated and historical lines, real-world version formats, batching and rate-limit retries. |
| Panel, actions, triage | `app`, `actions`, `apply`, `propose`, `noisy`, `metrics`, `release` | The panel model, Apply (re-verified before writing), snooze and dismiss, the noisy-rule hint, counters. |
| Gate | `gate`, `ruleCatalog` | Fail-open behaviour, cache rules, the refusal message, page-text redaction, per-rule severity settings. |
| Security | `security`, `receipt`, `pin` | Permission-based redaction, the hash chain and tamper detection, the pin guard. |
| Agent tools, overview, byline | `tools`, `overview`, `platform` | Tool answers, the project overview, the page check. |
| Demo data | `seeddeps` | Demo creation and resume after a partial failure. |

## The 4 skipped tests
`test/payloads.test.ts` holds four contract tests that compare the adapters with real captured Atlassian responses
(`payloads/jira-changelog.json`, `confluence-page.json`, `jira-remotelinks.json`, `confluence-search.json`, created by
`scripts/capture-payloads.mjs`). They skip when those files are absent, and they are absent from this repository because they
come from a private site. The same adapters were exercised against real Jira and Confluence sites by hand, and that is logged
in [live-results.md](live-results.md). The skips are not hiding a known bug.

## What the tests cannot show
They do not run inside Forge. The panel rendering, the workflow validator, the byline and the Rovo agent were checked on real
sites by hand, not by an automated test.
