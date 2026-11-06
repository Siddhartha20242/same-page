# The Rovo agent

The agent answers questions about whether a work item and its docs agree. It calls the same four actions as the MCP tools, so its
answers carry the same evidence and are never generated from memory.

## Four agents, four people
| Agent | For | Ask it | Uses |
|---|---|---|---|
| Same Page | anyone | "Do the docs for PAY-1 contradict the ticket?" | check-issue-docs, scan-issues, project-brief, list-rules |
| Same Page release check | a release owner | "Is project PAY ready to ship?" | project-brief, scan-issues, check-issue-docs |
| Same Page audit trail | a compliance or engineering lead | "What happened to the contradictions on PAY-1?" | finding-history, impact-summary, check-issue-docs |
| Same Page rule coach | a Jira administrator | "Which rules look noisy on this site?", "Which pages disagree about our declared facts?" | rule-health, list-rules, canon-check |

All eight actions are read-only. They return events, rules and counts, never the people involved, and every quoted line is flattened and marked as data.

## How an agent decides to call an action
Rovo chooses an action from its description and the user's wording. The descriptions in `same-page-app/manifest.yml` say when to use each, for example:
- `check-issue-docs`: "Use when someone asks whether the Confluence docs or runbooks for a Jira issue contradict the issue, for example an old API version."
- `finding-history`: "Use when someone asks what happened to the contradictions on a Jira work item…"
- `rule-health`: "Use when someone asks which Same Page rules are noisy, which severities were changed, what team rules exist…"

## What was verified
Only the first agent with `check-issue-docs` and `scan-issues` has been run in Rovo, on a fresh site (the record is in [live-results.md](live-results.md)): `@Same Page do the docs for MOBL-58 contradict the ticket?`. The three new agents and the five newer actions are covered by offline tests and pass the manifest linter. They have not been run in Rovo, because the development site has no Rovo chat and the production build that the Rovo site runs does not include them yet. How well Rovo chooses between four agents is untested.

## What it does not do
It cannot edit a page, create a task or change a work item. Fixing happens in the Jira panel, where a person clicks Apply.

## Where the check runs without anyone asking
Asking only helps people who think to ask, so the same checks also run unprompted: a notice comment when a work item is moved to Done with a blocking contradiction open (the soft gate), and a weekly scan of open epics shown on the project overview page. Both are tested offline and deployed to a development site; neither has been watched on a real work item yet.
