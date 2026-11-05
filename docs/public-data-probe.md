# Public-data probe: five Apache projects, hand-labelled

Runs on 2026-11-05 (Kafka earlier, on 2026-10-31). Script: `scripts/public-study.mjs`. Raw output: `study/<PROJECT>.json`. Hand labels: `study/labels.json`.

Headline: across 141 wiki pages and 287 page-issue pairs from four projects that had data, the engine produced 3 findings. All 3 are false positives. It produced no true finding, so there is no precision figure to be proud of: 0 of 3. With the earlier Kafka run the total is 0 true of 4. In 80 hand-read non-findings I found no missed contradiction and 2 unclear lines.

## What was run

Rules of engagement: GET only, no login or credentials, one request per second in total, a plain User-Agent, stop on HTTP 429 or 403 (none occurred). The script made 309 requests; I made a few dozen more by hand to check endpoints and read context for labelling.

Method: wiki page, then the issue keys in its source text (at most 4 per page), then the issue (status, changelog), then `check()` from `src/engine.ts` with every built-in rule. Sample: up to 30 pages that contain an issue key from the oldest edits and up to 30 from the newest, found by reading up to 150 page bodies per order. Engine inputs built from real data: status (Jira status category mapped to Done, To Do, In Progress), time of the last status transition from the changelog, and the status of every other key on the page (for R6). An API version for R1 came from the summary or components (the engine default) and, separately, from Fix Version (an opt-in source).

Endpoint checks before building (anonymous, all answered with JSON unless noted):
- Used: `cwiki.apache.org` Confluence REST with `issues.apache.org/jira` REST, for Hadoop, Cassandra, Flink, ZooKeeper, Spark and (earlier) Kafka.
- Dropped: Hive. The space exists, but the CQL search returned 0 pages, so there was nothing to read.
- Verified but not used: `jira.atlassian.com` and `confluence.atlassian.com` answered anonymously, but the Confluence site is product documentation, not runbooks that cite issue keys. `issues.jenkins.io` answered; `wiki.jenkins.io` redirected (301) and I did not follow it. Spring was not tried.
- Spark answered but only 1 page in the first 44 contained a Spark issue key, so it adds nothing.

## Results per project

| Project | Pages with keys | Pairs (page, issue) | Pairs with a status transition | Page older than that transition | Pairs with an R1 target from summary/components | R1 target from Fix Version (opt-in) | Findings | True | False | Unclear |
|---|---|---|---|---|---|---|---|---|---|---|
| Hadoop | 26 | 59 | 54 | 9 | 0 | 20 | 1 | 0 | 1 | 0 |
| Cassandra | 46 | 85 | 71 | 20 | 0 | 43 | 1 | 0 | 1 | 0 |
| Flink | 52 | 105 | 89 | 34 | 0 | 51 | 1 | 0 | 1 | 0 |
| ZooKeeper | 16 | 37 | 23 | 8 | 0 | 19 | 0 | 0 | 0 | 0 |
| Spark | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total (new)** | **141** | **287** | **238** | **71** | **0** | **133** | **3** | **0** | **3** | **0** |
| Kafka (earlier run, older script) | 30 and 50 | 41 and 30 | not recorded | 0 and 7 | 0 | 7 and 11 | 1 | 0 | 1 | 0 |

Precision: 0 true of 3 findings (0%), sample of 3, so the interval is wide; the honest reading is "no evidence of any true finding".

## The false positives, and which rule produced each

1. **Hadoop, R6 (cited ticket closed), warn.** Page "Hadoop 3 release status updates", line "HDFS-11467: Waiting on HDFS-12682, I asked if we can work concurrently". The line is in the dated 2017-10-31 entry of a status log; HDFS-12682 was resolved on 2017-11-03. It was true when written. The page was edited on 2017-12-15 elsewhere, so the rule fired on a historical log entry. Unlike R4, R6 does not compare the page's last edit with when the cited ticket closed.
2. **Cassandra, R1 (version mismatch) via Fix Version, info.** Page "CEP-37", line "...any feedback ... about the interface or v1 implementation features". "v1" is the first iteration of a proposal, not an API version, and the "v6" target was read from a Fix Version for a release. Only an info note, because "migration" wording sits on the line.
3. **Flink, R1 (version mismatch) via Fix Version, block.** Page "2.3 Release", line "| V1 is done, and spilling logic will be optimized later | 100%". "V1" is a delivery phase; the issue is an unstable-test ticket with Fix Version 2.3.0, from which "v2" was read. This one would block a transition if Fix Version were enabled, so it is the worst of the three.

