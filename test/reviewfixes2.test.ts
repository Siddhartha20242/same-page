import test from 'node:test';
import assert from 'node:assert/strict';
import { findingHistory } from '../src/tools.ts';
import { recordHandling } from '../src/handling.ts';
import { recentForViewer } from '../src/ledgerStore.ts';
import { cacheableFromPanel, formatBlockMessage, redactFor, snapshotFromModel } from '../src/gate.ts';
import { checkCanon, searchWords } from '../src/canon.ts';

const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('finding history for a work item the caller cannot see answers like one with no history, and never reveals what people typed', async () => {
  const kv = mem();
  await recordHandling(kv as never, { event: 'DISMISSED', ruleId: 'R1_VERSION_MISMATCH', issueKey: 'SECRET-12', pageId: '9', note: 'reason: contains the acquisition codename', by: 'acct-1' });
  const visible = await findingHistory({ issueKey: 'SECRET-12' }, kv as never, async () => true) as { status: string; events: { note: string }[] };
  assert.equal(visible.status, 'found');
  assert.match(visible.events[0]!.note, /acquisition codename/);
  const hidden = await findingHistory({ issueKey: 'SECRET-12' }, kv as never, async () => false) as { status: string; events: unknown[]; note: string };
  assert.equal(hidden.status, 'none');
  assert.deepEqual(hidden.events, []);
  assert.doesNotMatch(JSON.stringify(hidden), /codename/);
  const none = await findingHistory({ issueKey: 'PAY-77' }, kv as never, async () => true) as { status: string; note: string };
  assert.equal(none.note, hidden.note);                                                   // the two answers are indistinguishable
});

test('the audit trail shows a viewer only the current work item, and a Jira administrator the latest site-wide', () => {
  const rows = [{ seq: 0, issueKey: 'PAY-1' }, { seq: 1, issueKey: 'SECRET-12' }, { seq: 2, issueKey: 'PAY-1' }, undefined, { seq: 4, issueKey: null }, { seq: 5, issueKey: 'SECRET-12' }];
  assert.deepEqual(recentForViewer(rows, { admin: false, current: 'PAY-1' }).map((r) => r.seq), [0, 2]);
  assert.deepEqual(recentForViewer(rows, { admin: false }).map((r) => r.seq), []);          // no work item context: nothing site-wide
  assert.deepEqual(recentForViewer(rows, { admin: true }).map((r) => r.seq), [0, 1, 2, 4, 5]);
  assert.deepEqual(recentForViewer(rows, { admin: true, max: 2 }).map((r) => r.seq), [4, 5]);
});

test('a two-page finding is shown only to someone who can read both pages', async () => {
  const b = { id: 'abcdef123456', ruleId: 'R7_PAGES_DISAGREE', summary: '"Runbook" documents v1 but "Acquisition plan" documents v2 for POST /api/{version}/charge', pageId: '1', otherPageId: '2', pageTitle: 'Runbook', docLine: 'Call POST /api/v1/charge' };
  const onlyFirst = await redactFor([b], async (id) => id === '1');
  assert.equal(onlyFirst[0]!.hidden, true);
  assert.doesNotMatch(formatBlockMessage('PAY-1', onlyFirst), /Acquisition plan/);
  const both = await redactFor([b], async () => true);
  assert.equal(both[0]!.hidden, undefined);
  assert.match(formatBlockMessage('PAY-1', both), /Acquisition plan/);
  const single = await redactFor([{ ...b, otherPageId: undefined }], async (id) => id === '1');
  assert.equal(single[0]!.hidden, undefined);                                              // an ordinary one-page finding is unchanged
  const snap = snapshotFromModel({ issueKey: 'PAY-1', status: 'findings', verdict: 'BLOCKED', pagesChecked: 2, findings: [{ ...b, severity: 'block', why: 'w', evidence: {} }], notes: [] } as never);
  assert.equal(snap!.blockers[0]!.otherPageId, '2');
});

test('the panel may cache a snapshot with blockers but never an all-clear from one viewer\'s permissions', () => {
  const at = '2026-11-07T00:00:00.000Z';
  assert.deepEqual(cacheableFromPanel({ at, blockers: [] }), null);
  assert.equal(cacheableFromPanel(null), null);
  const blocked = { at, blockers: [{ id: 'x', ruleId: 'R1_VERSION_MISMATCH', summary: 's' }] };
  assert.equal(cacheableFromPanel(blocked), blocked);
});

test('the site-wide search leaves out the matcher\'s own expiry words, so a fact about how long something "lives" still finds pages that say "expires"', () => {
  assert.deepEqual(searchWords('session token lives'), ['session', 'token']);
  assert.deepEqual(searchWords('access token expiry'), ['access', 'token']);
  for (const w of ['timeout', 'ttl', 'lifetime', 'validity', 'lasts', 'timed', 'expiring']) assert.ok(!searchWords(`cache entry ${w}`).includes(w), w);
  assert.deepEqual(searchWords('expiry'), ['expiry']);                                      // with no other word, the search keeps what it has
});

test('a fact check reads its pages together, and reads a page found by two facts once', async () => {
  const reads: string[] = []; let inFlight = 0; let peak = 0;
  const deps = {
    search: async () => [{ id: '1', title: 'A' }, { id: '2', title: 'B' }, { id: '3', title: 'C' }],
    getPage: async (id: string) => { reads.push(id); inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight--; return { title: `Page ${id}`, text: 'Access tokens expire after 30 minutes.' }; },
  };
  const out = await checkCanon([{ id: 'F1', subject: 'access token expiry', value: '1 hour' }, { id: 'F2', subject: 'session token expiry', value: '1 hour' }], deps);
  assert.deepEqual(reads.sort(), ['1', '2', '3']);                                          // three pages, each read once, although two facts found them
  assert.ok(peak >= 3, `peak was ${peak}`);
  assert.equal(out.results[0]!.pagesRead, 3);
  assert.equal(out.results[0]!.pages.length, 3);
});
