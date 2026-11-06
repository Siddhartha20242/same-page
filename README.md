# Same Page

**Keep your docs and tickets on the same page.**

Same Page is a Forge app for Jira and Confluence. It finds *provable* contradictions between a work item and the Confluence pages
linked to it, shows the evidence side by side, proposes a verified fix that a human applies as a revertible page version, and can
stop a Jira transition (for example to Done) while a contradiction is still open.

**Detection is deterministic, repeatable and auditable. No model decides what counts as a contradiction.** We chose that on purpose: it is for teams that have to explain a release decision afterwards, and it is why every finding carries its evidence and every fix is a revertible page version.

Codegeist 2026, category: Apps for Software Teams. Bonus targets: Atlassian MCP, Marketplace and Best Agents. Four Rovo agents and an MCP module are included; the MCP module is live, but no signed-in third-party client call has been recorded yet ([docs/mcp.md](docs/mcp.md)).

## The problem

A runbook says `/api/v1/charge`. The Jira epic says the target is `v2`. An on-call engineer follows the runbook and calls a retired
endpoint. The contradiction was detectable for weeks and nobody checked, because docs and tickets live in different tools.

## Why detection has no model
We kept AI out of the decision on purpose, for three reasons a team can check:
- **Repeatable.** The same work item and pages always give the same findings, so a refusal can be reproduced and explained to the person it stopped.
- **No model reads page text during detection,** so wiki content cannot steer a finding. (The agent and MCP tools do quote page text back to a model, so those outputs are flattened, capped and marked as data. That lowers the risk and does not remove it, which is why the tools are read-only.)
- **No drift.** A finding does not change because a model changed.

We are not claiming that is novel. We are claiming it is what makes a transition gate defensible: when Same Page stops a transition, the evidence is the page's own line next to Jira's own field. We know of no other app that does that inside a Jira workflow, but we have not surveyed the whole Marketplace.

## Who it is for
The first reader we build for is the **release owner or engineering manager** who has to say "we are ready" and be right. The audit trail serves the second reader, a compliance lead, and the rules for specs and duplicates serve a third, the API team. We lead with the first.

| Reader | Rules that matter most | Value |
|---|---|---|
| Engineering manager, on-call lead | R1 stale version, R4 stale status claim, R6 closed ticket, R8 to R10 numbers and dates | A runbook that contradicts the release is caught before someone follows it. |
| Governance and compliance lead | R2 deprecated decision, R3 missing field, and the audit log | Withdrawn decisions and missing fields are caught at transition time, and every applied fix is sealed in a tamper-evident log. |
| API and platform team | R5 spec mismatch, R7 pages disagree | Docs that describe an endpoint the spec does not have, or two pages that give two answers. |

**Why it matters.** Public surveys put an hour of downtime above $300,000 for over 90% of mid-size and large enterprises (ITIC, 2024). No survey we found isolates outages caused by stale documentation, so we do not claim a saving. The aim is to remove one avoidable cause. The pilot below is how we will measure it.

## How it differs from tools that write docs for you
Tools such as code-to-docs generators start from the code and use a model to draft documentation. Same Page starts from the **work item** and the pages people already wrote, checks them against each other with fixed rules, and stops at "here is the contradiction and the evidence". It does not write prose. That makes it smaller and easier to trust, and it composes with a docs generator rather than replacing one.

**Scope on purpose:** Same Page reads Jira work items and Confluence pages only. Reading READMEs, Google Docs or Notion would need external network access, which would remove the app's "no external egress" guarantee, so we left it out. [docs/extending.md](docs/extending.md) describes how a new source would plug in; it is a design, not a feature.

## What it does

