# Limits, budgets and failure behaviour

Every limit below is a constant in the code. Where a limit is hit, the app says so; it never reports a clean result for something it did not check.

## Per check (the Jira panel)
| Limit | Value | When it is hit |
|---|---|---|
| Linked pages read per work item | 5 | The best-ranked five are read. The panel names the pages it read. |
| Other tickets a page cites (R6) | 5 | Only the first five are read; unreadable ones are skipped. |
| Ticket description read for R8 to R10 | first 6,000 characters | The rest is not compared. |
| Page text quoted in evidence | the matching line only, never the whole page | The audit chain keeps at most 200 characters of it. |
| Fix proposals | one line, version references only | Anything else gets "No automatic edit". |

## Project overview and weekly scan
| Limit | Value | When it is hit |
|---|---|---|
| Items on the overview page | 20 most recently updated open epics and in-progress items | The page says the project has more. |
| Time and request budget, overview | 20 seconds, 60 requests | Items not reached are listed as "Not checked: not reached before the budget ran out". |
| Weekly scan | the 20 most recently updated open epics **across the whole site**, 40 seconds, 80 requests | On a busy site the scan covers only those 20, so a project's weekly numbers may cover few or none of its epics. The overview says "no open epics in this project were checked" in that case. |

## Custom rules
| Limit | Value |
|---|---|
| Rules per site | 10 |
| Phrase length | 3 to 80 characters |
| Matching | plain text, ignoring case; first matching line per page; history-worded lines skipped |
| Where they run | the panel, the gate, the soft gate, the weekly scan, the agent and MCP tools. Not the Confluence byline. |

## Gate mode and pilot report
Watch only changes only the answer the validator gives (always allow) and adds one counter; findings, the panel and the soft gate notices are unchanged. The pilot report holds counts only and is built on demand for an administrator; it is not stored.

## Review marks
One mark per finding id, at most 30 ids read per panel load, counts capped at 100,000 per rule. A finding whose evidence changes gets a new id and so a new mark.

## Overview extras
| Item | Behaviour |
|---|---|
| Run the weekly scan now | Administrators only. Same 20-epic site-wide limit and 40 second budget as the scheduled scan. Scheduled triggers run once per installation and storage is per installation, so the scheduled result can land in the other product; this button saves it where the overview reads it. |
| Minutes per fix | 1 to 240, set by an administrator. Blank means no hours figure is shown. |

## Agent and MCP tools
| Limit | Value |
|---|---|
| Work items per `scan-issues` call | 10 |
| Time and request budget per call | `scan-issues`: 40 seconds, 80 requests. `project-brief`: 22 seconds, 100 requests, so it fits inside the default function timeout. Items not reached are reported as unchecked. On a large project the brief can still stop before the last items. |
| Quoted text | flattened to one line, 160 characters, and marked as data to report, never instructions |

## The gate and the soft gate
| Behaviour | Value |
|---|---|
| Validator live-check budget | 6 seconds. Slower means the transition is **allowed**. |
| Cached "all clear" | trusted for 5 minutes. A cached block is re-checked live when possible and the live answer wins. |
| Failure | Fails open. Any error, timeout, unreadable page or missing data allows the transition. |
| Soft gate | One notice comment per distinct set of blockers on a work item. It cannot stop a transition. Any error ends the run without a comment. |
| Emergency off | the `SAME_PAGE_KILL` variable turns off the gate, the soft gate and the scan. |

## Atlassian rate limits
A 429 from Jira or Confluence stops the run. The panel and tools say Atlassian is rate limiting the app and to try again. Nothing is cached as a result.

## Storage
Forge storage holds small records only (triage, counters, one audit entry per applied fix, rule severity settings, soft-gate markers, one weekly summary). The audit chain grows by one entry per applied fix, and verifying it reads each entry once, so the Audit trail view is slower on a very long chain.

## What happens at scale
- A site with hundreds of epics: the overview and the weekly scan show only the most recently updated 20. Use the panel on a specific work item for the rest.
- A work item linked to many pages: only the best five are read.
- A very large page: the whole page is read for matching, but evidence quotes one line.

## What we have not measured
We have not load tested the app. The limits above are budgets chosen to stay inside Forge's function time limits, and they were exercised on small sites only.

## Change notices and linking
| Item | Behaviour |
|---|---|
| Change notice | Fires on an edit to the summary or description only, once per distinct set of contradictions, and not when the same event moves the item to Done. It runs as the app and may read pages the editor cannot, which is why it names no page text. |
| Link a page | One page address at a time, on the same site only, and only if the person can read it. |
| Number words | Fixed phrases and number words right before a unit ("thirty minutes", "half an hour", "1h30m", "an hour and a half"). Looser wording ("a short while") is not read. |
