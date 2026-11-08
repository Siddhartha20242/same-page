# Who this is for, and how it would be adopted

No team has used Same Page yet, so this page states a case and its limits. It does not claim results. Measured evidence, when there is some, goes in [impact.md](impact.md) and [live-results.md](live-results.md).

## The user and the buyer
- **Daily users:** release owners, on-call engineers, developers, and documentation owners on teams that keep specs, runbooks and decision records in Confluence and track work in Jira.
- **Who decides to adopt:** an engineering or platform lead who owns releases or on-call quality, and a Jira administrator who must install it and turn on the gate.
- **Who it is not for:** teams that do not link pages to work items, and sites where the work items' project is team-managed, because the gate needs a company-managed workflow.

## Why a team would try it
- It reads pages already linked to or titled like a work item, so there is nothing to tag first.
- It starts read-only. The gate has a watch-only mode that counts what it would have blocked, so a team can judge the noise before it enforces anything.
- Every finding shows the page's own line next to what Jira says, so a person checks it in seconds.

## How adoption would go
1. Install, open one work item that links a runbook, read the panel.
2. Mark findings real or false alarm; the project overview shows the counts per rule.
3. Turn the gate to watch-only on one project, then enforce for one transition (Done) once the noise is acceptable.
4. Give the on-call and release owners the Rovo agents.

## What it costs to run
Nothing was charged during development: the Developer Console usage page showed $0 when it was checked, the optional AI path is off, and the developer runs no server. Pricing for a listed version has not been decided and no price is claimed.

## What would show it works
Ordered by how much it would convince a reader: a team that keeps it installed after a week; the share of findings its users mark as real; findings that were fixed after the panel showed them; a transition the gate refused that a person agreed was right. The app already counts the last three without storing page text.

## Risks to adoption
- Noisy rules on sites with messy pages. Mitigation: per-rule severity, draft rules, watch-only gate, the tuning hint after five outcomes.
- Many pages are unreadable to the person asking, so more items come back "not checked" than "clean". The app says so on purpose.
- It checks consistency between two sources; it cannot tell which one is right.
