import { readCounts } from './metrics.ts';
import type { Counts, MetricStore } from './metrics.ts';
import { loadReviewCounts, reviewSummary } from './review.ts';
import type { ReviewSummary } from './review.ts';

// What Same Page has done on THIS site, from counters it keeps itself (see metrics.ts). Counts only, no page text, titles or names.
// Time saved is never invented: it is shown only after a site administrator types how many minutes one applied fix saves, and it is
// labelled as their estimate. A site that has not set it sees the counts and no hours figure.

const KEY = 'impact:minutesPerFix';
export const MAX_MINUTES = 240;

export interface ImpactStore extends MetricStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
export interface Impact {
  counts: Counts;
  minutesPerFix: number | null;
  /** applied fixes x minutes per fix, in hours, rounded to one decimal. Null until the administrator sets minutes. */
  estimatedHoursSaved: number | null;
  line: string;
  /** What the team marked real or false alarm. Counts only. */
  review: ReviewSummary;
}

export async function loadImpact(store: ImpactStore): Promise<Impact> {
  const counts = await readCounts(store);
  let minutes: number | null = null;
  try { const v = Number(await store.get(KEY)); if (Number.isFinite(v) && v > 0 && v <= MAX_MINUTES) minutes = v; } catch { /* unset */ }
  const hours = minutes === null ? null : Math.round((counts.applied * minutes) / 6) / 10;
  const parts = [`${counts.seen} contradiction${counts.seen === 1 ? '' : 's'} found`, `${counts.applied} fixed on the page`, `${counts.reviewTasks} sent to a page owner`, `${counts.dismissed} dismissed`, `${counts.gateBlocks} transition${counts.gateBlocks === 1 ? '' : 's'} refused`];
  const line = parts.join(' · ');
  return { counts, minutesPerFix: minutes, estimatedHoursSaved: hours, line, review: reviewSummary(await loadReviewCounts(store)) };
}

export async function setMinutesPerFix(store: ImpactStore, raw: unknown): Promise<{ ok: true } | { ok: false; reason: string }> {
  const v = Number(String(raw ?? '').trim());
  if (!Number.isFinite(v) || v < 0 || v > MAX_MINUTES) return { ok: false, reason: `Enter a number of minutes from 0 to ${MAX_MINUTES}. Use 0 to clear it.` };
  await store.set(KEY, v === 0 ? null : Math.round(v));
  return { ok: true };
}
