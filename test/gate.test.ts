import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTransition, formatBlockMessage, snapshotFromModel, gateKey, redactFor } from '../src/gate.ts';
import type { GateSnapshot, GateStore } from '../src/gate.ts';
import type { PanelModel, PanelFinding } from '../src/panelModel.ts';

const T0 = Date.parse('2026-11-05T12:00:00Z');
const memStore = (seed: Record<string, unknown> = {}): GateStore & { m: Map<string, unknown> } => {
  const m = new Map(Object.entries(seed));
  return { m, get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } };
};
const seeAll = async () => true;
const blocker = { id: 'f1', pageId: '111', ruleId: 'R1_VERSION_MISMATCH', summary: 'Page documents v1 but PAY-1 targets v2', pageTitle: 'Payment Runbook', docLine: 'Call POST /api/v1/charge', ticket: 'PAY-1 targets v2' };
const snap = (blockers = [blocker], at = new Date(T0).toISOString()): GateSnapshot => ({ at, blockers });

const finding = (over: Partial<PanelFinding> = {}) => ({
  id: 'f1', ruleId: 'R1_VERSION_MISMATCH', severity: 'block', summary: 's', why: 'w', pageId: '1', pageTitle: 'P',
  evidence: { docLine: 'Call /api/v1/x', ticket: 'PAY-1 targets v2' }, suggestion: null, ...over,
}) as unknown as PanelFinding;
const findingsModel = (findings: PanelFinding[]): PanelModel => ({ issueKey: 'PAY-1', status: 'findings', verdict: 'BLOCKED', pagesChecked: 1, findings, notes: [] });

test('only block-severity findings become blockers; warnings, notes, unchecked and errors never do', () => {
  assert.equal(snapshotFromModel(findingsModel([finding()]), () => T0)!.blockers.length, 1);
  assert.equal(snapshotFromModel(findingsModel([finding({ severity: 'warn' })]), () => T0)!.blockers.length, 0);
  assert.equal(snapshotFromModel({ issueKey: 'PAY-1', status: 'notes', verdict: 'PASS', pagesChecked: 1, findings: [], notes: [finding({ severity: 'info' })] }, () => T0)!.blockers.length, 0);
  assert.deepEqual(snapshotFromModel({ issueKey: 'PAY-1', status: 'clean', pagesChecked: 2 }, () => T0)!.blockers, []);
  assert.equal(snapshotFromModel({ issueKey: 'PAY-1', status: 'unchecked', reason: 'no version' }), null);
  assert.equal(snapshotFromModel({ status: 'error', message: 'x' }), null);
});

test('a fresh cached block stops the transition and the message carries the evidence', async () => {
  const d = await decideTransition({ issueKey: 'PAY-1', store: memStore({ [gateKey('PAY-1')]: snap() }), now: () => T0 + 1000, canView: seeAll });
  assert.equal(d.result, false);
  assert.equal(d.basis, 'cache');
  assert.match(d.errorMessage!, /Same Page blocked/);
  assert.match(d.errorMessage!, /api\/v1\/charge/);
  assert.match(d.errorMessage!, /Payment Runbook/);
  assert.match(d.errorMessage!, /dismiss the finding with a reason/);
});

test('a cached block is re-checked live, and the live answer wins (the page was fixed a minute ago)', async () => {
  const store = memStore({ [gateKey('PAY-1')]: snap() });
  const d = await decideTransition({ issueKey: 'PAY-1', store, now: () => T0 + 1000, live: async () => snap([], new Date(T0 + 1000).toISOString()) });
  assert.equal(d.result, true);
  assert.equal(d.basis, 'live');
  assert.deepEqual((store.m.get(gateKey('PAY-1')) as GateSnapshot).blockers, []);   // cache updated, so the next click is cheap
});

test('FAIL OPEN: a live check that throws, hangs, or returns nothing never blocks without fresh evidence', async () => {
  const throws = await decideTransition({ issueKey: 'PAY-1', store: memStore(), live: async () => { throw new Error('HTTP 500'); } });
  assert.deepEqual([throws.result, throws.basis], [true, 'fail-open']);
  const hangs = await decideTransition({ issueKey: 'PAY-1', store: memStore(), budgetMs: 20, live: () => new Promise(() => {}) });
  assert.deepEqual([hangs.result, hangs.basis], [true, 'fail-open']);
  const unchecked = await decideTransition({ issueKey: 'PAY-1', store: memStore(), live: async () => null });
  assert.equal(unchecked.result, true);
  const nothing = await decideTransition({ issueKey: 'PAY-1', store: memStore() });
  assert.deepEqual([nothing.result, nothing.basis], [true, 'fail-open']);
});