| Step | What happens |
|---|---|
| Discover | Finds candidate pages for a work item: Jira remote links, Confluence search, or a pasted URL. |
| Detect | Deterministic rules, **no AI in detection**, so every finding is reproducible. |
| Show evidence | The exact line from the page beside what Jira says, with timestamps, authors and the stale token highlighted. |
| Propose a fix | A mechanical rewrite when unambiguous (`v1` to `v2`). For an ambiguous line, an optional Forge-hosted Claude path can reword that one line (off by default, see Security), and the result must pass the same rule check before it is shown. |
| Human decides | Apply (a Confluence page version that names the approver), create a review task, snooze 7 days, or dismiss with a required reason. |
| Record | Every Apply is sealed into a hash-chained audit log; the hash is also anchored on the Jira work item. The same chain holds each finding's handling timeline: first shown, dismissed (with the reason and who), snoozed, turned into a review task, applied. It does not record who merely looked at a finding. |
| Guard | After a fix, the page is pinned. If someone edits the old version back in, Same Page comments on the work item. |
| Gate (optional) | A Jira workflow validator refuses the transition and names the rule, the page, the next step and a short **evidence id** that is the same id the panel shows for that finding. It fails open on any error. The panel and review tasks work without it. |
| Your team's rules | A Jira administrator can add up to 10 rules of their own from three fixed templates (a phrase on the page while the status is, or is not, a value; a phrase while the work item has a label or component; a label that needs a phrase). They are plain-text matches, with a preview of what a rule would find on the current work item before it is saved. They run in the panel, the gate, the soft gate, the weekly scan and the agent. |
| Rules | Lists all ten rules with their severity and, once people use them, how often each was acted on or dismissed on this site. |
| Soft gate | When a work item is moved to Done with a blocking contradiction open, Same Page leaves one notice comment on it. It works in every project type, including team-managed ones, and never blocks. |
| Weekly scan | Once a week the app checks open epics and the project overview shows how many have contradictions and how many are new since the last scan. |
| Overview | A project page, **Same Page overview**, lists the open epics and in-progress work items (up to 20) with a verdict, finding count and the reason for anything it could not check. Read-only. |
| Agents | Four read-only Rovo agents for four different people, sharing seven checks that are also exposed as MCP tools: a general one, a **release check** (is project PAY ready to ship?), an **audit trail** agent (what happened to the contradictions on PAY-1?) and a **rule coach** (which rules look noisy on this site?). They answer from the same evidence as the panel and cannot change anything. See [docs/agent.md](docs/agent.md). |
| Real or false alarm | Every finding in the panel has "Yes, it is real" and "No, false alarm" buttons. The marks are counted per rule and shown on the overview page and to the agents, with a warning while the sample is under 10. This turns normal use into a precision figure. Marking never hides or changes a finding. |
| Impact on this site | The overview page shows what Same Page has done here: contradictions found, fixed, sent to owners, dismissed, transitions refused. A time-saved figure appears only if a Jira administrator types their own minutes-per-fix estimate. See [docs/impact.md](docs/impact.md). |

### The rules

| Rule | Default | Fires when |
|---|---|---|
| R1 stale version | Blocker | A linked page documents a version other than the work item's target, and the page was not edited after the status change. |
| R2 deprecated decision | Blocker | A linked decision page is Deprecated or Superseded while the work item is still active. |
| R3 missing field | Warning | A required field is empty while the work item is Done. |
| R4 stale status claim | Warning | A page calls a work item "planned" or "shipped" when Jira says otherwise. |
| R5 spec mismatch | Blocker | A doc line such as `DELETE /api/v2/charge/42` disagrees with an OpenAPI 3 JSON spec held in a linked page (deprecated is a block, unknown is a warning). |
| R6 closed ticket | Warning | A page treats another ticket as still open ("blocked by PAY-9") but Jira says that ticket is Done or Closed. It only warns and never blocks a transition. |
| R7 pages disagree | Warning | Two linked pages document the same endpoint or API at different versions (`POST /api/v1/charge` vs `/api/v2/charge`, or "Payments API v1" vs "v2") and the ticket cannot settle it: it has no target version, or targets neither. It shows both lines, only warns, and stays silent if the target matches one page (R1 handles that) or the wording is historical. |
| R8 duration differs | Warning | The work item and a page give different times for the same thing, such as "Access token expiry should be 1 hour" against "Access tokens expire after 30 minutes". |
| R9 limit or port differs | Warning | Different limits, sizes, counts or ports for the same thing ("100 requests per minute" against "200 requests per minute", `port 8080` against `port 9090`). |
| R10 date differs | Warning | Different dates for the same milestone (release, deadline, code freeze, cutover). |

