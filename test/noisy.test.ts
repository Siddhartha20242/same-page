import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNoisyRules, recordOutcome, withNoisyRules, filterModelByTriage } from '../src/triage.ts';
import { triageFinding } from '../src/panelActions.ts';
import { snapshotFromModel } from '../src/gate.ts';

const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };
const finding = (id: string, ruleId: string, severity: string) => ({ id, ruleId, severity, summary: 's', why: 'w', evidence: {} });
const model = (findings: ReturnType<typeof finding>[]) => ({ issueKey: 'PAY-1', status: 'findings', verdict: findings.some((f) => f.severity === 'block') ? 'BLOCKED' : 'WARN', pagesChecked: 1, findings, notes: [] }) as never;

test('a rule dismissed often enough gets a calm hint', async () => {
  const s = mem();
  for (let i = 0; i < 4; i++) await recordOutcome(s, 'R4_STATUS_CLAIM_STALE', 'dismissed');
  await recordOutcome(s, 'R4_STATUS_CLAIM_STALE', 'acted');
  const noisy = await loadNoisyRules(s);
  assert.equal(noisy.length, 1);
  assert.equal(noisy[0].message, 'Rule R4 has been dismissed 4 of 5 times on this site. If it is usually wrong for your team, a site admin can change its severity under Rules.');
  const m = withNoisyRules(model([finding('1', 'R4_STATUS_CLAIM_STALE', 'warn')]), noisy) as { noisyRules?: unknown[] };
  assert.equal(m.noisyRules?.length, 1);
});

test('no hint when the rule is mostly acted on, has too few samples, or has no data', async () => {
  const s = mem();
  assert.deepEqual(await loadNoisyRules(s), []);                                  // silent without data
  for (let i = 0; i < 2; i++) await recordOutcome(s, 'R1_VERSION_MISMATCH', 'dismissed');
  assert.deepEqual(await loadNoisyRules(s), []);                                  // too few samples
  for (let i = 0; i < 6; i++) await recordOutcome(s, 'R1_VERSION_MISMATCH', 'acted');
  assert.deepEqual(await loadNoisyRules(s), []);                                  // mostly acted on
  assert.deepEqual(await loadNoisyRules({ get: async () => { throw new Error('down'); }, set: async () => {} }), []);
});

test('the hint appears only for rules that are in this panel, and a missing hint changes nothing', async () => {
  const noisy = [{ ruleId: 'R4_STATUS_CLAIM_STALE', dismissed: 4, message: 'x' }];
  const m = model([finding('1', 'R1_VERSION_MISMATCH', 'block')]);
  assert.equal(withNoisyRules(m, noisy), m);
});

test('a noisy rule never hides a finding, changes a severity, or stops a blocker from blocking', async () => {
  const noisy = [{ ruleId: 'R1_VERSION_MISMATCH', dismissed: 9, message: 'x' }];
  const m = model([finding('1', 'R1_VERSION_MISMATCH', 'block'), finding('2', 'R4_STATUS_CLAIM_STALE', 'warn')]);
  const out = withNoisyRules(filterModelByTriage(m as never, {}), noisy) as { findings: { severity: string }[]; verdict: string };
  assert.deepEqual(out.findings.map((f) => f.severity), ['block', 'warn']);
  assert.equal(out.verdict, 'BLOCKED');
  assert.equal(snapshotFromModel(out as never)?.blockers.length, 1);
});

test('dismissing through triageFinding records the outcome; snoozing does not', async () => {
  const s = mem();
  const buildModel = async () => model([finding('f1', 'R4_STATUS_CLAIM_STALE', 'warn')]);
  await triageFinding({ issueKey: 'PAY-1', findingId: 'f1', kind: 'snooze', until: '2099-01-01T00:00:00Z' }, { buildModel, store: s });
  assert.equal(await s.get('noise:outcomes'), undefined);
  await triageFinding({ issueKey: 'PAY-1', findingId: 'f1', kind: 'dismiss', reason: 'ok' }, { buildModel, store: s });
  assert.deepEqual(await s.get('noise:outcomes'), { R4_STATUS_CLAIM_STALE: { dismissed: 1, acted: 0 } });
});
