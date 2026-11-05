import type { Severity } from './types.ts';

// The seven rules as a set: what each one checks, who it protects, and the severity it ships with.
// A site admin may move a rule between 'block' and 'warn'. Nothing else about a rule can be changed from settings.

export interface RuleInfo { ruleId: string; short: string; name: string; checks: string; pain: string; defaultSeverity: 'block' | 'warn' }

export const RULE_CATALOG: RuleInfo[] = [
  { ruleId: 'R1_VERSION_MISMATCH', short: 'R1', name: 'Stale version', checks: 'A linked page documents an API version other than the work item targets, and was not edited after the status change.', pain: 'Release and incident: people follow the old version.', defaultSeverity: 'block' },
  { ruleId: 'R2_DEPRECATED_DECISION_ACTIVE_WORK', short: 'R2', name: 'Deprecated decision', checks: 'A linked decision page is Deprecated or Superseded while the work item is still active.', pain: 'Governance: work continues on a decision that was withdrawn.', defaultSeverity: 'block' },
  { ruleId: 'R3_MISSING_REQUIRED_FIELD', short: 'R3', name: 'Missing field', checks: 'A required field is empty while the work item is Done.', pain: 'Audit: a finished item lacks a field the process requires.', defaultSeverity: 'warn' },
  { ruleId: 'R4_STATUS_CLAIM_STALE', short: 'R4', name: 'Stale status claim', checks: 'A page calls a work item planned or shipped when Jira says otherwise. Dated log lines are skipped.', pain: 'Incident: a runbook states a status that is no longer true.', defaultSeverity: 'warn' },
  { ruleId: 'R5_SPEC_DISAGREES', short: 'R5', name: 'API spec mismatch', checks: 'A doc line such as DELETE /api/v2/charge/42 disagrees with an OpenAPI 3 JSON spec in a linked page. Deprecated blocks, unknown warns.', pain: 'Integration: docs describe an endpoint the spec does not have.', defaultSeverity: 'block' },
  { ruleId: 'R6_CITED_TICKET_CLOSED', short: 'R6', name: 'Closed ticket cited as open', checks: 'A page treats another ticket as still open but Jira shows it Done or Closed.', pain: 'Planning: pages keep waiting on work that finished.', defaultSeverity: 'warn' },
  { ruleId: 'R7_PAGES_DISAGREE', short: 'R7', name: 'Pages disagree', checks: 'Two linked pages document the same endpoint or API at different versions and the work item cannot settle it.', pain: 'Onboarding: two pages give two answers.', defaultSeverity: 'warn' },
  { ruleId: 'R8_DURATION_DIFFERS', short: 'R8', name: 'Duration differs', checks: 'The work item and a page give different times (a timeout, an expiry, a window) for the same thing, such as token expiry.', pain: 'Incident: someone configures or relies on the wrong time.', defaultSeverity: 'warn' },
  { ruleId: 'R9_LIMIT_DIFFERS', short: 'R9', name: 'Limit or port differs', checks: 'The work item and a page give different limits, sizes, counts or ports for the same thing, such as a rate limit.', pain: 'Integration: clients are built against the wrong limit.', defaultSeverity: 'warn' },
  { ruleId: 'R10_DATE_DIFFERS', short: 'R10', name: 'Date differs', checks: 'The work item and a page give different dates for the same milestone (release, deadline, freeze, cutover).', pain: 'Planning: people prepare for the wrong day.', defaultSeverity: 'warn' },
];

export const ruleInfo = (ruleId: string) => RULE_CATALOG.find((r) => r.ruleId === ruleId);
export const ruleLabel = (ruleId: string) => { const r = ruleInfo(ruleId); return r ? `${r.short} ${r.name}` : 'Rule'; };

export type SeverityOverrides = Record<string, 'block' | 'warn'>;
export interface SettingsStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
const KEY = 'rules:severity';

export async function loadSeverityOverrides(store: SettingsStore): Promise<SeverityOverrides> {
  try {
    const raw = (await store.get(KEY)) as Record<string, unknown> | null | undefined;
    const out: SeverityOverrides = {};
    for (const r of RULE_CATALOG) { const v = raw?.[r.ruleId]; if (v === 'block' || v === 'warn') out[r.ruleId] = v; }
    return out;
  } catch { return {}; }
}

/** Unknown rule ids and values other than block or warn are refused. Setting a rule back to its default removes the override. */
export async function saveSeverity(store: SettingsStore, ruleId: string, severity: string): Promise<{ ok: true; overrides: SeverityOverrides } | { ok: false; reason: string }> {
  const info = ruleInfo(ruleId);
  if (!info) return { ok: false, reason: 'Unknown rule.' };
  if (severity !== 'block' && severity !== 'warn') return { ok: false, reason: 'Severity must be block or warn.' };
  const cur = await loadSeverityOverrides(store);
  if (severity === info.defaultSeverity) delete cur[ruleId]; else cur[ruleId] = severity;
  await store.set(KEY, cur);
  return { ok: true, overrides: cur };
}

export const effectiveSeverity = (ruleId: string, o: SeverityOverrides): 'block' | 'warn' | undefined => o[ruleId] ?? ruleInfo(ruleId)?.defaultSeverity;

interface Sev { ruleId: string; severity: string }
/** Applies the site's severity settings to a model's findings. Notes (severity info) are history and never change. */
export function withSeverities<M extends { findings?: Sev[]; notes?: Sev[]; verdict?: string; status?: string }>(model: M, o: SeverityOverrides): M {
  if (!model.findings?.length || !Object.keys(o).length) return model;
  const findings = model.findings.map((f) => (f.severity === 'info' || !o[f.ruleId] ? f : { ...f, severity: o[f.ruleId] as Severity }));
  const verdict = findings.some((f) => f.severity === 'block') ? 'BLOCKED' : 'WARN';
  return { ...model, findings, verdict };
}
