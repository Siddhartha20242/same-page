import test from 'node:test';
import assert from 'node:assert/strict';
import { filterModelByTriage, ruleNoise, ruleNoiseFromCounts, dismissById } from '../src/triage.ts';
import { appendToStore, headOf, verifyStored } from '../src/ledgerStore.ts';
import { runDriftScan } from '../src/drift.ts';
import { markSeen } from '../src/metrics.ts';
import { triageFinding, loadTriage } from '../src/panelActions.ts';

// A store whose every operation takes a turn of the event loop, so concurrent callers really interleave.
const slow = (m: Map<string, unknown> = new Map()) => { const tick = () => new Promise<void>((r) => setImmediate(r)); let inFlight = 0; let peak = 0;
  return { m, peak: () => peak, get: async (k: string) => { inFlight++; peak = Math.max(peak, inFlight); await tick(); inFlight--; return m.get(k) as never; }, set: async (k: string, v: unknown) => { await tick(); m.set(k, v); } }; };

test('when every finding is snoozed or dismissed, what was read and which rules were skipped still come through', () => {
  const model = { issueKey: 'PAY-1', status: 'findings', verdict: 'BLOCKED', pagesChecked: 2, pageTitles: ['Runbook'], readFromTicket: ['target API version v2'], skippedRules: ['R1 stale version (this work item names no target version)'], findings: [{ id: 'a', severity: 'block' }], notes: [] };
  const out = filterModelByTriage(model as never, dismissById({}, 'a', 'intended', 'u')) as Record<string, unknown>;
  assert.equal(out.status, 'clean');
  assert.equal(out.hidden, 1);
  assert.deepEqual(out.pageTitles, ['Runbook']);
  assert.deepEqual(out.readFromTicket, ['target API version v2']);
  assert.equal((out.skippedRules as string[]).length, 1);
  assert.equal('findings' in out, false);
  assert.equal('verdict' in out, false);
});

test('the noisy-rule judgement from counters matches the one from a list of outcomes, without building the list', () => {
  const counts = { R1_VERSION_MISMATCH: { dismissed: 4, acted: 1 }, R4_STATUS_CLAIM_STALE: { dismissed: 1, acted: 8 }, R2_X: { dismissed: 0, acted: 0 }, R3_Y: { dismissed: 3, acted: 0 } };
  const history = Object.entries(counts).flatMap(([ruleId, c]) => [...Array(c.dismissed).fill({ ruleId, outcome: 'dismissed' }), ...Array(c.acted).fill({ ruleId, outcome: 'acted' })]);
  const a = ruleNoise(history as never).sort((x, y) => x.ruleId.localeCompare(y.ruleId));
  const b = ruleNoiseFromCounts(counts).sort((x, y) => x.ruleId.localeCompare(y.ruleId));
  assert.deepEqual(b, a);
  assert.equal(ruleNoiseFromCounts({ R1: { dismissed: 1e9, acted: 0 } })[0]!.samples, 1000);   // counters are capped
  assert.deepEqual(ruleNoiseFromCounts({ R1: { dismissed: NaN, acted: -5 } } as never), []);
});

test('two requests appending to the ledger at once both end up in a chain that verifies', async () => {
  const kv = slow();
  const f = (n: string) => ({ ruleId: `R1:${n}`, evidence: { workItem: { key: `PAY-${n}` } } }) as never;
  await Promise.all([appendToStore(kv as never, f('1')), appendToStore(kv as never, f('2'))]);
  const v = await verifyStored(kv as never);
  assert.equal(v.ok, true);
  assert.equal((await headOf(kv as never)).length, 2);
  const keys = [0, 1].map((i) => (kv.m.get(`ledger:e:${i}`) as { ruleId: string }).ruleId).sort();
  assert.deepEqual(keys, ['R1:1', 'R1:2']);                                              // neither event was overwritten
});

test('three at once keep a valid chain, and verifying a page of entries reads them together', async () => {
  const kv = slow();
  await Promise.all(['1', '2', '3'].map((n) => appendToStore(kv as never, { ruleId: `R1:${n}`, evidence: { workItem: { key: `PAY-${n}` } } } as never)));
  assert.equal((await verifyStored(kv as never)).ok, true);
  assert.ok((await headOf(kv as never)).length >= 2);
  for (let i = 0; i < 20; i++) await appendToStore(kv as never, { ruleId: `R1:x${i}`, evidence: { workItem: { key: 'PAY-9' } } } as never);
  const reads = slow(kv.m);                                                              // the same data, read through a fresh counter
  await verifyStored(reads as never);
  assert.ok(reads.peak() > 1, `peak concurrent reads was ${reads.peak()}`);
});

test('a drift scan survives a previous snapshot with a missing or malformed shape', async () => {
  const store = { get: async () => ({ at: '2026-01-01T00:00:00Z', projects: undefined }), set: async () => undefined };
  const deps = { searchIssues: async () => [], loadIssue: async () => { throw new Error('none'); }, getTransition: async () => null, getRemoteLinkIds: async () => [], searchPages: async () => [] } as never;
  assert.equal((await runDriftScan(deps, store as never)).scanned, 0);
  const bad = { get: async () => ({ at: 'x', projects: { PAY: {} } }), set: async () => undefined };
  assert.equal((await runDriftScan({ ...(deps as object), searchIssues: async () => [] } as never, bad as never)).scanned, 0);
});

test('a finding whose first-seen event could not be written is retried, and counted, the next time it is shown', async () => {
  const m = new Map<string, unknown>(); const store = { get: async (k: string) => m.get(k) as never, set: async (k: string, v: unknown) => { m.set(k, v); } };
  assert.deepEqual(await markSeen(store as never, ['f1'], async () => false), []);        // the event failed: not seen yet
  assert.equal(m.get('metrics:seen:f1'), 0);
  assert.equal([...m.keys()].some((k) => k.startsWith('metrics:counts') || k === 'metrics:counts'), false);   // and not counted
  assert.deepEqual(await markSeen(store as never, ['f1'], async () => true), ['f1']);     // next time it is written and counted
  assert.deepEqual(await markSeen(store as never, ['f1'], async () => { throw new Error('must not run again'); }), []);
});

test('two people dismissing different findings on one work item at the same moment both stick', async () => {
  const kv = slow();
  const model = { issueKey: 'PAY-1', status: 'findings', findings: [{ id: 'a', ruleId: 'R1', pageId: '1', severity: 'block' }, { id: 'b', ruleId: 'R2', pageId: '2', severity: 'warn' }], notes: [] };
  const deps = { buildModel: async () => model as never, store: kv as never };
  await Promise.all([
    triageFinding({ issueKey: 'PAY-1', findingId: 'a', kind: 'dismiss', reason: 'intended', by: 'u1' }, deps),
    triageFinding({ issueKey: 'PAY-1', findingId: 'b', kind: 'dismiss', reason: 'also intended', by: 'u2' }, deps),
  ]);
  const records = await loadTriage('PAY-1', kv as never);
  assert.deepEqual(Object.keys(records).sort(), ['a', 'b']);
});
