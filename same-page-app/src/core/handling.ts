import { appendToStore } from './ledgerStore';
import type { KV } from './ledgerStore';

// The handling timeline: what happened to a contradiction, in the order it happened, sealed into the same hash chain as applied fixes.
//   DISCOVERED   the first time a finding was shown on this site (no person is recorded)
//   DISMISSED    a person dismissed it, with their reason and account id
//   SNOOZED      a person snoozed it, with their account id
//   REVIEW_TASK  a person created a review task for it, with the task key and account id
//   APPLIED      a person applied the verified fix (recorded where the fix is applied)
// We do NOT record who merely looked at a finding: that would store a person's reading activity for no audit purpose.
// Best effort: a storage problem never breaks the action that called it.

export type HandlingEvent = 'DISCOVERED' | 'DISMISSED' | 'SNOOZED' | 'REVIEW_TASK';

export interface HandlingInput { event: HandlingEvent; ruleId: string; issueKey: string; pageId?: string; note?: string; by?: string }

const flat = (s: string | undefined, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function recordHandling(kv: KV, { event, ruleId, issueKey, pageId, note, by }: HandlingInput, now: () => string = () => new Date().toISOString()): Promise<boolean> {
  try {
    const snippet = flat([note, by ? `by ${by}` : ''].filter(Boolean).join(' '), 200);
    await appendToStore(kv, { ruleId: `${ruleId}:${event}`, evidence: { page: { id: pageId, modifiedAt: now(), ...(snippet ? { snippet } : {}) }, workItem: { key: issueKey } } });
    return true;
  } catch { return false; }
}
