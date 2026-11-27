# Agent firewall (design and offline core)

Status: the decision logic is written and tested offline (`src/firewall.ts`, `test/firewall.test.ts`, `node scripts/demo-firewall.mjs`). It is not wired into the Forge app and has not touched a real site. Nothing here is claimed as working in Jira.

## What it is for

AI agents can now change Jira and Confluence through Rovo and MCP. A batch such as "close all old tickets" has no check in front of it, no approval and no clean undo. The firewall puts fixed rules in front of a batch of proposed changes, asks a person to approve what is risky, records what was applied in the same tamper-evident chain as the evidence log, and can put values back.

## What the core does

- Four fixed rules: a batch larger than 20 changes needs approval and larger than 200 is refused; some fields are never changed; protected projects need approval; moving work out of Done or Released needs approval. No model is involved, so the same batch always gets the same answer.
- A readable preview, counts first, so 180 changes can be judged at a glance.
- Partial approval: a person approves some changes, and the rest are held back.
- A journal and an undo plan that only reverts a field that still holds the agent's value. A later human edit is reported, never overwritten.
- Every batch is sealed in the existing hash chain. The seal commits to the journal by hash and holds no issue text.
- A burst check that names whoever made many changes in a window.

## What the desk research found, and what it changes

- Forge's `avi:jira:updated:issue` event names the user who caused the change in an optional `atlassianId` field, and its changelog is reported to be missing or incomplete at times (Forge events reference; community reports).
- Atlassian's MCP server acts on behalf of the signed-in user, and Atlassian already records tool calls in its audit log (Atlassian support documentation).
- So a Forge app cannot tell an agent from a person, and cannot intercept a write an agent makes directly through Atlassian's own MCP server. "Detect agent actors" does not work.
- What can work: safe-write tools in our own MCP module (propose, approve, apply, undo) for agents that use them, and a burst watchdog that flags and offers to undo large changes by any actor after the fact. The honest claim is a control layer for agents that use it plus a watchdog for the rest, not a firewall that stops every agent.

## Not yet known

- Whether the changelog in a real event carries enough (from and to values) to build an undo journal for changes made outside our tools. Needs a test on a signed-in dev site.
- Whether Rovo agent actions appear in Forge events at all.
- Whether judges see enough beyond Atlassian's own audit log. The answer has to be prevention, approval and undo, which the audit log does not offer.
