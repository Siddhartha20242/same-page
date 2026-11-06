// Draft rules: a rule in draft runs and is counted, but its findings are not shown, not sent as notices and cannot block.
// This counts what each draft rule WOULD have raised, once per finding, so an administrator can see how a new rule behaves before it is shown to anyone.

export interface DraftStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
const COUNTS = 'draft:counts';
const seenKey = (id: string) => `draft:seen:${String(id).slice(0, 64)}`;
const MAX_NEW_PER_CALL = 25;

export async function loadDraftCounts(store: DraftStore): Promise<Record<string, number>> {
  try {
    const raw = (await store.get(COUNTS)) as Record<string, unknown> | null | undefined;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {}).slice(0, 60)) out[k] = Math.min(100000, Math.max(0, Math.floor(Number(v) || 0)));
    return out;
  } catch { return {}; }
}

/** Counts each drafted finding once, the first time it is seen. Best effort: it never breaks the caller. */
export async function recordDrafted(store: DraftStore, drafted: { id: string; ruleId: string }[]): Promise<void> {
  try {
    const counts = await loadDraftCounts(store);
    let changed = false;
    for (const d of drafted.slice(0, MAX_NEW_PER_CALL)) {
      if (!d.id) continue;
      if (await store.get(seenKey(d.id))) continue;
      await store.set(seenKey(d.id), 1);
      counts[d.ruleId] = (counts[d.ruleId] ?? 0) + 1;
      changed = true;
    }
    if (changed) await store.set(COUNTS, counts);
  } catch { /* best effort */ }
}
