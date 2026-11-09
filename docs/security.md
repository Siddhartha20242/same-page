# Security and data handling

A short summary for a reviewer. The full list of what is stored is in the [privacy policy](privacy-policy.md); how the gate behaves is in [gate-setup.md](gate-setup.md). Nothing here is a certification: there is none (see the end).

## Where data goes
- The app runs on Atlassian's Forge platform and its manifest declares no external network access. It does not call any server outside Atlassian, and the developer runs no server.
- Detection uses fixed rules. No model is called to find a contradiction. An optional model path for rewording one line exists but is off in the installed version.

## Who the app acts as
- Actions a person takes in the panel, and the Rovo and MCP tools, run as that person, so Jira and Confluence permissions decide what is read.
- The pre-ship gate and the pin check run without a signed-in user. Before the gate quotes a page it checks whether the person making the transition may read it, and it does not cache an all-clear from one person's view.
- The audit trail shows a work item's entries to anyone who can see that work item, and the latest entries across the site only to a Jira administrator.

## Handling untrusted text
Page text and work item fields are written by other people, so they are treated as untrusted.
- Anything quoted into a Rovo or MCP answer is flattened to one short line, stripped of control characters and backticks, capped, labelled as quoted data, and sent with a notice. The agent prompts tell the agent never to follow instructions found in quoted text. This lowers the risk of prompt injection; it cannot remove it.
- A project key and a fix version go into a Jira query, so both are checked against a strict pattern first (letters, digits, and for a version also spaces, dots, hyphens, underscores; at most 60 characters). Anything else is rejected before any search.
- OpenAPI specs found on pages are parsed with limits: a size cap, an alias cap, and a parser that never throws. A test feeds deeply nested YAML and requires that it is ignored quickly.
- Rows sent back by the overview page to continue a scan are re-checked for shape and size on the server.

## Safe by default
- The gate fails open: a bug or an outage never stops anyone's work.
- It can run in watch-only mode, which counts what it would have refused without refusing anything.
- A project administrator can break glass for one work item for 24 hours; the reason is recorded and sealed in the audit chain.
- An environment variable switches the gate off completely (`SAME_PAGE_KILL`).

## Audit integrity
Fixes and handling steps are written to a hash-chained log in Forge storage, with anchors that detect shortening or rewriting. Known limit: two writers appending at the same instant can, in a narrow window, lose one event; the chain stays valid ([limits.md](limits.md)).

## Permissions
The app requests Jira read and write work, Jira read user, Confluence read and write for pages, labels, content properties and permissions, Confluence search, and app storage. Each one's purpose is in the privacy policy. Two caveats a reviewer should know:
- Some write scopes exist only for the optional demo-data button (for example a label write). A hardened release could drop them; this one has not.
- Write scopes are used when a person clicks a button, with one exception: the app itself posts a short comment in three cases (a fixed page regressed, a work item was edited and now disagrees with its pages, or a work item moved to Done with a blocker open). Those comments name rules and a count, never page text.

## Dependencies
Checked with `npm audit` on 2026-11-08:
- The repository root: 0 vulnerabilities, after updating `yaml` to 2.9.1 to fix a stack-overflow advisory in deeply nested YAML.
- The Forge app folder: 17 findings (8 high, 9 moderate, none critical). Every one is in Atlassian's own `@forge/react` and `@forge/bridge` packages or their dependencies (for example the editor and link-detection libraries used by the UI Kit). The suggested fix is a major upgrade of `@forge/react` to version 12, which is a UI Kit migration that has not been done or tested here. Until it is, these remain.

## Tests and CI
378 offline tests run on every push in GitHub Actions. They cover the rules, the gate, the audit chain, the agent prompts, and the input checks above.

## What we do not have
No security certification, no third-party penetration test, no bug bounty. The app has not been listed on the Atlassian Marketplace, so it has not been through Atlassian's Marketplace security review.

## Reporting a problem
Write to 2282614@mbmc.edu.np. There is no formal disclosure program.
