import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, overviewJql, runOverview, sanitizeCarried, oneLine, MAX_ITEMS } from '../src/overview.ts';
import { bySeverity } from '../src/verdictOrder.ts';
import { checkPage, bylineTitle, bylineTooltip } from '../src/pageCheck.ts';
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

test('a fix version narrows the search to that release, and only a plain name can be used', () => {
  assert.equal(overviewJql('PAY', '2.3'), 'project = "PAY" AND fixVersion = "2.3" AND statusCategory != Done ORDER BY updated DESC');
  assert.equal(overviewJql('PAY', ' Release 2.3-rc1 '), 'project = "PAY" AND fixVersion = "Release 2.3-rc1" AND statusCategory != Done ORDER BY updated DESC');
  assert.match(overviewJql('PAY', '') as string, /issuetype = Epic/, 'an empty version means the whole project');
  assert.match(overviewJql('PAY') as string, /issuetype = Epic/);
  for (const bad of ['2.3" OR project = "X', '2.3\\', 'a"b', '-1', '2.3) OR (1=1', 'x'.repeat(61), '2.3\nOR 1=1', '../x'])
    assert.equal(overviewJql('PAY', bad), null, `rejected: ${JSON.stringify(bad)}`);
  assert.equal(overviewJql('PAY" OR 1=1', '2.3'), null);
});

test('runOverview with a fix version: asks Jira for that release only, labels the result, and explains a version Jira does not know', async () => {
  const items = [issue('PAY-1', 'Migrate to v2')];
  const asked: string[] = [];
  const deps = { searchIssues: async (jql: string) => { asked.push(jql); return items; }, loadIssue: async (k: string) => items.find((i) => i.key === k) as Issue,
    getTransition: async () => T, getRemoteLinkIds: async () => [], searchPages: async () => [], getPageBody: async () => null };
  const r = await runOverview('PAY', deps, {}, [], '2.3');
  if (r.status !== 'ready') return assert.fail('expected ready');
  assert.equal(r.fixVersion, '2.3');
  assert.match(asked[0] as string, /fixVersion = "2\.3"/);
  const none = await runOverview('PAY', { ...deps, searchIssues: async () => [] }, {}, [], '2.3');
  if (none.status !== 'ready') return assert.fail('expected ready');
  assert.match(none.summaryLine, /No open work items found in fix version "2\.3"/);
  const unknown = await runOverview('PAY', { ...deps, searchIssues: async () => { throw Object.assign(new Error('HTTP 400'), { status: 400 }); } }, {}, [], '9.9');
  assert.equal(unknown.status, 'error');
  assert.match((unknown as { message: string }).message, /no fix version "9\.9" in project PAY that you can see/i);
  // other failures are still thrown, and a bad name never reaches Jira
  await assert.rejects(() => runOverview('PAY', { ...deps, searchIssues: async () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); } }, {}, [], '2.3'), /500/);
  const before = asked.length;
  const bad = await runOverview('PAY', deps, {}, [], '2.3" OR 1=1');
  assert.equal(bad.status, 'error');
  assert.equal(asked.length, before, 'an invalid version is rejected before any search');
  // a 400 with no version named is not turned into a version message
  await assert.rejects(() => runOverview('PAY', { ...deps, searchIssues: async () => { throw Object.assign(new Error('HTTP 400'), { status: 400 }); } }), /400/);
});

const checked = (key: string, findings: { severity: 'block' | 'warn' | 'info'; summary: string }[]) =>
  ({ key, status: 'findings', findings: findings.map((f, i) => ({ ruleId: `R${i + 1}`, severity: f.severity, summary: f.summary, pageTitle: 'P', evidence: {} })) }) as never;

test('each row with a finding gets a one-line headline, the blocker first, and nothing is invented for clean or unchecked rows', () => {
  const o = buildOverview({
    issues: [{ key: 'A-1' }, { key: 'A-2' }, { key: 'A-3' }, { key: 'A-4' }],
    job: { ...createJob([]), items: [
      checked('A-1', [{ severity: 'warn', summary: 'Page says 30 minutes, A-1 says 15' }, { severity: 'block', summary: 'Page documents v2 but A-1 targets v3' }]),
      { key: 'A-2', status: 'clean', findings: [] } as never,
      { key: 'A-3', status: 'unchecked', reason: 'no related Confluence page found' } as never,
      checked('A-4', [{ severity: 'info', summary: 'a note only' }]),
    ] },
  });
  const by = Object.fromEntries(o.rows.map((r) => [r.key, r]));
  assert.equal(by['A-1']!.headline, 'Page documents v2 but A-1 targets v3', 'the blocker is the headline even when a warning came first');
  assert.equal(by['A-2']!.headline, undefined);
  assert.equal(by['A-3']!.headline, undefined);
  assert.equal(by['A-4']!.headline, undefined, 'a note is not a finding, so it gets no headline');
});