R8 to R10 read the work item's summary and description, so they need **no target version and no status change**. They stay quiet unless both sides name the same subject, use the same qualifier ("up to", production versus staging), the work item gives one value and the page a different one, and the page line is not history. Same Page cannot tell which side is right, so it offers no Apply for these: it names both ways to resolve it.

A Jira administrator can move any rule between Blocker and Warning from **Same Page > Rules** in the panel, which also lists all ten rules even when nothing is found. Only Blockers can stop a transition.

Notes that may be intentional history (near "rollback", "legacy", "migration", "deprecated") are listed but never block.

## Try it

1. Install the app on a site that has Jira and Confluence, using the installation link in the Devpost submission. Install it for
   **both** products and accept the consent screens.
2. Open any Jira work item, then the **apps menu** (puzzle icon under the title) and choose **Same Page**.
3. Click **Create demo data**. It creates a runbook page, a deprecated decision page, an epic and the links between them.
4. Open the epic it names. You will see three contradictions with evidence (a stale runbook version, a deprecated decision, and a token expiry that the epic and the runbook state differently). Click **Apply** on the runbook version finding and check the
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
- The AI-suggested fix on an ambiguous line, passing the same verification (run with the optional AI path switched on).
- The sealed audit chain, shown as "Chain intact", and its anchor on the work item.
- The pin guard commenting after the old version was edited back.
- The Rovo agent end to end on a fresh site: it called both tools that existed then and quoted the evidence. Two more tools (a project brief and a rules list) were added later and have not been tried on a real site.

## Security and privacy

- **No external egress.** The manifest declares no `permissions.external`; the app calls only Atlassian APIs.
- **Runs as the viewer.** Panel actions use `asUser`, so reads and writes respect the person's Confluence permissions. The gate
  checks page read permission for the person making the transition before quoting any page text, and fails closed to a redacted
  message if it cannot tell.
- **The gate respects page permissions.** If the person making the transition cannot read a page, the refusal shows the rule name but not the page text or title.
- **Minimal data kept.** Forge storage holds dismiss/snooze records, the audit chain, and counters. The counters hold no page text,
  titles or names. The pin guard's comment names no page title or text.
- **AI is optional, off by default, and bounded.** Detection never calls a model, and the shipped app sends nothing to a model unless
  the developer sets `SAME_PAGE_AI=1`, because Forge LLM calls are billed. When on, it may reword one ambiguous line; it is capped at
  40 calls per day, cached for 24 hours, limited to version-only changes, and its output is rejected unless it passes the rule check.
- **No graph reasoning.** Same Page reads Confluence pages and Jira fields through their standard APIs. It does not use the Teamwork Graph.
- **Kill switch.** Setting the `SAME_PAGE_KILL` environment variable makes the gate allow everything.
- Scopes are listed with the reason for each in [same-page-app/manifest.yml](same-page-app/manifest.yml).

## Limits (please read)

- **No real-world accuracy figure.** Precision and recall of 1.00 are on 30 fixtures written by the authors, which is a regression guard and not a measurement. We also ran the engine on 141 pages from public Apache projects ([docs/public-data-probe.md](docs/public-data-probe.md)): it raised 3 findings, all false positives (0 of 4 with the earlier Kafka run), and in 80 hand-read non-findings we saw no missed contradiction. Public wikis rarely state hard facts, so this shows the engine is quiet there and that its Fix Version and dated-log paths needed care; it is not a pilot. We added a skip for dated log lines, but a re-run on Hadoop (2026-11-05) raised the same finding, so none of the three is fixed; the Hadoop one is arguable (a frozen 2017 status log whose ticket is Done today). No real team has used the app yet; [docs/pilot-kit.md](docs/pilot-kit.md) is the plan for collecting honest numbers.
- **R8 to R10 are new and tuned conservatively.** On the public Apache sample (Hadoop, Cassandra, Flink, ZooKeeper) they raised no finding, which says they are quiet there and says nothing about how many real number or date contradictions they miss. They match a subject by shared words, so a differently worded contradiction ("sessions last half an hour" against "timeout: 1h") is not caught. They have not been run on a team's own documents.
- **Verification proves a fix is minimal, not that it is right.** An edit must be version-only and clear the flagged contradiction.
  It does not prove the new version is the correct one, so a human always reviews it.
