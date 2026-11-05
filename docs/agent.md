# The Rovo agent

The agent answers questions about whether a work item and its docs agree. It calls the same two actions as the MCP tools, so its
answers carry the same evidence and are never generated from memory.

## How it decides to call an action
Rovo chooses an action from its description and the user's wording. The descriptions in `same-page-app/manifest.yml` say when to use each:
- `check-issue-docs`: "Use when someone asks whether the Confluence docs or runbooks for a Jira issue contradict the issue, for example an old API version."
- `scan-issues`: "Use when someone asks which of a set of Jira issues (at most 10) have documentation contradictions."

## The prompt that worked on a real site
Run on a fresh site, where Rovo showed it invoking both tools, the logs showed both handlers running, and the answer quoted the evidence:
- `@Same Page do the docs for MOBL-58 contradict the ticket?`

The record is in [live-results.md](live-results.md). Other wordings (for example asking about several keys at once) are expected to
work because the action descriptions cover them, but they have not been recorded.

## What it does not do
It cannot edit a page, create a task or change a work item. Fixing happens in the Jira panel, where a person clicks Apply.

## Roadmap (not shipped)
Asking only helps people who think to ask. The next step is to run the same check where people already are: a Rovo automation
that checks a work item as it moves to Done, and a scheduled scan that posts a weekly summary.
