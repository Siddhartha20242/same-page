// Agent firewall core: fixed policy rules decide whether a batch of proposed changes may go ahead, a person approves what is risky,
// every applied batch is sealed in the same hash chain as the evidence log, and a journal lets a batch be undone safely.
// Pure functions over plain data. Nothing here calls Jira; the caller applies approved changes and reads current values.
// No model decides anything. The same batch and policy always give the same decision, so a block can be explained.

import { createHash } from 'node:crypto';
import { appendFinding, canonicalize, type LedgerEntry } from './ledger.ts';

export type Field = 'status' | 'assignee' | 'summary' | 'description' | 'priority' | 'labels' | 'fixVersion' | 'dueDate' | 'reporter' | 'project';
export interface ProposedChange { issueKey: string; field: Field; from: string | null; to: string | null }
export type Verdict = 'allow' | 'approve' | 'deny';

export interface Policy {
  /** More changes than this in one batch need a person's approval. */
  approveAbove: number;
  /** More changes than this are refused outright. */
  denyAbove: number;
  /** Fields an agent may never change. */
  deniedFields: Field[];
  /** Project keys where every change needs approval. */
  protectedProjects: string[];
  /** Moving an issue out of one of these statuses (for example back from Done) needs approval. */
  protectedStatuses: string[];
}
export const DEFAULT_POLICY: Policy = { approveAbove: 20, denyAbove: 200, deniedFields: ['reporter', 'project'], protectedProjects: [], protectedStatuses: ['Done', 'Released', 'Closed'] };

export interface Reason { rule: 'FW1_BULK' | 'FW2_DENIED_FIELD' | 'FW3_PROTECTED_PROJECT' | 'FW4_REOPEN'; text: string; issueKeys: string[] }
export interface Decision {
  verdict: Verdict;
  reasons: Reason[];
  /** Changes that actually alter something; a change from a value to the same value is dropped, not counted. */
  changes: ProposedChange[];
  ignoredNoops: number;
  /** Changes a person must approve one by one when the verdict is "approve". Empty for allow and deny. */
  needsApproval: ProposedChange[];
}

const projectOf = (key: string) => key.split('-')[0] ?? '';
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function evaluate(proposed: ProposedChange[], policy: Policy = DEFAULT_POLICY): Decision {
  const changes = proposed.filter((c) => (c.from ?? '') !== (c.to ?? ''));
  const reasons: Reason[] = [];
  const ORDER: Verdict[] = ['allow', 'approve', 'deny'];
  let level = 0;
  const raise = (v: Verdict) => { level = Math.max(level, ORDER.indexOf(v)); };
  const keys = (cs: ProposedChange[]) => [...new Set(cs.map((c) => c.issueKey))];

  const denied = changes.filter((c) => policy.deniedFields.includes(c.field));
  if (denied.length) { reasons.push({ rule: 'FW2_DENIED_FIELD', text: `${plural(denied.length, 'change')} to a field agents may never change (${[...new Set(denied.map((c) => c.field))].join(', ')}).`, issueKeys: keys(denied) }); raise('deny'); }

  if (changes.length > policy.denyAbove) { reasons.push({ rule: 'FW1_BULK', text: `${plural(changes.length, 'change')} in one batch is above the limit of ${policy.denyAbove}.`, issueKeys: keys(changes) }); raise('deny'); }
  else if (changes.length > policy.approveAbove) { reasons.push({ rule: 'FW1_BULK', text: `${plural(changes.length, 'change')} in one batch is above ${policy.approveAbove}, so a person must approve.`, issueKeys: keys(changes) }); raise('approve'); }

  const prot = changes.filter((c) => policy.protectedProjects.includes(projectOf(c.issueKey)));
  if (prot.length) { reasons.push({ rule: 'FW3_PROTECTED_PROJECT', text: `${plural(prot.length, 'change')} in a protected project (${[...new Set(prot.map((c) => projectOf(c.issueKey)))].join(', ')}).`, issueKeys: keys(prot) }); raise('approve'); }

  const reopen = changes.filter((c) => c.field === 'status' && c.from !== null && policy.protectedStatuses.includes(c.from));
  if (reopen.length) { reasons.push({ rule: 'FW4_REOPEN', text: `${plural(reopen.length, 'issue')} would leave a finished status (${[...new Set(reopen.map((c) => c.from))].join(', ')}).`, issueKeys: keys(reopen) }); raise('approve'); }

  const verdict = ORDER[level]!;
  // Bulk approval covers the whole batch; the narrower rules only need the changes they matched.
  const bulk = reasons.some((r) => r.rule === 'FW1_BULK');
  const flagged = new Set(reasons.flatMap((r) => r.issueKeys));
  const needsApproval = verdict === 'approve' ? (bulk ? changes : changes.filter((c) => flagged.has(c.issueKey))) : [];
  return { verdict, reasons, changes, ignoredNoops: proposed.length - changes.length, needsApproval };
}

