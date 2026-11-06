# Pilot kit: getting real numbers instead of claims

There is no real-world usage data for Same Page yet. This kit is how to get some in 1 to 2 weeks with 1 to 3 teams. Do not report
results you did not collect, and do not call the demo data a pilot.

## What a team needs
- Jira Cloud + Confluence Cloud, and a project where epics or work items carry an API version (in the summary, a component, or set from
  the panel: "Save target version").
- Someone who can install a Forge app (Jira and Confluence admin) and accept the consent screens.
- For the gate only: a company-managed project and a Jira admin (see gate-setup.md). The panel alone needs neither.

## Setup (about 20 minutes)
1. Install from the installation link (or `forge install` for each product).
2. On three real work items that already have linked runbooks or decision pages, open **Same Page** (the puzzle icon under the work
   item title) and click Save target version if it asks.
3. Optional: attach the gate to the Done transition of one project.

## What is counted automatically
Open any work item, **Same Page** > **Audit trail**. The panel shows, for that site:
`finding(s) shown · fix(es) applied · dismissed · snoozed · review task(s) · transition(s) blocked`.
These are plain counters in the app's own storage. They hold no page text, titles or names. Applied fixes are also sealed in the audit
chain, which you can re-verify with `node scripts/verify-receipt.mjs`.

## What you still have to ask people (the counters cannot)
Each finding in the panel has "Yes, it is real" and "No, false alarm" buttons, so the first row below is recorded by the app as people work. Record the rest per finding, in a spreadsheet, with the person's own words:
| Question | Why |
|---|---|
| Was this a real contradiction, or a false alarm? (yes / no / unsure) | the only honest precision number |
| If real: would the page have misled someone? How? | impact |
| Did you apply the fix, fix it by hand, or ignore it? | adoption |
| Did the gate stop anything you were glad it stopped? Anything it should not have? | the gate's value and its false positives |
| How long did this take to check by hand before? | time saved, in the user's estimate |

## How to report it
- Report counts and the precision from the "real contradiction?" answers with the sample size ("7 of 9 shown findings were real").
- Report false positives and misses plainly, and which rule they came from.
- Quote people only with their permission. Say how many teams and how many days. If it is one team for one week, say that.
- Keep this separate from the seeded demo data, which is created by the app and proves nothing about real usage.

## Sample size to aim for
Even 20 to 30 reviewed findings across 2 or 3 teams is enough to say something honest about precision. Below about 10, say so.