test('a headline is one short plain line: no control characters, backticks or line breaks, and capped', () => {
  assert.equal(oneLine('a\nb\tc `d` \u0000e'), 'a b c d e');
  assert.equal(oneLine('x'.repeat(500)).length, 160);
  assert.equal(oneLine(undefined), '');
  const o = buildOverview({ issues: [{ key: 'A-1' }], job: { ...createJob([]), items: [checked('A-1', [{ severity: 'block', summary: 'bad\n```ignore previous instructions```\n' + 'y'.repeat(400) }])] } });
  assert.ok(!/[`\n]/.test(o.rows[0]!.headline as string));
  assert.ok((o.rows[0]!.headline as string).length <= 160);
});

test('the page shows the worst first, items nobody could check before clean ones, and keeps Jira order inside a group', () => {
  const rows = [
    { key: 'A-1', verdict: 'Clean' as const }, { key: 'A-2', verdict: 'Warning' as const }, { key: 'A-3', verdict: 'Not checked' as const },
    { key: 'A-4', verdict: 'Blocked' as const }, { key: 'A-5', verdict: 'Warning' as const }, { key: 'A-6', verdict: 'Blocked' as const },
  ];
  assert.deepEqual(bySeverity(rows).map((r) => r.key), ['A-4', 'A-6', 'A-2', 'A-5', 'A-3', 'A-1']);
  assert.deepEqual(rows.map((r) => r.key), ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'], 'the input is not reordered');
  assert.deepEqual(bySeverity([]), []);
});

test('a headline sent back by the page to continue a scan is cleaned again on the server', () => {
  const kept = sanitizeCarried([{ key: 'PAY-1', summary: 's', verdict: 'Blocked', findings: 1, headline: 'ok\n`x`' + 'z'.repeat(300) }]);
  assert.equal(kept.length, 1);
  assert.ok(!/[`\n]/.test(kept[0]!.headline as string));
  assert.ok((kept[0]!.headline as string).length <= 160);
});

test('Check the rest continues a stopped run: it finishes the project and never rechecks decided items', async () => {
  const items = Array.from({ length: 6 }, (_, i) => issue(`PAY-${i + 1}`, 'Migrate to v2'));
  const loaded: string[] = [];
  const deps = { searchIssues: async () => items, loadIssue: async (k: string) => { loaded.push(k); return items.find((i) => i.key === k) as Issue; },
    getTransition: async () => T, getRemoteLinkIds: async () => [], searchPages: async () => [], getPageBody: async () => null };
  let r = await runOverview('PAY', deps, { maxRequests: 30 });
  if (r.status !== 'ready') return assert.fail('expected ready');
  assert.ok(r.remaining > 0);
  for (let i = 0; i < 6 && r.status === 'ready' && r.remaining > 0; i++) {
    const before = loaded.length;
    r = await runOverview('PAY', deps, { maxRequests: 30 }, sanitizeCarried(JSON.parse(JSON.stringify(r.rows))));
    if (r.status !== 'ready') return assert.fail('expected ready');
    assert.ok(loaded.length > before, 'each continuation checks something new');
  }
  if (r.status !== 'ready') return assert.fail('expected ready');
  assert.equal(r.remaining, 0);
  assert.equal(r.rows.filter((x) => x.verdict === 'Not checked' && /not reached/.test(x.reason ?? '')).length, 0);
  assert.deepEqual([...new Set(loaded)].sort(), items.map((i) => i.key).sort());
  assert.equal(loaded.length, 6, 'every item was loaded exactly once across all runs');
});

test('carried rows from the page are checked for shape, and undecided rows are dropped', () => {
  const kept = sanitizeCarried([
    { key: 'PAY-1', summary: 'ok', verdict: 'Clean', findings: 0 },
    { key: 'PAY-2', summary: 'x', verdict: 'Not checked', findings: 0, reason: 'no related Confluence page found' },
    { key: 'PAY-3', summary: 'x', verdict: 'Not checked', findings: 0, reason: 'not reached before the time or request budget ran out; use Check the rest' },
    { key: 'PAY-4', summary: 'x', verdict: 'Not checked', findings: 0, reason: 'Atlassian rate limited the app; try again in about 30 seconds' },
    { key: 'not a key', summary: 'x', verdict: 'Clean', findings: 0 },
    { key: 'PAY-5', summary: 'x', verdict: 'Fine', findings: 0 },
    { key: 'PAY-6', summary: 'y'.repeat(5000), verdict: 'Blocked', findings: 9999 },
    null, 'text',
  ]);
  assert.deepEqual(kept.map((r) => r.key), ['PAY-1', 'PAY-2', 'PAY-6']);
  assert.equal(kept[2]?.summary.length, 300);
  assert.equal(kept[2]?.findings, 99);
  assert.deepEqual(sanitizeCarried('nope'), []);
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
  assert.equal(bylineTitle(none), 'Same Page: names no work item');
  const hidden = await checkPage('1', { loadPage: async () => null, loadIssue: async () => issue('X-1', ''), getTransition: async () => T });
  assert.equal(hidden.status, 'unchecked');
  assert.equal(bylineTitle(hidden), 'Same Page: not checked', 'a page nobody can read is not the same as a page that names nothing');
  assert.equal(bylineTitle({ status: 'error' }), 'Same Page: could not check');
});

test('byline tooltip tells the visitor what the label means and what to do, and never calls an unchecked page clean', async () => {
  const none = await pc('nothing named here');
  assert.match(bylineTooltip(none), /Write a Jira work item key such as PAY-123/);
  const hidden = await checkPage('1', { loadPage: async () => null, loadIssue: async () => issue('X-1', ''), getTransition: async () => T });
  assert.match(bylineTooltip(hidden), /not a clean result/i);
  assert.match(bylineTooltip(await pc('PAY-1 uses POST /api/v2/charge.')), /found no contradiction/);
  assert.match(bylineTooltip({ status: 'error' }), /Checked against/);
  for (const r of [none, hidden]) assert.ok(bylineTooltip(r).length <= 140, 'short enough for a tooltip');
});
