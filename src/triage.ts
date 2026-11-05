import { createHash } from 'node:crypto';

// Alert fatigue defences. A dismissal is tied to a fingerprint of the evidence, so it holds while the evidence is unchanged
// and the finding returns when the page line or the target changes. Dismissing needs a reason, snoozes expire, and a rule that
// people mostly dismiss is flagged as noisy instead of being allowed to quietly train everyone to click through.

import type { Finding } from './types.ts';

export type TriageRecord =
  | { status: 'dismissed'; reason: string; by?: string; at: string }
  | { status: 'snoozed'; until: string; by?: string };
export type TriageRecords = Record<string, TriageRecord>;
/** What fingerprint() reads: a finding, with optional page id fields. */
type Fingerprintable = Pick<Finding, 'ruleId' | 'evidence'> & { pageId?: string };

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const fingerprint = (f: Fingerprintable) => sha([f.ruleId, f.pageId ?? f.evidence?.page?.id ?? '', f.evidence?.page?.snippet ?? '', f.evidence?.workItem?.apiVersion ?? '', f.evidence?.workItem?.key ?? ''].join('|'));

export function dismiss(records: TriageRecords, finding: Fingerprintable, reason: unknown, by: string | undefined, at = new Date().toISOString()): TriageRecords {
  if (!String(reason ?? '').trim()) throw new Error('a reason is required to dismiss a finding');
  return { ...records, [fingerprint(finding)]: { status: 'dismissed', reason: String(reason).trim(), by, at } };
}

export function snooze(records: TriageRecords, finding: Fingerprintable, until: string, by?: string): TriageRecords {
  if (!Number.isFinite(Date.parse(until))) throw new Error('snooze needs a valid end date');
  return { ...records, [fingerprint(finding)]: { status: 'snoozed', until, by } };
}

// The panel already holds each finding's fingerprint as its id, so records can be written and read by id.
export function dismissById(records: TriageRecords, id: string, reason: unknown, by?: string, at = new Date().toISOString()): TriageRecords {
  if (!String(reason ?? '').trim()) throw new Error('a reason is required to dismiss a finding');
  return { ...records, [id]: { status: 'dismissed', reason: String(reason).trim(), by, at } };
}

export function snoozeById(records: TriageRecords, id: string, until: string, by?: string): TriageRecords {
  if (!Number.isFinite(Date.parse(until))) throw new Error('snooze needs a valid end date');
  return { ...records, [id]: { status: 'snoozed', until, by } };
}

// Splits a panel model into what is still open and a count of what was hidden, so nothing vanishes silently.
/** The parts of a panel model that triage reads. Anything else on the model is carried through untouched. */
export interface TriageModel { issueKey?: string; status?: string; pagesChecked?: number; verdict?: string; findings?: { id: string; severity: string }[]; notes?: { id: string; severity: string }[] }

export function filterModelByTriage<M extends TriageModel>(model: M, records: TriageRecords, now: () => number = Date.now): M & { hidden?: number } {
  if (!model.findings && !model.notes) return model;
  const open = (f: { id: string }) => { const r = records[f.id]; return !r || (r.status === 'snoozed' && now() >= Date.parse(r.until)); };
  const findings = (model.findings ?? []).filter(open);
  const notes = (model.notes ?? []).filter(open);
  const hidden = (model.findings?.length ?? 0) + (model.notes?.length ?? 0) - findings.length - notes.length;
  if (!findings.length && !notes.length) return { issueKey: model.issueKey, status: 'clean', pagesChecked: model.pagesChecked, hidden } as M & { hidden: number };
  return { ...model, findings, notes, status: findings.length ? 'findings' : 'notes', verdict: findings.some((f) => f.severity === 'block') ? 'BLOCKED' : findings.length ? 'WARN' : 'PASS', hidden };
}

export function applyTriage<F extends Fingerprintable>(findings: F[], records: TriageRecords, now: () => number = Date.now) {
  return findings.map((f) => {
    const r = records[fingerprint(f)];
    if (!r) return { ...f, triage: 'open' };
    if (r.status === 'snoozed' && now() >= Date.parse(r.until)) return { ...f, triage: 'open', note: 'snooze expired' };
    return { ...f, triage: r.status, reason: 'reason' in r ? r.reason : undefined };
  });
}

// history: [{ ruleId, outcome: 'dismissed' | 'acted' }]. Needs enough samples before it judges.
export function ruleNoise(history: { ruleId: string; outcome: 'dismissed' | 'acted' }[], { minSamples = 5, threshold = 0.5 }: { minSamples?: number; threshold?: number } = {}) {
  const byRule: Record<string, { dismissed: number; total: number }> = {};
  for (const h of history) {
    byRule[h.ruleId] ??= { dismissed: 0, total: 0 };
    byRule[h.ruleId].total++;
    if (h.outcome === 'dismissed') byRule[h.ruleId].dismissed++;
  }
  return Object.entries(byRule).map(([ruleId, { dismissed, total }]) => ({
    ruleId, samples: total, rate: dismissed / total, noisy: total >= minSamples && dismissed / total >= threshold,
  }));
}
