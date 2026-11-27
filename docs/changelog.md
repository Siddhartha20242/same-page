# Changelog

Recent versions only; older changes are in the git history. Dates are when a version was deployed. "Production" means the environment installed on the demo site and the one behind the install link.

## 7.75.0, 2026-11-23 (development; on production since 2026-11-28 as Forge 3.30.0 to 3.32.0)
- **Agents cut from nine to five.** The general agent, the rule coach, the team digest and the incident review were removed so each remaining agent is distinct. The nine actions and MCP tools are unchanged. On production the on-call and developer agents were re-run live afterwards.
- **One edit, one finding.** A live on-call answer attached the verified edit to the wrong finding. The docs-owner and on-call prompts now say to keep each edit with its own finding. The next answer was correct; one sample.
- **Two real extraction bugs fixed.** A line that held a date as well as a duration ("Timeout is 10 seconds. Release freeze starts on December 15, 2026.") lost the subject words of the duration, so the timeout was never compared. And a bare "Timeout is 10 seconds" against "Timeout is 30 seconds" shared only one subject word, so it was silent. Both now fire; a named timeout ("Upload timeout") is still a different thing. Found by running the on-call scenario end to end with `node scripts/demo-incident.mjs`. 415 tests.
- **Silence now explains itself.** When a work item states no version, time, limit, port, percentage or date, the panel no longer says "No contradictions found" in green. It says "Nothing to compare yet", explains that no rule could fire, and gives an example to add. Development only; not yet seen on a live site.
- **Accuracy pass on authored wording.** 100 pairs written to read like real runbooks (see [accuracy.md](accuracy.md)). The first run on unseen wording scored precision 0.86 and recall 0.40; fixes brought the false alarms to zero and recall to 0.83 on the same sets, which were then tuned on. Changes: different qualifiers on each side are different things, named settings ("Max retries is 3") are read, past states and past-tense milestones are skipped, "between 1 and 10 minutes" is a range, years are a unit, deprecation and migration deadlines are plans. Offline only; not a real-world figure. 415 tests. A second unseen set (30 pairs) scored precision 1.00 and recall 0.67 on its first run; fixes took all 100 pairs to 1.00 and 0.84.

## 7.74.0, 2026-11-23 (development only)
- **Declared names and identifiers.** A declared fact can now be a name or an identifier, not only a time, limit or date: "payments service owner" is "Team Atlas", "primary database region" is "eu-west-1". "Check the whole site now" flags pages that state that subject with a different name. This is how Same Page reaches owners and named settings without a model. Deliberately narrow: only a name of up to four capitalised words or one identifier with a separator is read; free prose is refused when declared, and a page line is compared only when it names the whole subject and its value has the same shape, so "the owner is responsible for approvals" is never flagged. Tested offline (4 new tests, 404 in all); not yet seen on a live site. It does not check steps, process descriptions or who a person is.

## 7.73.0, 2026-11-21 (development; on production since 2026-11-22)
- **What-if preview of a version change.** A new read-only tool, `what-if-version`, answers "if this work item targeted v3, which linked pages would start contradicting it, and which would stop?" before anyone changes it. It runs the same fixed rules twice over the same pages (as they are, then with only the target version replaced) and reports the difference. It is an action, an MCP tool and a developer-agent question, and it needs no new permissions. Offline demo: `node scripts/demo-whatif.mjs`. Tested offline (7 new tests). Seen live on production on 2026-11-22, once (see live-results.md). Limits: only the target version is swapped, the status and its date are kept, and the closed-ticket rule is not part of the comparison.

## 7.72.0, 2026-11-21 (development; on production since 2026-11-22)
- The limit rule (R9) now also compares percentages, such as a canary share, an availability target or an error threshold ("10%", "99.9 percent"). It keeps the same guards as the other number rules: two shared subject words, same environment, ranges, history and examples skipped. No new rule id. Tested offline only so far; it has not fired on a real work item.

