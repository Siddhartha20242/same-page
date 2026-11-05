import test from 'node:test';
import assert from 'node:assert/strict';
import { movedToDone, runSoftGate, commentText } from '../src/softGate.ts';
import { runDriftScan, loadDrift } from '../src/drift.ts';

const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };
const done = { issue: { key: 'PAY-1' }, changelog: { items: [{ field: 'status', toString: 'Done' }] } };

test('only a move into a finished status counts, and the app\'s own events are ignored', async () => {
  assert.equal(movedToDone(done), true);
  assert.equal(movedToDone({ changelog: { items: [{ field: 'status', toString: 'In Progress' }] } }), false);
  assert.equal(movedToDone({ changelog: { items: [{ field: 'summary', toString: 'Done' }] } }), false);
  const calls: string[] = [];
  const deps = { store: mem(), blockers: async () => [{ id: 'a', ruleId: 'R1_VERSION_MISMATCH' }], postComment: async (_k: string, t: string) => { calls.push(t); } };
  assert.equal(await runSoftGate({ ...done, selfGenerated: true }, deps), 'ignored');
  assert.equal(calls.length, 0);
});

test('a Done move with open blockers posts one notice naming rules and a count, never page text, and does not repeat', async () => {
  const calls: string[] = [];
  const deps = { store: mem(), blockers: async () => [{ id: 'a', ruleId: 'R1_VERSION_MISMATCH' }, { id: 'b', ruleId: 'R2_DEPRECATED_DECISION_ACTIVE_WORK' }], postComment: async (_k: string, t: string) => { calls.push(t); } };
  assert.equal(await runSoftGate(done, deps), 'commented');
  assert.equal(await runSoftGate(done, deps), 'already-noted');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /2 blocking contradictions/);
  assert.match(calls[0]!, /R1 Stale version, R2 Deprecated decision/);
  assert.match(calls[0]!, /notice, not a block/);
});

test('a clean item, an unreadable item and a changed set of blockers', async () => {
  const mk = (b: { id: string; ruleId: string }[] | null) => ({ store: store, blockers: async () => b, postComment: async () => undefined });
  const store = mem();
  assert.equal(await runSoftGate(done, mk([])), 'clean');
  assert.equal(await runSoftGate(done, mk(null)), 'unchecked');
  assert.equal(await runSoftGate(done, mk([{ id: 'a', ruleId: 'R1_VERSION_MISMATCH' }])), 'commented');
  assert.equal(await runSoftGate(done, mk([{ id: 'a', ruleId: 'R1_VERSION_MISMATCH' }, { id: 'c', ruleId: 'R5_SPEC_DISAGREES' }])), 'commented');
  assert.match(commentText([{ id: 'a', ruleId: 'R1_VERSION_MISMATCH' }]), /1 blocking contradiction with its docs is still open/);
});

test('the weekly drift scan keeps per-project counts and says which findings are new since the last scan', async () => {
  const store = mem();
  const issues = [{ key: 'PAY-1', summary: 'a' }, { key: 'PAY-2', summary: 'b' }, { key: 'OPS-1', summary: 'c' }];
  let bad = ['PAY-1'];
  const deps = {
    searchIssues: async () => issues,
    loadIssue: async (k: string) => ({ key: k, summary: `Token expiry ${k}`, status: 'In Progress', components: [], fixVersions: [], labels: [], requiredFields: [], fields: {}, description: 'Token expiry is 1 hour' }),
    getTransition: async () => ({ at: '2026-10-01T00:00:00Z', by: 'Sam' }),
    getRemoteLinkIds: async () => [],
    searchPages: async (i: { key: string }) => [{ id: `p-${i.key}`, title: `Token expiry ${i.key}`, text: bad.includes(i.key) ? 'Tokens expire after 30 minutes.' : 'Tokens expire after 1 hour.', modifiedAt: '2026-01-01T00:00:00Z', labels: [] }],
  };
  const a = await runDriftScan(deps, store, () => Date.parse('2026-11-01T00:00:00Z'));
  assert.deepEqual(a.projects.PAY, { withContradictions: 1, checked: 2, newSincePrevious: 1, keys: ['PAY-1'] });
  assert.equal(a.projects.OPS?.withContradictions, 0);
  bad = ['PAY-1', 'PAY-2'];
  const b = await runDriftScan(deps, store, () => Date.parse('2026-11-08T00:00:00Z'));
  assert.equal(b.projects.PAY?.withContradictions, 2);
  assert.equal(b.projects.PAY?.newSincePrevious, 1);                       // PAY-1 was already there
  const seen = await loadDrift(store, 'PAY');
  assert.equal(seen?.project?.withContradictions, 2);
  assert.equal(await loadDrift(mem(), 'PAY'), null);
});
