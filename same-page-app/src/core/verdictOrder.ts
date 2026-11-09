// Tiny and dependency-free on purpose: the overview page imports this, and it must not pull the scanning engine into the page bundle.

export type RowVerdict = 'Blocked' | 'Warning' | 'Clean' | 'Not checked';

/** Display order: the worst first, then items nobody could check (they are not clean), then clean ones; stable inside each group. */
const RANK: Record<RowVerdict, number> = { Blocked: 0, Warning: 1, 'Not checked': 2, Clean: 3 };
export const bySeverity = <T extends { verdict: RowVerdict }>(rows: T[]): T[] =>
  rows.map((r, i) => [r, i] as const).sort((a, b) => RANK[a[0].verdict] - RANK[b[0].verdict] || a[1] - b[1]).map(([r]) => r);
