import test from 'node:test';
import assert from 'node:assert/strict';
import { citedTicketClosed, BUILT_IN_RULES } from '../src/rules.ts';
import { checkIssue } from '../src/release.ts';
import { buildPanelModel } from '../src/panelModel.ts';

const WORK = { key: 'PAY-1', apiVersion: 'v2', status: 'In Progress', statusChangedAt: '2026-11-02T00:00:00Z' } as never;
const page = (text: string) => ({ id: 'p', title: 'Runbook', text, modifiedAt: '2026-10-01T00:00:00Z', labels: [] });
const run = (text: string, cited: Record<string, { status: string }> | undefined) => citedTicketClosed.run({ workItem: WORK, page: page(text), cited });

test('R6 fires when a page treats a closed ticket as still open, in both phrasings', () => {
  const a = run('Rollout is blocked by PAY-9 until it lands.', { 'PAY-9': { status: 'Done' } });
  assert.equal(a.length, 1);
  assert.equal(a[0].severity, 'warn');
  assert.deepEqual(a[0].evidence.cited, { key: 'PAY-9', status: 'Done' });
  assert.equal(run('PAY-9 is still in progress, do not enable the flag.', { 'PAY-9': { status: 'Closed' } }).length, 1);
});

test('R6 stays silent for open tickets, history, its own ticket, other keys, and missing data', () => {
  assert.equal(run('Rollout is blocked by PAY-9.', { 'PAY-9': { status: 'In Progress' } }).length, 0);
  assert.equal(run('This was blocked by PAY-9 last quarter.', { 'PAY-9': { status: 'Done' } }).length, 0);
  assert.equal(run('PAY-1 is still open.', { 'PAY-1': { status: 'Done' } }).length, 0);          // the work item itself is R4's job
  assert.equal(run('blocked by PAY-99', { 'PAY-9': { status: 'Done' } }).length, 0);              // PAY-9 must not match PAY-99
  assert.equal(run('PAY-9 shipped in v2.', { 'PAY-9': { status: 'Done' } }).length, 0);
  assert.equal(run('Rollout is blocked by PAY-9.', undefined).length, 0);
  assert.equal(run('Rollout is blocked by PAY-9.', {}).length, 0);
});

test('R6 is a warning, so it can never block a transition, and it is part of the built-in set', () => {
  assert.ok(BUILT_IN_RULES.includes(citedTicketClosed));
  assert.notEqual(citedTicketClosed.severity, 'block');
});

const mk = (key: string, status: string) => ({ key, summary: 'Migrate to v2', status, components: [], fixVersions: [], labels: [], requiredFields: [], fields: {} });
const issue = (key: string, status: string) => mk(key, status) as never;
const deps = (statuses: Record<string, string>, text: string) => ({
  loadIssue: async (k: string) => { if (!statuses[k]) throw new Error('404'); return issue(k, statuses[k]); },
  getTransition: async () => ({ at: '2026-11-02T00:00:00Z', by: 'Dana' }),
  getRemoteLinkIds: async () => ['p'],
  searchPages: async () => [{ id: 'p', title: 'Runbook', text, labels: [] }],
  getPageBody: async () => ({ text, modifiedAt: '2026-10-01T00:00:00Z', labels: [], title: 'Runbook' }),
}) as never;

test('end to end: the cited ticket status is read from Jira and the finding reaches the panel with plain wording', async () => {
  const text = 'Call POST /api/v2/charge. The rollout is blocked by PAY-9 until it lands.';
  const model = await buildPanelModel('PAY-1', { ...(deps({ 'PAY-1': 'In Progress', 'PAY-9': 'Done' }, text) as object), loadIssue: async (k: string) => mk(k, k === 'PAY-9' ? 'Done' : 'In Progress') } as never);
  assert.equal(model.status, 'findings');
  if (model.status !== 'findings') return;
  const f = model.findings.find((x) => x.ruleId === 'R6_CITED_TICKET_CLOSED')!;
  assert.equal(f.evidence.ticket, 'PAY-9 is Done in Jira');
  assert.deepEqual(model.pageTitles, ['Runbook']);
});

test('an unreadable cited ticket is skipped, not fatal, and at most 5 are read', async () => {
  const text = 'blocked by PAY-2 and PAY-3. Also PAY-4 PAY-5 PAY-6 PAY-7 PAY-8';
  let reads = 0;
  const d = { ...(deps({}, text) as object), loadIssue: async (k: string) => { reads++; if (k === 'PAY-1') return issue(k, 'In Progress'); throw new Error('no access'); } };
  const out = await checkIssue(issue('PAY-1', 'In Progress'), d as never);
  assert.ok(['clean', 'notes', 'findings'].includes(out.status));
  assert.ok(reads <= 5);
});

test('a dated log line is history, not a claim: R6 and R4 stay silent on it', () => {
  assert.equal(run('2017-10-31: waiting on PAY-9 before we cut the release.', { 'PAY-9': { status: 'Done' } }).length, 0);
  assert.equal(run('Oct 31 - blocked by PAY-9.', { 'PAY-9': { status: 'Done' } }).length, 0);
  assert.equal(run('Rollout is blocked by PAY-9 (see 2017-10-31 notes).', { 'PAY-9': { status: 'Done' } }).length, 1);   // a date AFTER the key does not excuse it
});
