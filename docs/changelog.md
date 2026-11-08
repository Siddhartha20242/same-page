# Changelog

Recent versions only; older changes are in the git history. Dates are when a version was deployed. "Production" means the environment installed on the demo site and the one behind the install link.

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
