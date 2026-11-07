import { applyProposal, buildPageUpdate } from './apply';
import { storageToText } from './adapters';
import { dismissById, recordOutcome, snoozeById } from './triage';
import type { TriageRecords } from './triage';
import type { PanelFinding, PanelModel } from './panelModel';
import type { PageSource } from './atlassianDeps';
import type { buildPageUpdate as BuildPageUpdate } from './apply';

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: string };
export type { TriageRecords };
/** Minimal key-value store (Forge KVS in the app, a Map in tests). */
export interface KeyValueStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }

// The write-side actions behind the panel buttons. Pure orchestration over injected functions, so it is testable without Atlassian.
// Nothing here trusts the browser: the client sends a finding id, and the finding, the proposal and the target are rebuilt server-side.

const find = (model: PanelModel, id: string | undefined): PanelFinding | undefined => {
  const m = model as { findings?: PanelFinding[]; notes?: PanelFinding[] };
  return [...(m.findings ?? []), ...(m.notes ?? [])].find((f) => f.id === id);
};

// Apply = a human clicked. Re-reads the page, re-verifies the edit against the live text, and writes a new page version.
export async function applySuggestion(
  { issueKey, findingId, approver, expectedAfter }: { issueKey: string; findingId?: string; approver?: string; /** The edit the person saw. If the rebuilt edit differs, nothing is written. */ expectedAfter?: string },
  { buildModel, getPageSource, putPage }: {
    buildModel(issueKey: string): Promise<PanelModel>;
    getPageSource(pageId: string): Promise<PageSource | null>;
    putPage(pageId: string, body: ReturnType<typeof BuildPageUpdate>): Promise<{ ok: boolean; status: number }>;
  },
): Promise<ActionResult<{ pageId: string; version: number; ruleId: string; line: number; before: string; after: string }>> {
  const model = await buildModel(issueKey);
  const f = find(model, findingId);
  if (!f) return { ok: false, reason: 'That finding is no longer present. Refresh the panel.' };
  const s = f.suggestion;
  if (!s?.after) return { ok: false, reason: 'There is no verified edit to apply for this finding.' };
  if (s.pageId === undefined || s.line === undefined || s.before === undefined || s.target === undefined) return { ok: false, reason: 'There is no verified edit to apply for this finding.' };
  if (expectedAfter !== undefined && expectedAfter !== s.after) return { ok: false, reason: 'The suggested edit changed since you saw it. Refresh the panel and review it again.' };
  const source = await getPageSource(s.pageId);
  if (!source) return { ok: false, reason: 'You cannot read or edit that page.' };
  if (!Number.isInteger(source.version)) return { ok: false, reason: 'Could not read the page version, so the edit was not applied.' };
  // Same edit the proposal described, proven again on the text as it is right now.
  const edit = applyProposal({ html: source.html, proposal: { ok: true, before: s.before, after: s.after, line: s.line }, target: s.target });
  if (!edit.ok) return { ok: false, reason: edit.reason };
  // Belt and braces: the page text on the flagged line must still be what the finding showed.
  if (storageToText(source.html).split('\n')[s.line - 1] !== s.before) return { ok: false, reason: 'The page changed since the check. Refresh the panel.' };
  const body = buildPageUpdate({ page: { id: s.pageId, title: source.title }, newHtml: edit.html, currentVersion: source.version as number, issueKey, approver: approver ?? 'a user' });
  const res = await putPage(s.pageId, body);
  if (!res.ok) return { ok: false, reason: res.status === 403 ? 'You do not have permission to edit that page.' : res.status === 409 ? 'Someone edited the page at the same time. Refresh and try again.' : `Confluence did not accept the edit (HTTP ${res.status}).` };
  return { ok: true, pageId: s.pageId, version: body.version.number, ruleId: f.ruleId, line: s.line, before: s.before, after: s.after };
}

// Triage records live per issue as { findingId: record }. `store` is { get(key), set(key, value) }.
const key = (issueKey: string) => `triage:${issueKey}`;

export async function triageFinding(
  { issueKey, findingId, kind, reason, until, by }: { issueKey: string; findingId?: string; kind: 'dismiss' | 'snooze'; reason?: string; until?: string; by?: string },
  { buildModel, store }: { buildModel(issueKey: string): Promise<PanelModel>; store: KeyValueStore },
): Promise<ActionResult> {
  const target = find(await buildModel(issueKey), findingId);
  if (!target) return { ok: false, reason: 'That finding is no longer present. Refresh the panel.' };
  const records = ((await store.get(key(issueKey))) ?? {}) as TriageRecords;
  let next: TriageRecords;
  try {
    next = (kind === 'snooze' ? snoozeById(records, findingId as string, until as string, by) : dismissById(records, findingId as string, reason, by));
  } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  await store.set(key(issueKey), next);
  // Another person may have written this work item's records at the same moment, and the later write would drop this one. Read it back and, if it is missing, add it again.
  const back = ((await store.get(key(issueKey))) ?? {}) as TriageRecords;
  if (!back[findingId as string]) await store.set(key(issueKey), { ...back, [findingId as string]: next[findingId as string]! });
  if (kind === 'dismiss') await recordOutcome(store, target.ruleId, 'dismissed');       // feeds the calm "noisy rule" line; never hides anything
  return { ok: true, ruleId: target.ruleId, pageId: target.pageId } as ActionResult;
}

export async function loadTriage(issueKey: string, store: KeyValueStore): Promise<TriageRecords> { return ((await store.get(key(issueKey))) ?? {}) as TriageRecords; }
