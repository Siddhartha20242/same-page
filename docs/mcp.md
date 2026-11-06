# Same Page over MCP

This is a separate surface for a different person: someone in an MCP client such as Claude Code or Cursor who wants to ask
"do the docs for PAY-1 contradict the ticket?" without opening Jira. It exposes eight read-only tools. It cannot apply a fix,
create a task, or change anything.

## Tools
| Tool | Use it when | Input | Returns |
|---|---|---|---|
| `check-issue-docs` | You want the contradictions for one work item. | `issueKey`, for example `PAY-123` | Findings with evidence (rule, the page line, what Jira says), notes on possible history, or the reason the item could not be checked. |
| `scan-issues` | You want to know which of up to 10 work items have contradictions. | `issueKeys`, a JSON list such as `["PAY-1","PAY-2"]` | A coverage line (how many could be checked and why the rest could not), then the findings. |
| `project-brief` | You want to know whether a whole project is out of step with its docs. | `projectKey`, for example `PAY` | A verdict per open epic and in-progress item, what could not be checked and why. |
| `list-rules` | You want to know what Same Page looks for. | none | The ten rules, what each checks and its default severity. |
| `finding-history` | You want to know what happened to the contradictions on a work item. | `issueKey` | The events in order (first found, dismissed, snoozed, review task, fixed) with the rule and any reason. Never the people involved. |
| `rule-health` | You want to know how the rules are doing on this site. | none | Each rule's severity, how it was handled, a noisy hint, and the team's own rules. |
| `canon-check` | You want to know which pages anywhere on the site disagree with a declared fact. | none | The declared facts, the pages and lines that state a different value, and how many pages were read. |
| `impact-summary` | You want to know what Same Page has done on this site. | none | Counters, and an hours figure only if an administrator set one. |

## Turn it on (site admin, once)
External access is off by default. Atlassian Administration > Apps > Sites > your site > Connected apps > Same Page: allow
external access. Every tool call runs with the signed-in person's own Jira and Confluence permissions.

## Connect Claude Code
```bash
claude mcp add --transport http same-page https://mcp.atlassian.com/forge/bfaa94fa-5d7a-44a3-b41f-1cd0aa6cc462
```
Run `/mcp` inside Claude Code, choose `same-page`, and sign in. Atlassian shows an OAuth consent screen, and the tools appear after you accept.

## What success looks like
Ask: `Use same-page to check PAY-1 against its docs.` A good answer names the rule, quotes the page line and the Jira fact side by side, and says how many pages were read. If the work item has no target version or no linked page, the answer says it could not check and why. It never says "no contradictions" for something it could not check.

## Check the endpoint without signing in
```bash
curl -i -X POST https://mcp.atlassian.com/forge/bfaa94fa-5d7a-44a3-b41f-1cd0aa6cc462 \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
```
A live endpoint answers `401` with a `www-authenticate` header that points to its OAuth metadata. Observed on 2026-11-05.

## Status
`rovo:mcp` is a Preview module. The endpoint is live and protected. A signed-in tool call from a third-party client has **not**
been recorded yet, so this surface is described but not proven. The Rovo agent uses the same tools. `check-issue-docs` and `scan-issues` were verified end to end on a fresh site; `project-brief` and `list-rules` were added later and are covered by offline tests only.
