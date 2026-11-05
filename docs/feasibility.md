# Same Page: feasibility notes

Status key: **Checked** = confirmed in Atlassian docs on 2026-10-28. **Tested** = proven by a test here.
**Unverified** = still needs a real Atlassian site (spike 1).

## The four problems and what was done

| Problem | Fix | Status |
|---|---|---|
| Can't backdate a Confluence page | Create the page first, the epic second, transition last. The page's last edit is genuinely older than the transition. Demo says "edited before the ticket moved" and shows real timestamps. Drop the "3 weeks" claim. | Tested (`seedDemo` ordering test) |
| Scope list incomplete | Draft manifest lists every scope needed. Project creation dropped (needs `manage:jira-configuration` plus Administer Jira). The demo epic is created inside an existing project, so only `write:jira-work` is needed. | Checked |
| Install-time seeding unreliable | Seeding runs on a "Create demo data" button as well as the install trigger. Docs say the install event can fire before the app has permissions (retry on 401/403) and community reports it not firing. | Checked |
| Scope too large for solo build | Build order below; cross-epic scan and rules table are the first cuts. | Plan |
| Rovo pitch | Agent actions are GET only (non-GET verbs reported as unreliable). Ranking is described as "semantic ranking of search results". "Create review task" is a panel button, not an agent action. | Checked (community-reported) |

## Facts the code depends on

- Status transition date: `GET /rest/api/3/issue/{key}/changelog`, filter entries whose items change `status`; the entry timestamp is the transition. Scope `read:jira-work`. **Checked** (endpoint and scope); property name `created` **Unverified**.
- Page last edit: Confluence v2 page `version.createdAt` and `version.authorId`; body needs `body-format=storage`. Scope `read:page:confluence` (granular) or `read:confluence-content.all`. **Checked** (fields); body parsing **Tested** against a hand-written payload only.
- Remote links: `GET /rest/api/3/issue/{key}/remotelink`. **Unverified**; not needed for the main path now because discovery is a CQL search.
- Rovo action manifest: `key, name, function, actionVerb, description, inputs`; agent lists action keys. **Checked**. Changes can take up to 20 minutes to appear.

## Still unproven (spike 1, needs a dev site)

1. CQL search returns sensible candidates for an epic summary, and scope name `search:confluence` is right.
2. Changelog and v2 page payloads match the shapes in `src/adapters.ts`.
3. The agent actually invokes `scan-epics` from Rovo chat.
4. Install trigger fires on a fresh site; the button path works regardless.
5. A judge-installed copy works on a fresh site without extra admin steps.

## Build order (cut from the bottom)

1. Spike 1: payload shapes + CQL + changelog on a real site (replace fixtures in `test/platform.test.js`).
2. Evidence panel with the seeded demo (the thing judges see).
3. Rovo `scan-epics` action.
4. Rovo `explain-finding` action.
5. Rules-as-a-Confluence-table (cut first if time runs short).

## Fix proposals (added)

- Detection stays deterministic. Fixes are proposed in [src/propose.ts](src/propose.ts): a mechanical rewrite when the change
  is unambiguous (bare `v1` -> `v2`), otherwise an optional model suggests ONE replacement line.
- Every proposal, mechanical or model-made, must pass `verifyFix`: only the flagged line changed, line not emptied, line states
  the target version, and the edited page no longer trips the R1 content rule. Failures are dropped, never shown.
- The app never edits the page. The suggestion goes into a review task or a Confluence comment for a human to apply.
- Forge LLM: **Checked** that an Atlassian-hosted Claude exists via an `llm` manifest module and `@forge/llm`
  (200k context, 100 requests/min). **Conflicting docs** on status (limits page says Early Access; changelog says GA on 2026-07-30).
  Confirm on a real site. Cost is billed to the developer, so cap usage per installation.
- Without the model the fix step still works for unambiguous cases (7 of 9 R1 fixtures); ambiguous ones are honestly refused.

## Bind forever (researched 2026-10-31; nothing verified on a real site)
- A Forge Confluence macro can read Jira as the viewing user (`requestJira` with `asUser`) and render a field value. Documented in pieces; no single official example found.
- Forge macros are stored as `ac:adf-extension` nodes. Community reports say inserting one through the storage format fails
  ("Error loading the extension"); the recommended route is ADF (Atlassian Document Format).
- Built: `src/bind.ts`, a pure ADF transform that swaps a stale token for an extension node and refuses unless the line sits in
  one text run and the token appears once. The extension node's shape is passed in, never assumed.
- Unverified: the real extension node shape, whether Confluence accepts the ADF update, `adfExport` for PDF and Word, and the scopes.
- Risk: high, one to two weeks. Treat it as a stretch behind the core.

## Platform limits (checked 2026-10-31 against Forge docs; confirm on the live pages)
- Function time: async consumers and scheduled triggers default 55 s, up to 900 s with `timeoutSeconds`; web triggers, actions and agent connectors about 55 s.
- Egress: about 100 requests per runtime-minute, scaling with the timeout. Async queue: 50 events per push, 500 events per minute, 200 KB per request.
- KVS: 240 KiB per value, 500-character keys, 4,000 reads and 4,000 writes per minute per installation in 10 KB units, no hard total cap (billed beyond a free allowance).
- Design consequences: `src/job.ts` batches under both budgets; `src/ledgerStore.ts` keeps one small entry per key.
- Optional real gate: `jira:workflowValidator` (preview) blocks an issue transition and shows an error message. It should read a cached check result. Unverified.

## Atlassian MCP (`rovo:mcp`), researched 2026-11-02
- Preview. One `rovo:mcp` module per app, up to 50 tools, and a tool is just an `action` key, so the same two actions can also back a `rovo:agent` (Best Agents bonus).
- External client access is OFF by default: a site or org admin must enable it per installation. Endpoint `https://mcp.atlassian.com/forge/<appId>`, OAuth 2.1, calls run with the invoking user's permissions. The Forge CLI must be new enough to know the module.
- Docs conflict on per-tool admin toggles (an RFC says yes, the manifest reference only mentions the per-installation toggle). Older posts say Rovo Studio only; that predates external clients.
- Agents run by automation rules will not call CREATE/UPDATE/DELETE/TRIGGER actions, so our tools are GET only.
- Risks: judges must enable external access to see it (core app must work without it); tool output carries wiki text into an LLM, mitigated in `src/tools.ts` but not eliminable; handler signature and `asUser` behaviour inside action functions unverified.
