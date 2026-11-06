// Break glass: a project administrator can let ONE work item through the gate for a short time, with a written reason, when a false alarm
// would block an emergency. The validator cannot ask for input at transition time, so the override is granted beforehand from the panel.
// It lasts 24 hours, applies to that work item only, is recorded in the hash chain when granted and when used, and can be revoked.
// It never hides a finding: the panel still shows it.

export interface Override { at: string; until: string; by?: string; reason: string }
export interface OverrideStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
export const OVERRIDE_HOURS = 24;
export const overrideKey = (issueKey: string) => `override:${issueKey}`;

export function checkReason(raw: unknown): { ok: true; reason: string } | { ok: false; why: string } {
  const reason = String(raw ?? '').replace(/[\u0000-\u001f\u007f`<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (reason.length < 8) return { ok: false, why: 'Write a reason of at least 8 characters, for example "Emergency hotfix for INC-991".' };
  return { ok: true, reason };
}

export async function grantOverride(store: OverrideStore, { issueKey, reason, by }: { issueKey: string; reason: unknown; by?: string }, now: () => number = Date.now): Promise<{ ok: true; override: Override } | { ok: false; why: string }> {
  const r = checkReason(reason);
  if (!r.ok) return r;
  const override: Override = { at: new Date(now()).toISOString(), until: new Date(now() + OVERRIDE_HOURS * 3600_000).toISOString(), reason: r.reason, ...(by ? { by } : {}) };
  await store.set(overrideKey(issueKey), override);
  return { ok: true, override };
}

/** The override for this work item if it has not expired, else null. */
export async function activeOverride(store: OverrideStore, issueKey: string, now: () => number = Date.now): Promise<Override | null> {
  try {
    const o = (await store.get(overrideKey(issueKey))) as Override | null | undefined;
    return o && typeof o.until === 'string' && Date.parse(o.until) > now() && typeof o.reason === 'string' ? o : null;
  } catch { return null; }
}

// Forge storage rejects a null value, so a revoked override is stored as one that has already expired.
export async function revokeOverride(store: OverrideStore, issueKey: string, now: () => number = Date.now): Promise<void> {
  const past = new Date(now() - 1000).toISOString();
  await store.set(overrideKey(issueKey), { at: past, until: past, reason: 'revoked' } satisfies Override);
}
