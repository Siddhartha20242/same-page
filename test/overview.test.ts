import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, overviewJql, runOverview, MAX_ITEMS } from '../src/overview.ts';
import { checkPage, bylineTitle } from '../src/pageCheck.ts';
import { createJob } from '../src/job.ts';
import type { Issue } from '../src/types.ts';

const issue = (key: string, summary: string, status = 'In Progress'): Issue => ({ key, summary, status, components: [], fixVersions: [], labels: [], requiredFields: [], fields: {} });
const T = { at: '2026-10-01T00:00:00Z', by: 'Sam' };
const page = (text: string) => ({ title: 'Runbook', text, modifiedAt: '2026-08-01T00:00:00Z', labels: [] as string[] });

test('overviewJql accepts plain keys only', () => {
  assert.match(overviewJql('PAY') as string, /project = "PAY"/);
  assert.equal(overviewJql('PAY" OR 1=1'), null);
  assert.equal(overviewJql(undefined), null);
});

test('runOverview: verdicts, counts, reasons and honest summary', async () => {
  const items = [issue('PAY-1', 'Migrate to v2'), issue('PAY-2', 'Improve search'), issue('PAY-3', 'Move to v2')];
  const r = await runOverview('PAY', {
    searchIssues: async () => items,
    loadIssue: async (k) => items.find((i) => i.key === k) as Issue,
    getTransition: async () => T,
    getRemoteLinkIds: async (k) => (k === 'PAY-1' ? ['111'] : []),
    searchPages: async () => [],
    getPageBody: async (id) => (id === '111' ? page('Call POST /api/v1/charge to charge.') : null),
  });
  assert.equal(r.status, 'ready');
  if (r.status !== 'ready') return;
  assert.equal(r.rows[0]?.verdict, 'Blocked');
  assert.equal(r.rows[0]?.findings, 1);
  assert.equal(r.rows[1]?.verdict, 'Not checked');
  assert.match(r.rows[1]?.reason ?? '', /no related Confluence page/);
  assert.equal(r.rows[2]?.verdict, 'Not checked');
  assert.match(r.summaryLine, /^1 of 1 checked item has contradictions; 2 could not be checked/);
  assert.equal(r.coverageLine, null);
});

test('a request budget stops the run and says checked first N of M', async () => {
  const items = Array.from({ length: 6 }, (_, i) => issue(`PAY-${i + 1}`, 'Migrate to v2'));
  const r = await runOverview('PAY', {
    searchIssues: async () => items, loadIssue: async (k) => items.find((i) => i.key === k) as Issue,
    getTransition: async () => T, getRemoteLinkIds: async () => [], searchPages: async () => [], getPageBody: async () => null,
  }, { maxRequests: 30 });
  if (r.status !== 'ready') return assert.fail('expected ready');
  assert.ok(r.attempted < 6 && r.attempted > 0);
  assert.match(r.coverageLine ?? '', new RegExp(`first ${r.attempted} of 6`));
  assert.ok(r.rows.slice(r.attempted).every((x) => x.verdict === 'Not checked' && /not reached/.test(x.reason ?? '')));
});

test('more than the cap is reported, not hidden', async () => {
  const items = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => issue(`PAY-${i + 1}`, 'No version here'));
  const r = await runOverview('PAY', { searchIssues: async () => items, loadIssue: async (k) => items.find((i) => i.key === k) as Issue, getTransition: async () => T, getRemoteLinkIds: async () => [], searchPages: async () => [] });
  if (r.status !== 'ready') return assert.fail('expected ready');
  assert.equal(r.total, MAX_ITEMS);
  assert.match(r.coverageLine ?? '', /more than 20/);
});

test('a rate limit leaves the rest as not checked with the reason', () => {
  const o = buildOverview({ issues: [{ key: 'A-1' }], job: { ...createJob(['A-1']), retryAfterSec: 30 } });
  assert.match(o.rows[0]?.reason ?? '', /rate limited.*30/);
});

test('empty project says so', () => {
  assert.match(buildOverview({ issues: [], job: createJob([]) }).summaryLine, /No open epics/);
});

const pc = (text: string, status = 'In Progress') => checkPage('111', {
  loadPage: async () => page(text),
  loadIssue: async (k) => (k === 'PAY-1' ? issue('PAY-1', 'Migrate to v2', status) : issue(k, 'Other', 'Done')),
  getTransition: async () => T,
});

test('byline: a page contradicting a named work item reports rule, summary and key', async () => {
  const r = await pc('Per PAY-1 call POST /api/v1/charge to charge.');
  assert.equal(r.status, 'issues');
  if (r.status !== 'issues') return;
  assert.equal(r.issues[0]?.key, 'PAY-1');
  assert.equal(r.issues[0]?.rule, 'Stale version');
  assert.equal(bylineTitle(r), 'Same Page: 1 issue');
  assert.deepEqual(Object.keys(r.issues[0] ?? {}).sort(), ['key', 'rule', 'ruleId', 'severity', 'summary']);
});

test('byline: clean, no keys, unreadable and error wording', async () => {
  assert.equal(bylineTitle(await pc('PAY-1 uses POST /api/v2/charge.')), 'Same Page: no issues');
  const none = await pc('nothing named here');
  assert.equal(none.status, 'unchecked');
  assert.equal(bylineTitle(none), 'Same Page: not checked');
  const hidden = await checkPage('1', { loadPage: async () => null, loadIssue: async () => issue('X-1', ''), getTransition: async () => T });
  assert.equal(hidden.status, 'unchecked');
  assert.equal(bylineTitle({ status: 'error' }), 'Same Page: could not check');
});
