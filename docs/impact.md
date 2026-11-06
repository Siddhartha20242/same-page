# Impact: what we can show, and what we cannot

## What we have
No real team has used Same Page, so we have no measured result and no figure for time saved or incidents avoided. We are not going to estimate one for you.

## What the app measures itself
On every site it counts, with no page text, titles or names:
- contradictions found (each counted once, the first time it is shown),
- fixes applied to a page,
- review tasks sent to a page owner,
- findings dismissed and snoozed,
- transitions the gate refused.

These appear on the project overview page ("What Same Page has done on this site"), and in the audit trail. The Rovo audit agent and the MCP `impact-summary` tool report the same numbers.

## Precision from real use
Every finding in the panel has two buttons: "Yes, it is real" and "No, false alarm". A mark is counted once per finding (changing it replaces the old one) and stored as a count per rule, with no page text, titles or names. The overview page shows the total (for example "10 findings reviewed by your team: 8 real, 2 false alarms (80% real)"), the Rules list and the agents show it per rule, and below 10 marks the line says the sample is too small to say anything. A mark never hides or changes a finding.

## Trying it without risk, and reporting back
The gate has a **watch only** mode: it allows every transition and counts the ones it would have refused, so a team can see what enforcing would have done before it decides. An administrator can also produce a **pilot report**, a plain-text summary of the counts, the real and false-alarm marks per rule and the caveats, with no page text, keys or names. A pilot team can paste it into a message, and we can quote it without exposing their content.

## The one figure that needs a person
A Jira administrator can type how many minutes one applied fix saves. Only then does the page show an hours figure, worded as their own estimate times the number of fixes. Until then it says no figure is set. This gives a pilot team a way to state a number they stand behind, and keeps the number out of our hands.

## The honest case for potential impact
- The pain is common: a runbook, decision page or spec that no longer matches the work item that changed it. Public downtime-cost surveys put an hour of downtime above $300,000 for most larger enterprises, but no survey we found isolates outages caused by stale documentation, so we claim no saving.
- The mechanism is cheap to adopt: it reads pages already linked to or titled like a work item, needs no target version for the number and date rules, and the gate is optional.
- The reach is bounded: it covers Jira and Confluence content only, and the gate needs a company-managed project and an administrator.

## What would turn this into evidence
One to three teams run it for one to two weeks and mark every finding real or false alarm in the panel ([pilot-kit.md](pilot-kit.md)). The counters above give the volume, the marks give precision, and the administrator's minutes give their own time-saved figure. Below about 10 labelled findings we would say so.
