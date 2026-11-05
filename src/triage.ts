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

export const fingerprint = (f: Fingerprintable) => sha([f.ruleId, f.pageId ?? f.evidence?.page?.id ?? '', f.evidence?.page?.snippet ?? '', f.evidence?.workItem?.apiVersion ?? '', f.evidence?.workItem?.key ?? '', ...(f.evidence?.other ? [f.evidence.other.snippet] : [])].join('|'));   // R7: a changed line on the OTHER page makes it a new finding

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

// ---- dismissal learning ----
// Per installation, each rule keeps two counters: findings people dismissed, and findings they acted on (Apply or a review task).
// ruleNoise() above judges them. The result is only ever a calm line in the panel. It must NOT hide findings, lower a severity or
// suppress anything automatically, least of all a blocker: a rule that is usually wrong can still be right this once, and silent
// suppression would let a real contradiction through. Only a person, with a reason, dismisses a finding.

export interface OutcomeStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
export type Outcomes = Record<string, { dismissed: number; acted: number }>;
export interface NoisyRule { ruleId: string; dismissed: number; total?: number; message: string }

const OUTCOMES_KEY = 'noise:outcomes';
const MAX_COUNT = 1000;

export const loadOutcomes = async (store: OutcomeStore): Promise<Outcomes> => {
  const raw = (await store.get(OUTCOMES_KEY)) as Outcomes | null | undefined;
  return raw && typeof raw === 'object' ? raw : {};
};

/** Counts one outcome for a rule. Best effort: a storage problem never breaks the action that called it. */
export async function recordOutcome(store: OutcomeStore, ruleId: string | undefined, outcome: 'dismissed' | 'acted'): Promise<void> {
  if (!ruleId) return;
  try {
    const all = await loadOutcomes(store);
    const cur = all[ruleId] ?? { dismissed: 0, acted: 0 };
    await store.set(OUTCOMES_KEY, { ...all, [ruleId]: { ...cur, [outcome]: Math.min(MAX_COUNT, (Number(cur[outcome]) || 0) + 1) } });
  } catch { /* never break the caller */ }
}

/** Rules the existing detector calls noisy (ruleNoise defaults), with the wording the panel shows. Empty when there is no data. */
export async function loadNoisyRules(store: OutcomeStore): Promise<NoisyRule[]> {
  try {
    const all = await loadOutcomes(store);
    const history = Object.entries(all).slice(0, 50).flatMap(([ruleId, c]) => [
      ...Array.from({ length: Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(c?.dismissed) || 0))) }, () => ({ ruleId, outcome: 'dismissed' as const })),
      ...Array.from({ length: Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(c?.acted) || 0))) }, () => ({ ruleId, outcome: 'acted' as const })),
    ]);
    return ruleNoise(history).filter((r) => r.noisy).map((r) => {
      const dismissed = Math.round(r.rate * r.samples);
      return { ruleId: r.ruleId, dismissed, total: r.samples, message: `Rule ${r.ruleId.split('_')[0]} has been dismissed ${dismissed} of ${r.samples} times on this site. If it is usually wrong for your team, a site admin can change its severity under Rules.` };
    });
  } catch { return []; }
}

/** Adds the hint for noisy rules that appear in this panel. Findings, severities and the verdict are carried through untouched. */
export function withNoisyRules<M extends { findings?: { ruleId?: string }[]; notes?: { ruleId?: string }[] }>(model: M, noisy: NoisyRule[]): M & { noisyRules?: NoisyRule[] } {
  const present = new Set([...(model.findings ?? []), ...(model.notes ?? [])].map((f) => f.ruleId));
  const hints = noisy.filter((n) => present.has(n.ruleId));
  return hints.length ? { ...model, noisyRules: hints } : model;
}
