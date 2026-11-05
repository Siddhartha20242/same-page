# Same Page

**Keep your docs and tickets on the same page.**

Same Page is a Forge app for Jira and Confluence. It finds *provable* contradictions between a work item and the Confluence pages
linked to it, shows the evidence side by side, proposes a verified fix that a human applies as a revertible page version, and can
stop a Jira transition (for example to Done) while a contradiction is still open.

Codegeist 2026, category: Apps for Software Teams. Bonus targets: Best Agents and the Atlassian MCP bonus (Rovo agent and MCP server
modules are included).

## The problem

A runbook says `/api/v1/charge`. The Jira epic says the target is `v2`. An on-call engineer follows the runbook and calls a retired
endpoint. The contradiction was detectable for weeks and nobody checked, because docs and tickets live in different tools.

## What it does

| Step | What happens |
|---|---|
| Discover | Finds candidate pages for a work item: Jira remote links, Confluence search, or a pasted URL. |
| Detect | Deterministic rules, **no AI in detection**, so every finding is reproducible. |
| Show evidence | The exact line from the page beside what Jira says, with timestamps, authors and the stale token highlighted. |
| Propose a fix | A mechanical rewrite when unambiguous (`v1` to `v2`). For an ambiguous line, Forge-hosted Claude may reword that one line, and the result must pass the same rule check before it is shown. |
| Human decides | Apply (a Confluence page version that names the approver), create a review task, snooze 7 days, or dismiss with a required reason. |
| Record | Every Apply is sealed into a hash-chained audit log; the hash is also anchored on the Jira work item. |
| Guard | After a fix, the page is pinned. If someone edits the old version back in, Same Page comments on the work item. |
| Gate | A Jira workflow validator refuses the transition with the evidence packet. It fails open on any error. |
| Agent | A Rovo agent and MCP tools let you ask "do the docs for PAY-1 contradict the ticket?" and get the stored evidence quoted back. |

### The rules

| Rule | Fires when |
|---|---|
| R1 stale version | A linked page documents a version other than the work item's target, and the page was not edited after the status change. |
| R2 deprecated decision | A linked decision page is Deprecated or Superseded while the work item is still active. |
| R3 missing field | A required field is empty while the work item is Done. |
| R4 stale status claim | A page calls a work item "planned" or "shipped" when Jira says otherwise. |
| R5 spec mismatch | A doc line such as `DELETE /api/v2/charge/42` disagrees with an OpenAPI 3 JSON spec held in a linked page (deprecated is a block, unknown is a warning). |

Notes that may be intentional history (near "rollback", "legacy", "migration", "deprecated") are listed but never block.

## Try it

1. Install the app on a site that has Jira and Confluence, using the installation link in the Devpost submission. Install it for
   **both** products and accept the consent screens.
2. Open any Jira work item, then the **apps menu** (puzzle icon under the title) and choose **Same Page**.
3. Click **Create demo data**. It creates a runbook page, a deprecated decision page, an epic and the links between them.
4. Open the epic it names. You will see two contradictions with evidence. Click **Apply** on the runbook finding and check the
   Confluence page history: version 2 changes only the flagged line.
5. Optional, needs a company-managed Jira project and a Jira admin: attach the gate to the Done transition by following
   [docs/gate-setup.md](docs/gate-setup.md), then try to move the epic to Done before fixing the page.
6. Optional: in Rovo chat, ask `@Same Page do the docs for <KEY> contradict the ticket?`

Nothing is changed unless a person clicks a button. The demo data is created as the person who clicks, in a project and space that
person can write to.

## What was verified on a real site

Everything below was observed on real Jira and Confluence sites (a dev site, and a second fresh site running the production build).
The full log, including every bug the real site exposed, is in [docs/live-results.md](docs/live-results.md).

- Panel, Create demo data, R1, R2, R4 and R5 findings, Apply (page version 2, one line changed), review task, snooze and dismiss.
- The gate refusing a Done transition with the evidence, and allowing it after Apply fixed the page.
- The gate withholding quoted page text from a person who cannot read the page.
- The AI-suggested fix on an ambiguous line, passing the same verification.
- The sealed audit chain, shown as "Chain intact", and its anchor on the work item.
- The pin guard commenting after the old version was edited back.
- The Rovo agent end to end on a fresh site: it called both tools and quoted the evidence.

## Security and privacy

- **No external egress.** The manifest declares no `permissions.external`; the app calls only Atlassian APIs.
- **Runs as the viewer.** Panel actions use `asUser`, so reads and writes respect the person's Confluence permissions. The gate
  checks page read permission for the person making the transition before quoting any page text, and fails closed to a redacted
  message if it cannot tell.
- **Minimal data kept.** Forge storage holds dismiss/snooze records, the audit chain, and counters. The counters hold no page text,
  titles or names. The pin guard's comment names no page title or text.
- **AI is optional and bounded.** Detection never calls a model. The model may reword one ambiguous line; it is capped at 40 calls
  per day, cached for 24 hours, limited to version-only changes, and its output is rejected unless it passes the rule check.
- **Kill switch.** Setting the `SAME_PAGE_KILL` environment variable makes the gate allow everything.
- Scopes are listed with the reason for each in [same-page-app/manifest.yml](same-page-app/manifest.yml).

## Limits (please read)

- **No real-world accuracy figure.** Precision and recall of 1.00 are on 30 fixtures written by the authors, which is a regression
  guard and not a measurement. No real team has used it yet; [docs/pilot-kit.md](docs/pilot-kit.md) is the plan for collecting honest
  numbers, and [docs/public-data-probe.md](docs/public-data-probe.md) is a small probe on public Apache Kafka data.
- **Verification proves a fix is minimal, not that it is right.** An edit must be version-only and clear the flagged contradiction.
  It does not prove the new version is the correct one, so a human always reviews it.
- R1 needs a target version on the work item (summary, a component, or set from the panel). Free-form version names are not matched.
- R5 reads OpenAPI 3 **JSON** held in a linked Confluence page. It does not read attachments or YAML.
- The gate works only in **company-managed** projects (Jira does not offer validators in team-managed ones).
- The audit log is **tamper-evident, not tamper-proof**. It detects rewritten history; it cannot stop someone with storage write
  access from rewriting the whole chain.
- Third-party MCP clients are untested. The Rovo agent path is verified.
- Not covered by any rule yet: environment-name mismatches, and a page that cites a ticket that has since closed.

## Architecture

```
src/                  detection engine, plain TypeScript, no Forge imports (tested offline)
same-page-app/        the Forge app: manifest, resolvers, UI Kit panel, validator, Rovo tools
  src/core/           synced copy of src/ (npm run sync)
test/  fixtures/      203 tests and the 30-pair fixture set
scripts/              live gate check, receipt verifier, payload capture
docs/                 live results, gate setup, pilot kit, feasibility
```

Forge modules: `jira:issuePanel`, `jira:workflowValidator`, `confluence:contentBylineItem`, `trigger` (pin guard), `action` x2,
`rovo:agent`, `rovo:mcp`, `llm`. Language: TypeScript (strict), UI Kit native.

## Run the tests

```bash
npm install
npm test            # 203 tests: 199 pass, 4 skipped (they wait for captured real payloads)
npm run typecheck
```

Requires Node 24. To verify an Apply receipt offline: `node scripts/verify-receipt.mjs`.

To deploy your own copy: install the Forge CLI (Node 24.22 or later), then from `same-page-app/` run `forge register`,
`forge deploy`, and `forge install` for Jira and for Confluence.
