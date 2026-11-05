import test from 'node:test';
import assert from 'node:assert/strict';
import { applySuggestion, triageFinding, loadTriage } from '../src/panelActions.ts';
import { filterModelByTriage } from '../src/triage.ts';
import type { TriageRecords } from '../src/triage.ts';
import type { PanelModel } from '../src/panelModel.ts';
import type { PanelFinding } from '../src/reviewTask.ts';
import type { buildPageUpdate } from '../src/apply.ts';

const finding = (over: Partial<PanelFinding> = {}): PanelFinding => ({
  id: 'f1', ruleId: 'R1_VERSION_MISMATCH', severity: 'warn', summary: 'x', why: 'x', pageId: '111', pageTitle: 'Runbook',
  evidence: { docLine: 'Call POST /api/v1/charge' },
  suggestion: { before: 'Call POST /api/v1/charge', after: 'Call POST /api/v2/charge', pageId: '111', line: 2, target: 'v2', note: 'x', method: 'deterministic' }, ...over,
});
const model = (f: PanelFinding = finding()): PanelModel => ({ issueKey: 'PAY-1', status: 'findings', verdict: 'WARN', findings: [f], notes: [], pagesChecked: 1 });
const HTML = '<h2>Charging</h2><p>Call POST /api/v1/charge</p>';

test('apply writes one new page version, as the approving user, with the line changed and nothing else', async () => {
  let sent = undefined as { id: string; body: ReturnType<typeof buildPageUpdate> } | undefined;
  const r = await applySuggestion({ issueKey: 'PAY-1', findingId: 'f1', approver: 'Dana' }, {
    buildModel: async () => model(),
    getPageSource: async () => ({ id: '111', title: 'Runbook', html: HTML, version: 4 }),
    putPage: async (id: string, body: ReturnType<typeof buildPageUpdate>) => { sent = { id, body }; return { ok: true, status: 200 }; },
  });
  assert.equal(r.ok, true);
  assert.equal(sent!.body.version.number, 5);
  assert.match(sent!.body.version.message, /approved by Dana/);
  assert.equal(sent!.body.body.value, '<h2>Charging</h2><p>Call POST /api/v2/charge</p>');
});

test('apply refuses when the page changed, the finding vanished, or there is no verified edit', async () => {
  const deps = (html: string, f: PanelFinding = finding()) => ({ buildModel: async () => model(f), getPageSource: async () => ({ id: '111', title: 'R', html, version: 1 }), putPage: async () => { throw new Error('must not write'); } });
  assert.equal((await applySuggestion({ issueKey: 'PAY-1', findingId: 'zzz' }, deps(HTML))).ok, false);
  assert.equal((await applySuggestion({ issueKey: 'PAY-1', findingId: 'f1' }, deps('<p>Totally different</p>'))).ok, false);
  assert.equal((await applySuggestion({ issueKey: 'PAY-1', findingId: 'f1' }, deps(HTML, finding({ suggestion: { unavailable: 'ambiguous' } })))).ok, false);
});

test('apply reports permission and edit-conflict errors in plain words', async () => {
  const run = (status: number) => applySuggestion({ issueKey: 'PAY-1', findingId: 'f1' }, { buildModel: async () => model(), getPageSource: async () => ({ id: '111', title: 'R', html: HTML, version: 1 }), putPage: async () => ({ ok: false, status }) });
  assert.match(((await run(403)) as { reason: string }).reason, /permission/);
  assert.match(((await run(409)) as { reason: string }).reason, /same time/);
});

test('apply refuses if the page is unreadable or the version is unknown', async () => {
  const base = { buildModel: async () => model(), putPage: async () => { throw new Error('no'); } };
  assert.equal((await applySuggestion({ issueKey: 'PAY-1', findingId: 'f1' }, { ...base, getPageSource: async () => null })).ok, false);
  assert.equal((await applySuggestion({ issueKey: 'PAY-1', findingId: 'f1' }, { ...base, getPageSource: async () => ({ id: '111', title: 'R', html: HTML, version: null }) })).ok, false);
});

test('dismiss needs a reason, snooze needs a date, and both hide the finding with a count', async () => {
  const mem = new Map<string, unknown>();
  const store = { get: async (k: string) => mem.get(k), set: async (k: string, v: unknown) => { mem.set(k, v); } };
  const deps = { buildModel: async () => model(), store };
  assert.equal((await triageFinding({ issueKey: 'PAY-1', findingId: 'f1', kind: 'dismiss', reason: '  ' }, deps)).ok, false);
  assert.equal((await triageFinding({ issueKey: 'PAY-1', findingId: 'f1', kind: 'snooze', until: 'nope' }, deps)).ok, false);
  assert.equal((await triageFinding({ issueKey: 'PAY-1', findingId: 'f1', kind: 'dismiss', reason: 'intentional history', by: 'Dana' }, deps)).ok, true);
  const hidden = filterModelByTriage(model(), await loadTriage('PAY-1', store));
  assert.equal(hidden.status, 'clean');
  assert.equal(hidden.hidden, 1);
});

test('a snooze lapses and the finding comes back', () => {
  const records: TriageRecords = { f1: { status: 'snoozed', until: '2026-01-02T00:00:00Z' } };
  assert.equal(filterModelByTriage(model(), records, () => Date.parse('2026-01-01T00:00:00Z')).status, 'clean');
  assert.equal(filterModelByTriage(model(), records, () => Date.parse('2026-02-01T00:00:00Z')).status, 'findings');
});

test('triage of an unknown finding is refused', async () => {
  const r = await triageFinding({ issueKey: 'PAY-1', findingId: 'nope', kind: 'dismiss', reason: 'x' }, { buildModel: async () => model(), store: { get: async () => ({}), set: async () => {} } });
  assert.equal(r.ok, false);
});

test('apply refuses when the edit differs from the one the person saw (for example a model reworded it)', async () => {
  const r = await applySuggestion({ issueKey: 'PAY-1', findingId: 'f1', approver: 'Dana', expectedAfter: 'Call POST /api/v2/other' }, {
    buildModel: async () => model(),
    getPageSource: async () => ({ id: '111', title: 'Runbook', html: HTML, version: 4 }),
    putPage: async () => { throw new Error('must not write'); },
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /changed since you saw it/);
  const same = await applySuggestion({ issueKey: 'PAY-1', findingId: 'f1', approver: 'Dana', expectedAfter: 'Call POST /api/v2/charge' }, {
    buildModel: async () => model(),
    getPageSource: async () => ({ id: '111', title: 'Runbook', html: HTML, version: 4 }),
    putPage: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(same.ok, true);
});