/** What a person is asked to approve: counts first, then a few examples, so a large batch is still readable. */
export function previewLines(d: Decision, examples = 5): string[] {
  const out = [`${plural(d.changes.length, 'change')} on ${plural(new Set(d.changes.map((c) => c.issueKey)).size, 'issue')}. Verdict: ${d.verdict}.`];
  for (const r of d.reasons) out.push(`${r.rule}: ${r.text}`);
  for (const c of d.changes.slice(0, examples)) out.push(`${c.issueKey} ${c.field}: ${c.from ?? '(empty)'} -> ${c.to ?? '(empty)'}`);
  if (d.changes.length > examples) out.push(`...and ${d.changes.length - examples} more`);
  return out;
}

/** The changes that may go ahead: everything when allowed, nothing when denied, and when approval is needed only what the approver chose. */
export function approvedChanges(d: Decision, approved: { issueKey: string; field: Field }[] | 'all'): ProposedChange[] {
  if (d.verdict === 'deny') return [];
  if (d.verdict === 'allow') return d.changes;
  const need = new Set(d.needsApproval.map((c) => `${c.issueKey}|${c.field}`));
  const ok = approved === 'all' ? need : new Set(approved.map((a) => `${a.issueKey}|${a.field}`));
  return d.changes.filter((c) => !need.has(`${c.issueKey}|${c.field}`) || ok.has(`${c.issueKey}|${c.field}`));
}

// ---- journal and undo ----
export interface Journal { batchId: string; agent: string; at: string; applied: ProposedChange[] }
export const buildJournal = (batchId: string, agent: string, applied: ProposedChange[], now: () => string = () => new Date().toISOString()): Journal => ({ batchId, agent, at: now(), applied });
export const journalHash = (j: Journal): string => createHash('sha256').update(canonicalize(j)).digest('hex');

export interface UndoPlan { revert: ProposedChange[]; skipped: { change: ProposedChange; why: string }[] }
/** Puts values back, but only where the field still holds what the agent wrote. A later human edit is never overwritten; it is reported instead. */
export function undoPlan(j: Journal, current: (issueKey: string, field: Field) => string | null | undefined): UndoPlan {
  const revert: ProposedChange[] = []; const skipped: UndoPlan['skipped'] = [];
  for (const c of [...j.applied].reverse()) {
    const now = current(c.issueKey, c.field);
    if (now === undefined) { skipped.push({ change: c, why: 'The current value could not be read.' }); continue; }
    if ((now ?? '') !== (c.to ?? '')) { skipped.push({ change: c, why: `Someone changed it since (now ${now ?? '(empty)'}), so it was left alone.` }); continue; }
    revert.push({ issueKey: c.issueKey, field: c.field, from: c.to, to: c.from });
  }
  return { revert, skipped };
}

// ---- the sealed record ----
export type SealKind = 'FW_APPLIED' | 'FW_DENIED' | 'FW_UNDONE';
/** Appends one entry to the same hash chain the evidence log uses. It commits to the journal by hash and carries no issue text. */
export function seal(chain: LedgerEntry[], kind: SealKind, j: Journal, d: Pick<Decision, 'verdict'>, by: string | null, now?: () => string): LedgerEntry[] {
  return appendFinding(chain, {
    ruleId: kind,
    evidence: {
      workItem: { key: j.applied[0]?.issueKey ?? j.batchId, status: d.verdict },
      fact: { label: `batch ${j.batchId}`, ticketLine: `agent ${j.agent}${by ? `, approved by ${by}` : ''}`, ticketValue: `${j.applied.length} changes`, pageValue: journalHash(j) },
    },
  }, now);
}

/** Burst check for changes that already happened, whoever made them: Forge events name a user, not an agent, so volume is the signal. */
export function burst(events: { at: number; actor: string }[], opts: { windowMs: number; limit: number } = { windowMs: 60_000, limit: 30 }): { actor: string; count: number; since: number }[] {
  const by = new Map<string, number[]>();
  for (const e of events) by.set(e.actor, [...(by.get(e.actor) ?? []), e.at]);
  const out: { actor: string; count: number; since: number }[] = [];
  for (const [actor, ts] of by) {
    ts.sort((a, b) => a - b);
    let lo = 0; let best = { count: 0, since: 0 };
    for (let hi = 0; hi < ts.length; hi++) {
      while (ts[hi]! - ts[lo]! > opts.windowMs) lo++;
      if (hi - lo + 1 > best.count) best = { count: hi - lo + 1, since: ts[lo]! };
    }
    if (best.count > opts.limit) out.push({ actor, ...best });
  }
  return out.sort((a, b) => b.count - a.count);
}
