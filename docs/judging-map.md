# Judging map: where to see each criterion

One page for a judge with ten minutes. Each row says what we claim, where to see it, and what we have not shown. Nothing here is an estimate of accuracy or time saved; no real team has used Same Page yet.

## Technological implementation
| Claim | Where to see it | Not shown |
|---|---|---|
| Detection uses fixed rules and no model, so a finding repeats and can be explained | [README: Why detection has no model](../README.md#why-detection-has-no-model); `src/engine.ts`, `src/rules.ts` | Accuracy on real documents (unmeasured) |
| A fuzz test feeds 3000 seeded random pairs through the engine and checks it never throws, never mutates input, and gives the same answer twice | `test/fuzz.test.ts`. It found a real crash (words like "constructor"), now fixed | Fuzzing covers the engine, not Confluence or Jira I/O |
| The gate fails open: if Same Page errors, the move is allowed | `src/gate.ts`, [docs/gate-setup.md](gate-setup.md) | |
| The audit log is hash-chained, and anyone can check an export without the app | Run `node scripts/demo-tamper.mjs` (offline, generated data). Change one field and the check fails at that entry | It is hash-linked, not signed, so it does not prove who wrote an entry |
| A suggested edit is applied only if it changes nothing but the version references on that line and lands where proposed | `src/propose.ts`, `src/apply.ts` | |
| Five Rovo agents and one MCP module (9 tools) | `same-page-app/manifest.yml`, [docs/agent.md](agent.md), [docs/mcp.md](mcp.md) | A signed-in call from a third-party MCP client |
| Runs on Atlassian: the manifest declares no external egress | `same-page-app/manifest.yml` | |
| 415 tests, type check, and a guard that fails if the panel bundle imports Node-only code | [docs/tests.md](tests.md), CI badge | |
| Accuracy on 100 authored pairs: first runs on unseen wording 0.86 / 0.40 and 1.00 / 0.67, then fixed | [docs/accuracy.md](accuracy.md), `test/realistic.test.ts` | Any real site. The cases are ours |

## Design
| Claim | Where to see it | Not shown |
|---|---|---|
| The panel shows the page's own line next to Jira's own field, so a person decides from evidence | [Finding card](images/finding-card.png) | Usability testing with real users |
| Worst items first, with a headline on each row; each item is counted once by its most serious finding | Project overview tab | |
| The gate message names the rule and carries the same evidence id the panel shows | [Gate refusal](images/gate-refusal.png) | |
| Severity and selection are written as text, not color alone; Atlassian themes including dark mode come from UI Kit | [docs/accessibility.md](accessibility.md) | A formal accessibility audit; not every flow was tested by keyboard alone |

## Potential impact
| Claim | Where to see it | Not shown |
|---|---|---|
| The pain is common: a runbook, decision page or spec drifts from the work item that changed it | [docs/impact.md](impact.md), [docs/business-case.md](business-case.md) | Any measured saving, or how often drift happens on real sites |
| A team can try it with no risk: watch-only gate, nothing written until a person approves | [docs/pilot-kit.md](pilot-kit.md) | A real pilot |
| Real and false-alarm buttons on every finding give a precision number, and the pilot report holds no page text | `src/pilotReport.ts`, [docs/impact.md](impact.md) | Any real marks |

## Innovation
| Claim | Where to see it | Not shown |
|---|---|---|
| CI for documentation truth: a ticket states facts, pages repeat them, the check fails when they disagree, and it can stop a transition | [README: What it is](../README.md#what-it-is) | We claim no "first"; see [docs/prior-art.md](prior-art.md) |
| Agents can ask before they act, and receive a receipt that says what ran and never says the docs are correct | [docs/agent.md](agent.md), `src/tools.ts` | |
| What-if: ask what a version change would break before making it. The same rules run on the change that has not happened yet | `node scripts/demo-whatif.mjs` (offline, generated data); `src/whatIf.ts`; the `what-if-version` tool | Not yet seen on a live site |
| The tool only proves and a person approves; new rules start hidden (Draft), then Warning, then Blocker | [README: What it is](../README.md#what-it-is) | |

## Presentation
| Item | Where |
|---|---|
| Ten-minute path with no install | [README: Try it](../README.md#try-it) |
| Tamper check, offline | `node scripts/demo-tamper.mjs` |
| Verified on a real site, with dates | [docs/live-results.md](live-results.md) |
| Limits, stated plainly | [docs/limits.md](limits.md) |
| Demo video | Linked on the Devpost page |