- R1 needs a target version on the work item (summary, a component, or set from the panel); without one, R1 is skipped and the panel says so, and the other rules still run. Free-form version names are not matched.
- The Confluence byline finds work items only by Jira keys written in the page text, so a page that is linked from an epic but never names it shows "not checked".
- Custom rules are plain-text matches from three templates, not a pattern language, and they run everywhere except the Confluence byline. A phrase that contains history wording (for example "legacy") is skipped on that line, like the built-in rules.
- R5 reads OpenAPI 3 **JSON** held in a linked Confluence page. It does not read attachments or YAML.
- The gate works only in **company-managed** projects (Jira does not offer validators in team-managed ones).
- The audit log is **tamper-evident, not tamper-proof**. It detects rewritten history; it cannot stop someone with storage write
  access from rewriting the whole chain.
- Third-party MCP clients are untested. The Rovo agent path is verified. `jira:workflowValidator` and `rovo:mcp` are Preview modules; without the validator, the panel and review tasks still work ([docs/gate-setup.md](docs/gate-setup.md)).
- If the optional AI path is off or its daily cap is reached, an ambiguous line gets no automatic edit; the panel says so and offers a review task instead. Detection is unaffected.
- A rule that people mostly dismiss (the existing noise detector: at least 5 outcomes, half or more dismissed) adds one calm line to the panel. It never hides findings, changes severity, or suppresses a blocker.
- Not covered by any rule yet: environment-name mismatches. R6 reads the status of at most 5 tickets a page mentions, by status name only.

## Plan and roadmap

1. **Pilot first (1 to 3 teams, 1 to 2 weeks).** Teams install the app on a test project and label each finding real or false alarm. We report counts and precision with the sample size, whatever they are. Method: [docs/pilot-kit.md](docs/pilot-kit.md). No pilot has run yet, so no real-world precision or time-saved figure exists.
2. Shipped but not yet seen on a real site: the soft gate, the weekly scan, R8 to R10, and the agent's project brief. Each has offline tests; the real-site check is the first thing to do.
3. Next rules, chosen by what the pilot's false alarms and misses say: owners and on-call names, and wording-tolerant matching for numbers.
4. An optional AI tier that may only propose candidates, shown only when both quoted lines exist verbatim, warn-only and off by default. Not built.

## Architecture

```
src/                  detection engine, plain TypeScript, no Forge imports (tested offline)
same-page-app/        the Forge app: manifest, resolvers, UI Kit panel, validator, Rovo tools
  src/core/           synced copy of src/ (npm run sync)
test/  fixtures/      274 tests and the 30-pair fixture set
scripts/              live gate check, receipt verifier, payload capture
docs/                 live results, gate setup, pilot kit, feasibility
```

Forge modules: `jira:issuePanel`, `jira:projectPage`, `jira:workflowValidator`, `confluence:contentBylineItem`, `trigger` (pin guard), `action` x2,
`rovo:agent`, `rovo:mcp`, `llm`. Language: TypeScript (strict), UI Kit native.

## Run the tests

```bash
npm install
npm test            # 267 tests, all passing (see docs/tests.md)
npm run typecheck
```

Requires Node 24. To verify an Apply receipt offline: `node scripts/verify-receipt.mjs`.

To deploy your own copy: install the Forge CLI (Node 24.22 or later), then from `same-page-app/` run `forge register`,
`forge deploy`, and `forge install` for Jira and for Confluence.
