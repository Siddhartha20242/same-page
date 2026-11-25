# Accuracy on authored wording

This page reports what we measured and what it does not show. Every case was written by the authors. None comes from a real site, and no real team has used the app, so these are not real-world accuracy figures.

## What was run

- `fixtures/realistic.ts`: 40 pairs (20 true contradictions, 20 consistent or not a contradiction) written to read like runbooks and tickets rather than to match the rules' own phrasing.
- `fixtures/heldout.ts`: 30 more pairs, written after the engine had been tuned on the first set and run once before any change.
- `fixtures/heldout2.ts`: 30 more, written after the second set had been fixed and run once before any change.
- `node scripts/realistic-report.mjs` prints the score. `test/realistic.test.ts` fails on any false alarm.

## Results

| Run | Cases | Precision | Recall | What it tells you |
|---|---|---|---|---|
| First set, first run, before any fix | 40 | 0.67 | 0.60 | The engine had 6 false alarms and 8 misses on wording it had not been shaped for |
| Held-out set, first run, before any fix | 30 | 0.86 | 0.40 | The honest number: 1 false alarm and 9 misses on unseen wording |
| Second held-out set, first run, before any fix | 30 | 1.00 | 0.67 | 0 false alarms and 5 misses on unseen wording. Recall on unseen wording rose from 0.40 to 0.67 between rounds, but the sets are small and the second round benefited from the first round's fixes |
| All three sets, after fixing what they showed | 100 | 1.00 | 0.84 | A regression guard. The engine was tuned on these cases, so this is not a measurement |

## What changed because of it

- A different qualifying word on each side ("audit log retention" and "application log retention", "password reset link" and "invite link") now means two different things.
- Named settings such as "Max retries is 3" and "Connection pool size: 20" are read when the subjects are identical.
- Past states ("was 60s before the rewrite", "in 2024 we kept backups for 7 days") and past-tense milestones ("started on") are skipped.
- "Between 1 and 10 minutes" is a range. Years count as a unit. "Deprecation date" and "migration deadline" lines are read as plans, not history.
- A "release freeze" date and a "code freeze" date now meet.
- Round two: "retained" and "kept" meet, a port is compared only when the lines name the same subject, and "Page size: 500" meets "100 items".

## What it still misses (8 of 100)

All six need real meaning, so a fixed rule cannot reach them without guessing: "logged out" versus "signed out" with no shared noun, "60 requests per minute" versus "make 600 requests", a job named on one line and its limit on the next, two services on different ports, "canary" versus "rollout", "Lambda" versus "function", and "upload limit" versus "each file may be up to". We leave them as misses because guessing would add false alarms, and a false alarm costs more here than a miss.

## What this does not show

The sets are small and written by the people who built the rules. A real team's pages will phrase things in ways we did not think of. Recall on real documents could be far lower than 0.83. The pilot in [pilot-kit.md](pilot-kit.md) is the only way to get a real figure.