## 7.71.0, 2026-11-21 (development; on production since 2026-11-22)
- Fixed a crash in the number and date rules: a line containing a word that is also a JavaScript property name ("constructor", "toString", "valueOf") next to a number made the rule throw, so that page was not checked (the work item showed as not checked, and the gate allowed the move). Found by a new seeded fuzz test (3000 generated cases; same input gives the same result; no input throws; a check never changes its input). Present in production 7.68.0; fixed in 7.71.0, deployed to production on 2026-11-22.
- CI now also type-checks the Forge app (panel, resolvers), which it did not before.
- The team digest agent adds one line on the kinds of drift when the brief has `byRule`. A new test walks the panel's value imports and fails if any needs a Node-only module (a first deploy of this version failed on exactly that, and was fixed before it shipped).
- The project overview shows the kinds of drift in the project: items with contradictions counted by the rule of their most serious finding (for example "Stale version 3, Date differs 1"). The project brief carries the same list as `byRule`. Read-only, no new data kept.

## 7.70.0, 2026-11-16 (development; on production since 2026-11-22)
- The docs owner and team digest agents ask which project when none is given. Seen live: the docs owner agent assumed a project called PAY and told the user it was empty.

## 7.69.0, 2026-11-16 (production)
- The project brief lists the pages to fix: `pagesToFix` names each page once with the work items that disagree with it, blocked pages first. The docs owner agent uses it as its page order. Overview rows now keep up to five page titles.

## 7.68.0, 2026-11-16 (production)
- Agents name a rule in words: single-item results carry `ruleName` (for example "Stale version"), and the four general agents are told to use it and never the rule id.

## 7.67.0, 2026-11-09 (production)
- Release check answers are shorter and name the rule: project-brief items carry the rule's name, and how to see the evidence is stated once (`howToSeeEvidence`) instead of on every item.

## 7.66.0, 2026-11-09 (production)
- Agent answers no longer invent next steps: project-brief items carry a code-chosen `nextStep` and a reason-specific `howToUnblock`, and the prompts forbid the agent's own advice, paraphrased rules and printed field names (all three were seen on the live site in 7.65.0).

## 7.65.0, 2026-11-09 (production)
- Deeper agent answers, not more agents: findings carry `whichSideFirst` and a code-chosen `nextStep`; the project brief is worst first with a headline per item and a `fixFirst` list; the agent prompts ask for one answer shape and the release check ends with a path to ready; every agent has a `followUpPrompt`. No new scopes or modules (a minor version).

## 7.63.0, 2026-11-09 (development only)
- Rules and settings: the stage buttons now say Draft, Warning and Blocker, matching the stage chips beside them (they said Warn and Block).

## 7.62.0, 2026-11-09 (development only)
- Overview: the finding count and its headline share one line ("3 findings: Page documents ..."), which keeps rows compact.

## 7.59.0 to 7.61.0, 2026-11-09 (production as 7.61.0)
- **Project overview:** rows are shown worst first (blocked, warning, not checked, clean), each row with a finding shows its most serious finding as a one-line headline, and filter buttons (All, Blocked, Warning, Not checked, Clean) appear when there is more than one row. The hint under the summary now says where the evidence is: the work item's apps menu, then Same Page.
- **Work item panel, clean state:** the empty tab no longer repeats the banner or says "All clear". It says "Nothing to fix", that the fixed rules found nothing, that this does not prove the pages are correct, and where to see what was read.
- **Confluence byline:** a page that names no Jira work item now says "Same Page: names no work item", with a tooltip that says to write a key such as PAY-123 on the page. Other unchecked reasons still say "not checked", and no label ever calls an unchecked page clean.

## 7.58.0, 2026-11-08 (development only)
- Updated the `yaml` library to 2.9.1, which fixes a stack-overflow advisory for deeply nested YAML. Added a test that feeds such YAML to the spec reader.

## 7.57.0, 2026-11-08 (production)
- Release check by Jira fix version: "Is release 2.3 ready to ship?" checks only the open work items in that version. A version name is validated before it is used in a query.

## 7.56.0, 2026-11-08 (production)
- Three more Rovo agents: developer check, team digest, incident review (nine in total).

## 7.55.0, 2026-11-08 (production)
- Agent starter prompts no longer name specific work item keys, so they make sense on any site.

## 7.54.0, 2026-11-08 (production)
- "Check the rest": when the project overview stops early, one click continues with the items it did not reach instead of starting again from the first one.

## 7.53.0, 2026-11-08 (production)
- A project scan checks up to three work items at a time within the same request budget. On the demo project this did not change how many items were reached, because the request budget, not time, was the limit.

## Before 7.53.0
Three review rounds fixed 29 issues; the round 3 fixes reached production on 2026-11-07. See the git history and [live-results.md](live-results.md).
