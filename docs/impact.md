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

## The one figure that needs a person
A Jira administrator can type how many minutes one applied fix saves. Only then does the page show an hours figure, worded as their own estimate times the number of fixes. Until then it says no figure is set. This gives a pilot team a way to state a number they stand behind, and keeps the number out of our hands.

## The honest case for potential impact
- The pain is common: a runbook, decision page or spec that no longer matches the work item that changed it. Public downtime-cost surveys put an hour of downtime above $300,000 for most larger enterprises, but no survey we found isolates outages caused by stale documentation, so we claim no saving.
- The mechanism is cheap to adopt: it reads pages already linked to or titled like a work item, needs no target version for the number and date rules, and the gate is optional.
- The reach is bounded: it covers Jira and Confluence content only, and the gate needs a company-managed project and an administrator.

## What would turn this into evidence
One to three teams run it for one to two weeks and label every finding real or false alarm ([pilot-kit.md](pilot-kit.md)). The counters above give the volume, the labels give precision, and the administrator's minutes give their own time-saved figure. Below about 10 labelled findings we would say so.
