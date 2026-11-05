import test from 'node:test';
import assert from 'node:assert/strict';
import { addPin, alertText, processPageUpdate, regressionOn } from '../src/pin.ts';
import type { Issue } from '../src/types.ts';

const issue = (over: Partial<Issue> = {}): Issue => ({ key: 'PAY-1', summary: 'Migrate to v2', status: 'In Progress', components: [], fixVersions: [], labels: [], requiredFields: [], fields: {}, ...over });
const mem = (seed: Record<string, unknown> = {}) => { const m = new Map<string, unknown>(Object.entries(seed)); return { m, get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('pins are added once per work item and capped', () => {
  assert.deepEqual(addPin(undefined, 'PAY-1'), { issues: ['PAY-1'] });
  assert.deepEqual(addPin({ issues: ['PAY-1'] }, 'PAY-1'), { issues: ['PAY-1'] });
  assert.deepEqual(addPin({ issues: ['PAY-1'] }, 'PAY-2'), { issues: ['PAY-1', 'PAY-2'] });
  assert.equal(addPin({ issues: Array.from({ length: 25 }, (_, i) => `K-${i}`) }, 'NEW-1').issues.length, 20);
  assert.deepEqual(addPin('garbage', 'PAY-1'), { issues: ['PAY-1'] });
});

test('a regression is the old version coming back, judged on content alone (an edit AFTER the status change still counts)', () => {
  assert.deepEqual(regressionOn(issue(), 'Call POST /api/v1/charge'), { version: 'v1', target: 'v2' });
  assert.equal(regressionOn(issue(), 'Call POST /api/v2/charge'), null);
  assert.equal(regressionOn(issue(), 'Mentions v1 and v2 in a migration table'), null);        // the target is named: not a regression
  assert.equal(regressionOn(issue({ summary: 'No version here' }), 'Call POST /api/v1/charge'), null);   // no target: nothing to compare with
  assert.equal(regressionOn(issue(), 'Rollback only: we used to call v1 before the migration'), null);    // historical wording
});

test('an edit that brings v1 back comments once, stays quiet while it is still wrong, and alerts again after a fix and a second regression', async () => {
  const store = mem();
  let text = 'Call POST /api/v2/charge';
  const comments: string[] = [];
  const deps = { store, readPins: async () => ({ issues: ['PAY-1'] }), loadIssue: async () => issue(), loadPageText: async () => text, postComment: async (_k: string, t: string) => { comments.push(t); } };
  assert.deepEqual(await processPageUpdate('9', deps), { checked: 1, alerted: 0 });          // edited, still fine
  text = 'Call POST /api/v1/charge';
  assert.deepEqual(await processPageUpdate('9', deps), { checked: 1, alerted: 1 });          // regression: one comment
  assert.deepEqual(await processPageUpdate('9', deps), { checked: 1, alerted: 0 });          // edited again, still wrong: no second comment
  text = 'Call POST /api/v2/charge';
  await processPageUpdate('9', deps);                                                        // fixed again
  text = 'Call POST /api/v1/charge';
  assert.deepEqual(await processPageUpdate('9', deps), { checked: 1, alerted: 1 });          // a NEW regression alerts again
  assert.equal(comments.length, 2);
  assert.match(comments[0]!, /PAY-1.*v1 again.*targets v2/);
});

test('the alert carries no page title and no page text, and pages nobody pinned are ignored', async () => {
  assert.ok(!/Runbook|charge|POST/.test(alertText('PAY-1', { version: 'v1', target: 'v2' })));
  const comments: string[] = [];
  const out = await processPageUpdate('404', { store: mem(), readPins: async () => null, loadIssue: async () => issue(), loadPageText: async () => 'v1', postComment: async (_k, t) => { comments.push(t); } });
  assert.deepEqual(out, { checked: 0, alerted: 0 });
  assert.equal(comments.length, 0);
});

test('one unreadable pair does not stop the others, and the cache hook runs for each re-checked pair', async () => {
  const store = mem();
  const refreshed: string[] = []; const errors: string[] = [];
  const out = await processPageUpdate('9', {
    store, readPins: async () => ({ issues: ['BAD-1', 'PAY-1'] }), loadPageText: async () => 'Call POST /api/v1/charge', postComment: async () => {},
    loadIssue: async (k) => { if (k === 'BAD-1') throw new Error('HTTP 403'); return issue(); },
    onChecked: async (k) => { refreshed.push(k); },
    onError: (k) => { errors.push(k); },
  });
  assert.deepEqual(out, { checked: 2, alerted: 1 });
  assert.deepEqual(refreshed, ['PAY-1']);
  assert.deepEqual(errors, ['BAD-1']);                       // the reason is reported, not swallowed
  assert.deepEqual(await processPageUpdate('9', { store, readPins: async () => ({ issues: ['PAY-1'] }), loadPageText: async () => null, loadIssue: async () => issue(), postComment: async () => {} }), { checked: 0, alerted: 0 });   // page unreadable: skipped
});
