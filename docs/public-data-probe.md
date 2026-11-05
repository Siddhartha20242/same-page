# Public-data probe (Apache Kafka wiki and Jira), 2026-10-31

Script: `scripts/public-study.mjs`. Read-only, public APIs, no login, one request per second, small sample.
Direction: wiki page, then issue keys in its source (macros included), then the issue, then the engine.

## What was run
| Run | Pages | Page-issue pairs | Issues with a derivable target | Page older than issue resolution | Findings |
|---|---|---|---|---|---|
| Most recently edited pages, Fix Version as target | 30 | 41 | 7 | 0 | 0 |
| Oldest pages, Fix Version as target (before fixes) | 50 | 30 | 11 | 7 | **1, a false positive** |
| Same oldest pages, after fixes | 50 | 30 | 0 | 0 | 0 |

## What it showed
- The only finding was wrong, for two reasons now fixed: Fix Version `0.8.2.0` was read as API `v0`, and a patch filename
  (`KAFKA-1000-v1.patch`) was read as a version reference. Pre-1.0 versions and filenames are now rejected, and Fix Version is
  an opt-in source because it usually names a product release rather than an API version.
- Recently edited pages are never stale relative to the issues they cite, so the staleness test correctly stayed quiet.
- Searching the wiki by issue key found almost nothing for recent issues: pages reference issues through Jira macros, not text.

## What it did NOT show
- **No precision or recall number for our intended use.** Open-source projects have release numbers, not a dedicated API-version
  field, so after the fixes there was nothing left to check. This probe cannot support a claim like "N confirmed contradictions
  across M real pages", and we must not make one from it.
- One project, a small sample, and a different product shape (Server, not Cloud).

## What would give a real number
A pilot on a team that tracks an API version in a field or the issue summary and keeps runbooks in Confluence,
reviewed by hand: report true findings, false alarms, and issues that could not be checked.
