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
  assert.deepEqual(a.projects.PAY, { withContradictions: 1, checked: 2, newSincePrevious: 1, resolvedSincePrevious: 0, keys: ['PAY-1'] });
  assert.equal(a.hadPrevious, false);                                     // the first scan has nothing to compare with
  assert.equal(a.projects.OPS?.withContradictions, 0);
  bad = ['PAY-1', 'PAY-2'];
  const b = await runDriftScan(deps, store, () => Date.parse('2026-11-08T00:00:00Z'));
  assert.equal(b.hadPrevious, true);
  assert.equal(b.projects.PAY?.withContradictions, 2);
  assert.equal(b.projects.PAY?.newSincePrevious, 1);                       // PAY-1 was already there
  const seen = await loadDrift(store, 'PAY');
  assert.equal(seen?.project?.withContradictions, 2);
  assert.equal(await loadDrift(mem(), 'PAY'), null);
});

test('the weekly scan also says how many contradictions were resolved since the scan before, and does not count an unchecked item as resolved', async () => {
  const store = mem();
  let bad = ['PAY-1', 'PAY-2'];
  let unreadable = false;
  const deps = {
    searchIssues: async () => [{ key: 'PAY-1', summary: 'a' }, { key: 'PAY-2', summary: 'b' }],
    loadIssue: async (k: string) => { if (unreadable && k === 'PAY-2') throw new Error('nope'); return { key: k, summary: `Token expiry ${k}`, status: 'In Progress', components: [], fixVersions: [], labels: [], requiredFields: [], fields: {}, description: 'Token expiry is 1 hour' }; },
    getTransition: async () => ({ at: '2026-10-01T00:00:00Z', by: 'Sam' }),
    getRemoteLinkIds: async () => [],
    searchPages: async (i: { key: string }) => [{ id: `p-${i.key}`, title: `Token expiry ${i.key}`, text: bad.includes(i.key) ? 'Tokens expire after 30 minutes.' : 'Tokens expire after 1 hour.', modifiedAt: '2026-01-01T00:00:00Z', labels: [] }],
  };
  await runDriftScan(deps, store, () => Date.parse('2026-11-01T00:00:00Z'));
  bad = ['PAY-2'];                       // PAY-1 was fixed
  const b = await runDriftScan(deps, store, () => Date.parse('2026-11-08T00:00:00Z'));
  assert.equal(b.projects.PAY?.resolvedSincePrevious, 1);
  unreadable = true;                     // PAY-2 cannot be read this time: not resolved
  const c = await runDriftScan(deps, store, () => Date.parse('2026-11-15T00:00:00Z'));
  assert.equal(c.projects.PAY?.resolvedSincePrevious, 0);
});

import { runChangeNudge, editedText, nudgeText } from '../src/softGate.ts';
const edit = { issue: { key: 'PAY-1' }, changelog: { items: [{ field: 'description', toString: 'Access token expiry should be 1 hour' }] } };

test('change nudge: an edit that leaves a contradiction gets one notice with rules and a count, never page text', async () => {
  const calls: string[] = [];
  const deps = { store: mem(), findings: async () => [{ id: 'a', ruleId: 'R8_DURATION_DIFFERS' }], postComment: async (_k: string, t: string) => { calls.push(t); } };
  assert.equal(editedText(edit), true);
  assert.equal(await runChangeNudge(edit, deps), 'commented');
  assert.equal(await runChangeNudge(edit, deps), 'already-noted');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /after this edit, 1 contradiction with the linked docs is still open \(R8 Duration differs\)/);
  assert.match(calls[0]!, /notice, not a block/);
});

test('change nudge: stays quiet for other edits, a move to Done, the app\'s own edits, a clean item, and an unreadable one', async () => {
  const mk = (f: { id: string; ruleId: string }[] | null) => ({ store: mem(), findings: async () => f, postComment: async () => { throw new Error('should not comment'); } });
  assert.equal(await runChangeNudge({ ...edit, changelog: { items: [{ field: 'labels', toString: 'x' }] } }, mk([{ id: 'a', ruleId: 'R8_DURATION_DIFFERS' }])), 'ignored');
  assert.equal(await runChangeNudge({ ...edit, selfGenerated: true }, mk([{ id: 'a', ruleId: 'R8_DURATION_DIFFERS' }])), 'ignored');
  assert.equal(await runChangeNudge({ issue: { key: 'PAY-1' }, changelog: { items: [{ field: 'description', toString: 'x' }, { field: 'status', toString: 'Done' }] } }, mk([{ id: 'a', ruleId: 'R8_DURATION_DIFFERS' }])), 'ignored');
  assert.equal(await runChangeNudge(edit, mk([])), 'clean');
  assert.equal(await runChangeNudge(edit, mk(null)), 'unchecked');
});

test('change nudge: once the contradiction is fixed and then returns, it is news again', async () => {
  const calls: string[] = [];
  const store = mem();
  let found = [{ id: 'a', ruleId: 'R8_DURATION_DIFFERS' }];
  const deps = { store, findings: async () => found, postComment: async (_k: string, t: string) => { calls.push(t); } };
  await runChangeNudge(edit, deps);
  found = [];
  assert.equal(await runChangeNudge(edit, deps), 'clean');
  found = [{ id: 'a', ruleId: 'R8_DURATION_DIFFERS' }];
  assert.equal(await runChangeNudge(edit, deps), 'commented');
  assert.equal(calls.length, 2);
  assert.match(nudgeText([{ id: 'a', ruleId: 'R1_VERSION_MISMATCH' }, { id: 'b', ruleId: 'R8_DURATION_DIFFERS' }]), /2 contradictions with the linked docs are still open/);
});