Both R1 false positives exist only because Fix Version was switched on for the probe. The engine default (summary or components) found no target on any of the 287 pairs, so R1 did not run at all in default mode.

## What the engine missed

In a seeded random sample of 20 non-finding pairs per project (80 in total, all read by hand), I found no contradiction the engine should have caught. Two lines are unclear (the sample is stored with only a 200-character snippet):
- CASSANDRA-18137 on "Build Lead": a long CI note citing a ticket resolved in 2025 while the page was last edited in 2023; the snippet does not show whether the page calls it open.
- ZOOKEEPER-1430 on "HowToRelease - OUTDATED!": the page says the process changed and the docs are not updated, linking a ticket closed in 2014. That is a page contradicting itself; no rule covers it.

This is a weak miss estimate: 80 pairs, one reader, and most sampled lines are plain references ("JIRA: KEY", a list, a link) that make no claim about status at all. A miss rate of 0 of 80 says misses are not common in this material, not that the recall is high.

## Why the numbers are what they are

- **R1 had nothing to read.** Open-source Jira has no API-version field, and summaries and components almost never carry one. Zero of 287 pairs gave a target in default mode.
- **R4 and R6 had few chances.** Wiki pages in these spaces are mostly design proposals, meeting notes and release trackers that cite a ticket as a link or a title, not as a status claim ("X is planned", "waiting on X"). I did not count how many lines were status claims, so I do not claim a rate. R2, R3 and R5 need page labels, required fields or an OpenAPI page, none of which exist in this data and none were exercised.
- **Time matters.** 71 of 238 pairs had a page older than the issue's last transition, which is the precondition for R1 and R4, so staleness itself is common; contradiction wording is rare.
- **Public wikis keep dated logs.** The one R6 false positive is a pattern: a status log that is correct per entry date.

## What changed afterwards

After this probe, rules R4 and R6 ignore a line that carries a date before the ticket key (a dated log entry such as "2017-10-31: waiting on HDFS-12682" is history, not a claim). That removes false positive 1 and is covered by a test. The two R1 false positives are unchanged: Fix Version stays opt-in and off by default.

## A further tweak that was considered and not applied

`src/rules.ts` was not edited. R6 should skip a cited ticket whose closing time is at or before the page's last edit, as R4 already does for the work item. That needs the closing time in `cited` (`{ status, changedAt }`, filled where `loadCited` in `src/release.ts` and the probe build it) and, in `citedTicketClosed.run`, before the line scan: `if (cited[key].changedAt && new Date(page.modifiedAt) >= new Date(cited[key].changedAt)) continue;`. It would have silenced finding 1 (page edited 2017-12-15, ticket closed 2017-11-03). The cost: a page edited for an unrelated reason after the ticket closed would no longer be flagged, so some real stale lines would go silent. For the two R1 findings, the existing rule is "Fix Version is opt-in"; the evidence here is that it should stay off by default and that bare `V1` or `v1` near words such as "implementation", "phase", "done" or "iteration" is not an API reference, but I have no safe one-line change for that.

## Honest conclusion

This probe does not show that the engine works, and it does not show that it fails on its intended use. What it shows is narrow: on 141 public Apache pages, the engine's default settings produced no finding and could not even derive an R1 target; the opt-in and R6 paths produced three findings, all wrong. Public Apache data is not a pilot. These teams do not track an API version in a field, their wikis are mostly design and meeting records rather than runbooks, the pages are not written to be kept in step with tickets, and the engine is built for a team that does. Samples are small (1 to 52 pages per project, one labeller, 80 non-findings read), and pages were chosen as ones that already contain a key, from the oldest and newest edits, which is not random. The result I would stand behind is that the engine is quiet on documents that give it no hard facts, and that the two paths that do fire here (Fix Version as a version source, and R6 on dated logs) are not safe to rely on without the tweaks above. A number for the real use case still needs a pilot on a team that records an API version and keeps runbooks in Confluence, with findings reviewed by hand: true findings, false alarms, and issues that could not be checked.

## Reproduce

`source ~/.nvm/nvm.sh && nvm use 24.22.2 && for p in HADOOP CASSANDRA FLINK ZOOKEEPER SPARK; do node scripts/public-study.mjs $p 30 1; done` (about 6 minutes at one request per second; data on the live sites will have moved, so exact counts will differ). The Kafka row comes from the earlier version of the script and its files `study/KAFKA.json` and `study/KAFKA-fixVersion.json`.
