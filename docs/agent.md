# The Rovo agent

The agents answer questions about whether a work item and its docs agree. They call the same eight actions as the MCP tools, so its
answers carry the same evidence and are never generated from memory.

## Nine agents, nine uses
| Agent | For | Ask it | Uses |
|---|---|---|---|
| Same Page | anyone | "Do the docs for PAY-1 contradict the ticket?" | check-issue-docs, scan-issues, project-brief, list-rules |
| Same Page release check | a release owner | "Is project PAY ready to ship?" | project-brief, scan-issues, check-issue-docs |
| Same Page audit trail | a compliance or engineering lead | "What happened to the contradictions on PAY-1?" | finding-history, impact-summary, check-issue-docs |
| Same Page rule coach | a Jira administrator | "Which rules look noisy on this site?", "Which pages disagree about our declared facts?" | rule-health, list-rules, canon-check |
| Same Page docs owner | a technical writer or documentation owner | "Which pages are out of step with the work items in project PAY?" | project-brief, scan-issues, check-issue-docs, canon-check |
| Same Page on-call check | an on-call engineer | "Can I trust the runbook for PAY-1 right now?" | check-issue-docs, scan-issues, finding-history |
| Same Page developer check | a developer about to implement a work item | "Which docs contradict this work item before I start?" | check-issue-docs, canon-check, scan-issues |
| Same Page team digest | a team lead | "Give me a digest of this project against its docs" | project-brief, impact-summary, finding-history |
| Same Page incident review | a team reviewing an incident | "Which docs contradicted this work item, and was it ignored?" | check-issue-docs, finding-history, scan-issues |

The last five are different views of the same deterministic checks, not new detection: the docs owner groups results by page instead of by work item, and the on-call check answers in three fixed forms (contradiction found, no contradiction found by the rules, could not be checked) and always says that "no contradiction found" is not proof the runbook is right.

All eight actions are read-only. They return events, rules and counts, never the people involved, and every quoted line is flattened and marked as data.

## How an agent decides to call an action
Rovo chooses an action from its description and the user's wording. The descriptions in `same-page-app/manifest.yml` say when to use each, for example:
- `check-issue-docs`: "Use when someone asks whether the Confluence docs or runbooks for a Jira issue contradict the issue, for example an old API version."
- `finding-history`: "Use when someone asks what happened to the contradictions on a Jira work item…"
- `rule-health`: "Use when someone asks which Same Page rules are noisy, which severities were changed, what team rules exist…"

## What was verified
The first agent, with `check-issue-docs` and `scan-issues`, was run in Rovo on a fresh site (`@Same Page do the docs for MOBL-58 contradict the ticket?`). On the production build the next three were listed and answered in Rovo chat on the demo site: the rule coach, the release check and the audit trail (the record is in [live-results.md](live-results.md)). The docs owner and the on-call check were added afterwards and run on the production build (3.11.0) on the demo site; the record is in [live-results.md](live-results.md). How well Rovo chooses between six agents when the user does not pick one is untested.

The developer check, team digest and incident review were added after the live checks above and have not been run in Rovo yet. Picking agents: each Same Page agent is listed twice in the Rovo picker, once per product install (Jira and Confluence), so nine agents show as eighteen entries; pick the first.

## What it does not do
It cannot edit a page, create a task or change a work item. Fixing happens in the Jira panel, where a person clicks Apply.

## Where the check runs without anyone asking
Asking only helps people who think to ask, so the same checks also run unprompted: a notice comment when a work item is moved to Done with a blocking contradiction open (the soft gate), and a weekly scan of open epics shown on the project overview page. Both are tested offline and deployed to a development site; neither has been watched on a real work item yet.
