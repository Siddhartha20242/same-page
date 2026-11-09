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

**Release by fix version.** The release check (and any client of the `project-brief` action or MCP tool) can take an optional Jira fix version, for example "Is release 2.3 ready to ship?". It then checks the open work items in that version of the project (up to 20, newest activity first) instead of the project's open epics and in-progress items, labels the answer with the version, and leaves out the project-wide weekly scan result. The version name may contain only letters, digits, spaces, dots, hyphens and underscores (up to 60), because it goes into a query. If no open work items come back for the version, the tool says none were found (or none you can see). Jira answered an unknown version with an empty result, not an error, on the demo site, so the tool also has a message for the case where Jira rejects a version with HTTP 400, but that path has not been seen live. Added in 7.57.0; run in Rovo on the production demo site (see docs/live-results.md).

The developer check, team digest and incident review were added after the live checks above; each was then run once in Rovo on the production demo site (7.56.0, MOBL-58, one starter each) and answered from the tools' results: the developer check named both contradictions with page line, Jira's value and the rule; the team digest gave 2 checked, 1 with contradictions, 18 not checked with reasons, said there was no weekly scan yet, and reported the handling counts (2 found, nothing fixed or dismissed); the incident review named both contradictions and said there was no recorded history. Picking agents: each Same Page agent is listed twice in the Rovo picker (nine agents show as eighteen entries), with the same description and starters and a different icon. The likely cause is one entry per installation, since the app is installed in both Jira and Confluence, but that is an inference: Atlassian's documentation was searched and does not describe it. Both copies answered the same way where both were tried; the first entry is the one used in the checks here.

## Depth: what an answer now contains (7.65.0)
The agents were not widened; their answers were deepened using data the tools already had. Each finding a tool returns now also carries `whichSideFirst` (the same date statement the panel shows, which never says which side is right) and `nextStep` (chosen by code, not by a model: when a verified edit exists it says to open the work item, open Same Page and click "Apply this edit to the page", and that an agent cannot apply it; when none exists it says Same Page cannot tell which side is right and to ask the owners or create a review task). The project brief lists items worst first, gives each a one-line headline, and names up to three items to fix first (`fixFirst`). The agent prompts ask for one answer shape (rule in plain words, the page line beside Jira's value, the dates, the next step, what a suggested edit would change) and the release check ends a "not ready" answer with a path to ready: the fix-first items, then the other warnings, then what could not be checked and why. Every agent also has a `followUpPrompt`, so Rovo's suggested follow-up questions stay within what the tools can answer. Unit-tested; not yet run in Rovo (see docs/live-results.md).

## What it does not do
It cannot edit a page, create a task or change a work item. Fixing happens in the Jira panel, where a person clicks Apply.

## Where the check runs without anyone asking
Asking only helps people who think to ask, so the same checks also run unprompted: a notice comment when a work item is moved to Done with a blocking contradiction open (the soft gate), and a weekly scan of open epics shown on the project overview page. Both are tested offline and deployed to a development site; neither has been watched on a real work item yet.
