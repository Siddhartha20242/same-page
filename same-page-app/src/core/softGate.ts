import { ruleLabel } from './ruleCatalog';

// Soft gate: a Jira workflow validator can stop a transition, but only in company-managed projects after an admin attaches it.
// This watches status changes instead. When a work item is moved to Done while a blocking contradiction is open, it posts ONE comment on the
// work item, in any project type, and never stops anything. The comment names the rules and the count, not page titles or text, because anyone
// who can see the work item can read it and not all of them can read the page. Fails quiet: any error ends the run without a comment.

export interface StatusChange { field?: string; fieldId?: string; toString?: string; to?: string }
export interface SoftGateEvent { selfGenerated?: boolean; issue?: { key?: string }; changelog?: { items?: StatusChange[] } }

const DONE_NAMES = /^(done|closed|resolved|complete|completed|released|shipped|finished)$/i;

/** True when the event moved the work item into a finished status. */
export function movedToDone(event: SoftGateEvent): boolean {
  return (event.changelog?.items ?? []).some((i) => (i.field === 'status' || i.fieldId === 'status') && DONE_NAMES.test(String(i.toString ?? '').trim()));
}

export interface SoftGateBlocker { id: string; ruleId: string }
export interface SoftGateStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }

export const softGateKey = (issueKey: string) => `softgate:${issueKey}`;

export function commentText(blockers: SoftGateBlocker[]): string {
  const rules = [...new Set(blockers.map((b) => ruleLabel(b.ruleId)))].join(', ');
  return `Same Page: this work item was moved to Done while ${blockers.length} blocking contradiction${blockers.length === 1 ? '' : 's'} with its docs ${blockers.length === 1 ? 'is' : 'are'} still open (${rules}). Open the Same Page panel on this work item to see the evidence, then fix the page, create a review task, or dismiss the finding with a reason. This is a notice, not a block.`;
}

export interface SoftGateDeps {
  store: SoftGateStore;
  /** The blocking findings now, after triage and the site's severity settings. Null when the work item could not be checked. */
  blockers: (issueKey: string) => Promise<SoftGateBlocker[] | null>;
  postComment: (issueKey: string, text: string) => Promise<void>;
}

/** Returns what happened, for the log. Posts at most one comment per distinct set of blockers on a work item. */
export async function runSoftGate(event: SoftGateEvent, { store, blockers, postComment }: SoftGateDeps): Promise<'ignored' | 'clean' | 'unchecked' | 'already-noted' | 'commented'> {
  const key = event.issue?.key;
  if (!key || event.selfGenerated || !movedToDone(event)) return 'ignored';
  const found = await blockers(key);
  if (found === null) return 'unchecked';
  if (!found.length) return 'clean';
  const sig = found.map((b) => b.id).sort().join('|');
  const prior = (await store.get(softGateKey(key)).catch(() => null)) as { sig?: string } | null;
  if (prior?.sig === sig) return 'already-noted';
  await postComment(key, commentText(found));
  await store.set(softGateKey(key), { sig, at: new Date().toISOString() }).catch(() => undefined);
  return 'commented';
}
