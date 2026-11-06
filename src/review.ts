// Review marks: a person says whether a finding was a real contradiction or a false alarm. This is how real use turns into a precision figure.
// Stored as counters per rule plus one mark per finding id, so marking again changes the answer instead of counting twice.
// No page text, no titles and no names are stored, and nothing here hides, demotes or changes a finding.

export type ReviewVerdict = 'real' | 'false';
export interface ReviewStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
export type ReviewCounts = Record<string, { real: number; false: number }>;

const COUNTS = 'review:counts';
const markKey = (id: string) => `review:f:${String(id).slice(0, 64)}`;
const MAX = 100000;

export async function loadReviewCounts(store: ReviewStore): Promise<ReviewCounts> {
  try {
    const raw = (await store.get(COUNTS)) as ReviewCounts | null | undefined;
    const out: ReviewCounts = {};
    for (const [rule, c] of Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 60)) {
      out[rule] = { real: Math.min(MAX, Math.max(0, Math.floor(Number(c?.real) || 0))), false: Math.min(MAX, Math.max(0, Math.floor(Number(c?.false) || 0))) };
    }
    return out;
  } catch { return {}; }
}

export async function loadReviewMarks(store: ReviewStore, ids: string[]): Promise<Record<string, ReviewVerdict>> {
  const out: Record<string, ReviewVerdict> = {};
  for (const id of ids.slice(0, 30)) {
    try { const v = await store.get(markKey(id)); if (v === 'real' || v === 'false') out[id] = v; } catch { /* unmarked */ }
  }
  return out;
}

/** Records or changes one mark. A second mark on the same finding replaces the first in the counts. */
export async function markFinding(store: ReviewStore, { id, ruleId, verdict }: { id: string; ruleId: string; verdict: unknown }): Promise<{ ok: true; verdict: ReviewVerdict } | { ok: false; reason: string }> {
  if (verdict !== 'real' && verdict !== 'false') return { ok: false, reason: 'Choose real contradiction or false alarm.' };
  if (!id || !ruleId) return { ok: false, reason: 'That finding is no longer present. Refresh the panel.' };
  const prior = (await store.get(markKey(id))) as ReviewVerdict | undefined;
  if (prior === verdict) return { ok: true, verdict };
  const counts = await loadReviewCounts(store);
  const c = (counts[ruleId] ??= { real: 0, false: 0 });
  if (prior === 'real' || prior === 'false') c[prior] = Math.max(0, c[prior] - 1);
  c[verdict] = Math.min(MAX, c[verdict] + 1);
  await store.set(markKey(id), verdict);
  await store.set(COUNTS, counts);
  return { ok: true, verdict };
}

export interface ReviewSummary { real: number; false: number; total: number; realPercent: number | null; line: string }

export function reviewSummary(counts: ReviewCounts): ReviewSummary {
  const real = Object.values(counts).reduce((n, c) => n + c.real, 0);
  const fls = Object.values(counts).reduce((n, c) => n + c.false, 0);
  const total = real + fls;
  const realPercent = total ? Math.round((100 * real) / total) : null;
  const line = total === 0
    ? 'No findings have been marked yet.'
    : `${total} finding${total === 1 ? '' : 's'} reviewed by your team: ${real} real, ${fls} false alarm${fls === 1 ? '' : 's'} (${realPercent}% real).${total < 10 ? ' That is too few to say anything about accuracy.' : ''}`;
  return { real, false: fls, total, realPercent, line };
}