test('a STALE cached block is not evidence: if live also fails, the transition is allowed', async () => {
  const stale = snap([blocker], new Date(T0 - 60 * 60_000).toISOString());
  const d = await decideTransition({ issueKey: 'PAY-1', store: memStore({ [gateKey('PAY-1')]: stale }), now: () => T0, live: async () => { throw new Error('HTTP 429'); } });
  assert.equal(d.result, true);
  assert.equal(d.basis, 'fail-open');
  const cacheOnly = await decideTransition({ issueKey: 'PAY-1', store: memStore({ [gateKey('PAY-1')]: stale }), now: () => T0 });
  assert.equal(cacheOnly.result, true);
});

test('a fresh cached block still holds when the live re-check fails (we do have recent evidence)', async () => {
  const d = await decideTransition({ issueKey: 'PAY-1', store: memStore({ [gateKey('PAY-1')]: snap() }), now: () => T0 + 1000, live: async () => { throw new Error('timeout'); } });
  assert.deepEqual([d.result, d.basis], [false, 'cache']);
});

test('a broken or hostile store never blocks and never throws', async () => {
  const broken: GateStore = { get: async () => { throw new Error('kvs down'); }, set: async () => { throw new Error('kvs down'); } };
  assert.equal((await decideTransition({ issueKey: 'PAY-1', store: broken })).result, true);
  const live = await decideTransition({ issueKey: 'PAY-1', store: broken, live: async () => snap() });
  assert.equal(live.result, false);          // live evidence still counts even if caching fails
  const garbage = memStore({ [gateKey('PAY-1')]: { at: 5, blockers: 'nope' } });
  assert.equal((await decideTransition({ issueKey: 'PAY-1', store: garbage })).result, true);
});

test('the message stays short and flattens wiki text, including multi-line and very long lines', () => {
  const nasty = { ...blocker, docLine: 'line one\nline two '.repeat(100), pageTitle: 'T'.repeat(500) };
  const msg = formatBlockMessage('PAY-1', [nasty, blocker, blocker]);
  assert.ok(msg.length < 800, `message too long: ${msg.length}`);
  assert.ok(!msg.includes('\n'));
  assert.match(msg, /\+2 more/);
  assert.match(formatBlockMessage('PAY-1', [blocker]), /1 provable contradiction with/);
});

test('SECURITY: page text only reaches a person who can read the page; anything unproven is withheld', async () => {
  const store = () => memStore({ [gateKey('PAY-1')]: snap() });
  const deny = await decideTransition({ issueKey: 'PAY-1', store: store(), now: () => T0 + 1000, canView: async () => false });
  assert.equal(deny.result, false);                                            // still blocked: the contradiction is real
  assert.ok(!/Payment Runbook|api\/v1\/charge|v1/.test(deny.errorMessage!), deny.errorMessage);   // but nothing from the page leaks
  assert.match(deny.errorMessage!, /cannot view/);
  const noChecker = await decideTransition({ issueKey: 'PAY-1', store: store(), now: () => T0 + 1000 });
  assert.ok(!/Payment Runbook/.test(noChecker.errorMessage!));                 // no checker: fail closed
  const throws = await decideTransition({ issueKey: 'PAY-1', store: store(), now: () => T0 + 1000, canView: async () => { throw new Error('HTTP 500'); } });
  assert.ok(!/Payment Runbook/.test(throws.errorMessage!));                    // a failing check: fail closed
  const allowed = await decideTransition({ issueKey: 'PAY-1', store: store(), now: () => T0 + 1000, canView: seeAll });
  assert.match(allowed.errorMessage!, /Payment Runbook/);
});

test('redaction is per page: a visible page is quoted even when another is hidden, and a blocker with no page id is hidden', async () => {
  const a = { ...blocker, id: 'a', pageId: '1' }; const b = { ...blocker, id: 'b', pageId: '2', pageTitle: 'Secret' }; const c = { ...blocker, id: 'c', pageId: undefined };
  const out = await redactFor([a, b, c], async (id) => id === '1');
  assert.deepEqual(out.map((x) => Boolean(x.hidden)), [false, true, true]);
  const msg = formatBlockMessage('PAY-1', [out[1]!, out[0]!]);
  assert.match(msg, /Payment Runbook/);
  assert.ok(!/Secret/.test(msg));
});
