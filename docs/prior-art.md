# Prior art: what exists, and what Same Page does differently

Written 2026-11-09 from public pages and a handful of searches. It is not an exhaustive survey and I did not use any of these products, so descriptions are what their own pages or the search results say, and vendor claims are unverified.

## What I found
**Stale-page tools on the Atlassian Marketplace** judge a page by age or activity, not by what it says:
- [Stale Page Finder for Confluence](https://marketplace.atlassian.com/apps/284465269/stale-page-finder-for-confluence): flags pages by last-modified age, with bulk labelling and CSV export.
- [Stale Content Auditor for Confluence](https://marketplace.atlassian.com/apps/1040161133/stale-content-auditor-for-confluence): buckets pages as fresh, aging or stale against thresholds the admin sets.
- [Page Review Manager for Confluence](https://marketplace.atlassian.com/apps/2847619197/page-review-manager-for-confluence): reviews stale pages with owners, reminders and linked Jira follow-up.
- [StagBane, Page Health Auditor](https://marketplace.atlassian.com/apps/1110488446/stagbane-page-health-auditor-for-confluence): bands pages as critical, stale, watch or healthy from rules over age, ownership, review state and broken links.

**Atlassian's own approach** is Automation rules that label or archive pages after a period of inactivity, and a community post describes one that creates a Jira work item for review ([Atlassian Community](https://community.atlassian.com/forums/Confluence-Cloud-Admins-articles/Keeping-Confluence-Content-Fresh-with-Automation/ba-p/3024065)). Again the trigger is age.

**Past Codegeist winners in nearby territory** (from the public galleries; I read their one-line descriptions and a few full pages, not their code): Runbook Rabbit (2024, runbooks surfaced for Jira agents), Sherlock Sync (2025, documentation kept current from code changes), Immutable Ledger for Jira (2025, hash-chained audit) and Sync for Confluence (2025). So judges have rewarded documentation, runbook and audit apps before.

## What I did not find
In these searches I did not find an app that compares what a page says (a version, a number, a date, a status) with the fields of a Jira work item and reports the disagreement. That is a statement about my searches, not proof that none exists, and a Marketplace search for "documentation consistency" or "content drift" was not done.

## What Same Page does differently (and where it is narrower)
| | Age and activity tools | Same Page |
|---|---|---|
| What triggers a flag | A page is old or untouched | A page line and a Jira field disagree (for example v1 against v2, 30 minutes against 1 hour) |
| Evidence shown | A date | The page's own line beside Jira's own value, with a short evidence id |
| Can it stop a release step | No | Yes, a workflow validator can refuse a transition (fails open, with a watch-only mode) |
| Record | Usually none | A hash-chained audit trail of findings and how they were handled |
| How it decides | Thresholds | Ten fixed rules plus admin-written rules; no model in detection |

Where it is narrower, on purpose or by limit:
- It finds only the contradictions its rules describe. A disagreement worded differently enough is missed.
- It can say two sources disagree, not which one is right.
- It reads pages linked to a work item, or pages that name a work item; it is not a general staleness audit, so it is complementary to the age-based tools above, not a replacement.
- It has no real-world accuracy figure yet: no outside team has used it.

## Still to research (so I do not overclaim)
- A Marketplace search for contradiction, consistency and drift tools.
- Whether any of the apps above has added Jira-field comparison since the pages I read.
