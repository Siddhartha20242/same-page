# Changelog

Recent versions only; older changes are in the git history. Dates are when a version was deployed. "Production" means the environment installed on the demo site and the one behind the install link.

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
