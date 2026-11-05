// Impact counters, kept per installation in the app's own storage so a pilot produces numbers instead of anecdotes. Counts only:
// no page text, no titles, no people. Best effort: a storage hiccup must never break the panel or the gate, so nothing here throws.

export interface MetricStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
export interface Counts { seen: number; applied: number; dismissed: number; snoozed: number; reviewTasks: number; gateBlocks: number }

const KEY = 'metrics:counts';
const ZERO: Counts = { seen: 0, applied: 0, dismissed: 0, snoozed: 0, reviewTasks: 0, gateBlocks: 0 };
const MAX_NEW_PER_CALL = 25;

export async function readCounts(store: MetricStore): Promise<Counts> {
  try {
    const v = ((await store.get(KEY)) ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.keys(ZERO).map((k) => [k, typeof v[k] === 'number' && v[k]! >= 0 ? v[k] : 0])) as unknown as Counts;
  } catch { return { ...ZERO }; }
}

export async function bump(store: MetricStore, field: keyof Counts, by = 1): Promise<void> {
  try { const c = await readCounts(store); c[field] += by; await store.set(KEY, c); } catch { /* never break the caller */ }
}

/** Counts each finding id once, the first time it is shown. A finding that returns after a fix is a new id only if its evidence changed. */
export async function markSeen(store: MetricStore, ids: string[]): Promise<string[]> {
  const firsts: string[] = [];
  try {
    let fresh = 0;
    for (const id of [...new Set(ids)].slice(0, MAX_NEW_PER_CALL)) {
      const key = `metrics:seen:${id}`.slice(0, 200);
      if (!(await store.get(key))) { await store.set(key, 1); fresh++; firsts.push(id); }
    }
    if (fresh) await bump(store, 'seen', fresh);
  } catch { /* best effort */ }
  return firsts;
}
