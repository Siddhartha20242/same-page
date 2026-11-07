# What the tests cover

`npm test` runs 348 tests: all pass, none skipped. Everything runs offline, against fakes of the Atlassian APIs and four recorded real responses.

| Area | Files | What it checks |
|---|---|---|
| Rules and engine | `engine`, `rules2`, `rule6`, `rule7`, `limits`, `messy`, `weakness`, `roast`, `scale` | Each rule fires on its case and stays silent on near misses, dated and historical lines, real-world version formats, batching and rate-limit retries. |
| Panel, actions, triage | `app`, `actions`, `apply`, `propose`, `noisy`, `metrics`, `release` | The panel model, Apply (re-verified before writing), snooze and dismiss, the noisy-rule hint, counters. |
| Numbers, dates, descriptions | `facts` | R8 to R10 fire on the review's own example and stay silent on equal values in other units, other subjects, qualifiers, ranges, history and defaults; ADF descriptions become text; the panel shows no Apply for them. |
| Break glass, draft stage, playground, YAML, legacy sections, export | `breakglass`, `draft`, `playground`, `yamlspec`, `ledgerexport`, `agehint` | An override needs a reason, lasts 24 hours for one work item, expires and revokes, and is sealed in the chain; a draft rule is counted and hidden; the playground fires rules on pasted text; YAML specs are read and bad YAML or alias bombs are ignored; sections under Legacy headings are skipped; the audit export verifies offline and fails if an entry is edited; the age hint never gives a probability; and nothing writes a null to storage. |
| Fact registry | `canon`, `facts` | A declared fact must read as exactly one value; the site-wide check finds disagreeing pages that were never linked, skips history, defaults and other audiences, respects the page and time limits, and its search words keep synonyms such as "lasts" findable. |
| Custom rules | `custom` | The three templates, plain-text matching, history skipping, input checks, the cap of ten, stable ids, a preview that saves nothing, and the evidence id in a gate refusal. |
| Handling timeline | `handling` | Events join the same verified chain, record who and why only where a person acted, break the chain if edited, and never throw. |
| Agent actions and impact | `agents` | The finding history lists events without account ids, rule health shows severity, handling and noisy hints, and the impact figures never invent a time-saved number. |
| Change notices, tuning, sharing, linking | `softgate`, `tuning`, `linkpage` | An edit that leaves a contradiction gets one notice and stays quiet otherwise; hints come only from enough marks; exported rules import with every rule checked; page addresses on other sites are refused. |
| Gate mode and pilot report | `gatemode` | Watch mode allows every transition and says it would have refused; enforce is the default; the pilot report carries the counts, per-rule marks and caveats and no keys, names or addresses. |
| Review marks | `review` | One mark per finding (changing it replaces the old one), per-rule counts, a summary that warns below ten, and no time-saved number made from marks. |
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

Added on 2026-11-07: `rewording.test.ts` (42 reworded cases in `fixtures/rewording.json`: agreeing statements must never fire, and reworded contradictions are caught except four listed misses that need real meaning ("retry window" against "retried within", "timeout" against "signed out after", "rate limit" against "the API allows N calls", "a couple of hours"); `node scripts/recall-check.mjs` prints the tally, 21 of 25 caught and 17 of 17 left alone; the cases are written by the authors, so this guards wording and is not a measurement of real recall), `adminguard.test.ts` (every resolver checks administrator rights or is on a documented open list), `coresync.test.ts` (the engine copy bundled in the app matches `src/`), `phase.test.ts` (a delivery-phase "v1", a package name and another product's release number are not API versions).

Added later on 2026-11-07: `readfromticket.test.ts` (the values read from a ticket are shown in the ticket's own words, capped and de-duplicated; the receipt uses an injectable clock) and two receipt tests in `tools.test.ts` (a receipt names the evidence ids and never claims the docs are correct).

Added after the code review on 2026-11-07: `reviewfixes.test.ts` (equal values in different units do not differ by floating-point error; a dated log line is skipped by the site-wide check even when its wording was rewritten; facts are extracted once per text; closing times are read only for closed cited tickets and the tickets are read in parallel; the Confluence byline applies the same "page edited after the ticket closed" test as the panel; `findingHistory` reads in parallel batches and names the Audit trail tab; the playground says which rules it cannot try).

Added after the second code review on 2026-11-07: `reviewfixes2.test.ts` (finding history for a work item the caller cannot see answers like one with no history; the audit trail shows a viewer only the current work item; a two-page finding is shown only to someone who can read both pages; the panel never caches an all-clear; the site-wide search leaves out the matcher's own expiry words; a fact check reads pages together and once).

