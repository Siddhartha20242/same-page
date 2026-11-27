# Three-minute demo script

Each beat names the criterion it serves. Use the production demo site, generated or seeded data only, and say so on screen where it is not a real team's data.

| Time | Show | Say | Criterion |
|---|---|---|---|
| 0:00 to 0:25 | A runbook that says 30 seconds, a ticket that says 10 | "At 2 AM an on-call engineer follows a runbook the epic outgrew three sprints ago. Nobody compared the two." | Impact |
| 0:25 to 1:05 | The panel on the seeded epic: stale version, token expiry, deprecated decision, each with the page's line beside Jira's. Then `node scripts/demo-silent.mjs`: one flagged, seven left alone | "Fixed rules, no model. It is quiet unless it can prove a contradiction." | Technology, Innovation |
| 1:05 to 1:40 | Move the epic to Done: the validator refuses and names the rule. An admin overrides with a written reason | "The check is part of the workflow. The override needs a reason and is recorded." | Design, Impact |
| 1:40 to 2:05 | Apply the verified one-line fix; open the Confluence page history, version 2 changed one line | "A person applies it. Same Page checked it changes nothing but the version." | Design |
| 2:05 to 2:30 | Audit trail tab: chain intact. `node scripts/demo-tamper.mjs`: change one field, verification fails at that entry | "Tamper-evident, not tamper-proof: someone with storage access could rewrite the whole chain." | Technology |
| 2:30 to 2:50 | Rovo: "Can I trust the runbook for this work item right now?" Then the what-if: "What would break in the docs if this moved to v3?" | "Agents and MCP tools call the same read-only checks and show their evidence." | Innovation, Technology |
| 2:50 to 3:00 | The end card | "No real team has used it yet. The marks buttons are how a pilot measures it." | Presentation (honesty) |

Do not say: that it would have prevented any named incident, that it checks steps or process, that it finds namespaces or owners it was not told about, or that a third-party client has called the MCP endpoint (not recorded yet).
