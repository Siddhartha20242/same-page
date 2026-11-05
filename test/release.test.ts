import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTargetVersion } from '../src/adapters.ts';
import { checkRelease, renderReportHtml, releaseRecord, anchorLine, verifyAnchor } from '../src/release.ts';
import { check } from '../src/engine.ts';
import { appendFinding } from '../src/ledger.ts';
import type { Issue, Page, VersionSource, WorkItem } from '../src/types.ts';
import type { LedgerEntry } from '../src/ledger.ts';
import type { Report } from '../src/release.ts';

// ---- target version: trustworthy sources first, no guessing ----
const ALL: { sources: VersionSource[] } = { sources: ['field', 'fixVersion', 'summary'] };
test('deriveTargetVersion prefers the field, then (if enabled) Fix Version, then the summary', () => {
  assert.equal(deriveTargetVersion({ apiVersionField: 'v3', fixVersions: ['v2'], summary: 'to v1' }, ALL), 'v3');
  assert.equal(deriveTargetVersion({ fixVersions: ['payments-api v2'], summary: 'to v1' }, ALL), 'v2');
  assert.equal(deriveTargetVersion({ fixVersions: ['2.3.1'] }, ALL), 'v2');
  assert.equal(deriveTargetVersion({ summary: 'Migrate Payment API to v2' }), 'v2');
});

test('deriveTargetVersion refuses ambiguous or unrecognised names instead of guessing', () => {
  assert.equal(deriveTargetVersion({ fixVersions: ['2026.10'] }, ALL), undefined);       // calendar version
  assert.equal(deriveTargetVersion({ fixVersions: ['release-47'] }, ALL), undefined);
  assert.equal(deriveTargetVersion({ fixVersions: ['Release 4'] }, ALL), undefined);
  assert.equal(deriveTargetVersion({ fixVersions: ['v1', 'v2'] }, ALL), undefined);      // conflicting Fix Versions
  assert.equal(deriveTargetVersion({ summary: 'Improve search' }), undefined);
});

// ---- release report: states what it could not check ----
const iso = '2026-10-01T00:00:00Z';
const old = '2026-08-01T00:00:00Z';
// Partial issues on purpose: the release flow must cope with fields a real site leaves out.
const issue = (key: string, summary: string, o: Partial<Issue> = {}): Issue => ({ key, summary, status: 'In Progress', requiredFields: [], fields: {}, ...o }) as unknown as Issue;
const pages: Record<string, Page[]> = {
  'A-1': [{ id: 'p1', title: 'Payment runbook', text: 'Owner: A-1\nCall /api/v1/charge', modifiedAt: old, labels: [] }],
  'B-1': [{ id: 'p2', title: 'Search runbook', text: 'Owner: B-1\nUses v3 search', modifiedAt: old, labels: [] }],
  'D-1': [{ id: 'p4', title: 'Report runbook', text: 'Owner: D-1\nv2', modifiedAt: old, labels: [] }],
};

const run = () => checkRelease({
  issues: [issue('A-1', 'Move payments to v2'), issue('B-1', 'Move search to v3'), issue('C-1', 'Improve search'), issue('D-1', 'Move reports to v2'), issue('E-1', 'Move export to v2')],
  getTransition: async (k) => (k === 'D-1' ? null : { at: iso, by: 'Dana' }),
  getRemoteLinkIds: async () => [],
  searchPages: async (i) => pages[i.key] || [],
});

test('release report separates findings, clean, and unchecked, and never calls unchecked work fine', async () => {
  const r = await run();
  const byKey = Object.fromEntries(r.items.map((i) => [i.key, i]));
  assert.equal(byKey['A-1']!.status, 'findings');
  assert.equal(byKey['B-1']!.status, 'clean');
  assert.match(byKey['C-1']!.reason as string, /no related Confluence page/);
  assert.equal(byKey['D-1']!.status, 'clean');                                   // no status change recorded: checked, with the skipped rules named
  assert.match(byKey['D-1']!.skippedRules?.[0] ?? '', /no status change recorded/);
  assert.match(byKey['E-1']!.reason as string, /no related Confluence page/);
  assert.equal(r.verdict, 'ATTENTION');
  assert.deepEqual(r.coverage, { checked: 3, total: 5 });
  assert.equal(r.complete, false);
});

test('rendered report escapes hostile page titles and flags incomplete coverage', async () => {
  const r = await run();
  r.items[0]!.findings![0]!.pageTitle = '<script>alert(1)</script>';
  const html = renderReportHtml(r, { version: '2.0' });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /3 of 5 issues checked/);
  assert.match(html, /UNCHECKED/);
});

// ---- anchored release record ----
const workItem: WorkItem = { key: 'A-1', status: 'In Progress', apiVersion: 'v2', statusChangedAt: iso, requiredFields: [], fields: {} };
const chainOf = (n: number, tag = '') => {
  let c: LedgerEntry[] = [];
  for (let i = 0; i < n; i++) {
    const page: Page = { id: 'p', title: 't', text: `Use v1 client ${tag}${i}.`, modifiedAt: old, labels: [] };
    c = appendFinding(c, check({ workItem, page }).findings[0], () => `2026-10-0${i + 1}T00:00:00Z`);
  }
  return c;
};

test('anchor survives honest appends but catches a whole-chain rewrite', async () => {
  const report = await run();
  const chain = chainOf(3);
  const record = releaseRecord({ version: '2.0', report, chain });
  assert.match(anchorLine(record), /ledger 3 entries @ [0-9a-f]{64}/);

  assert.deepEqual(verifyAnchor(chainOf(5), record), { ok: true });                       // history only grew
  const rewritten = verifyAnchor(chainOf(3, 'forged-'), record);                           // internally consistent forgery
  assert.equal(rewritten.ok, false);
  assert.match((rewritten as { reason: string }).reason, /rewritten/);
  assert.match((verifyAnchor(chainOf(2), record) as { reason: string }).reason, /shortened/);
});

test('refuses to record a ledger that does not verify', async () => {
  const chain = chainOf(2);
  chain[0]!.evidence!.page!.snippet = 'edited';
  assert.throws(() => releaseRecord({ version: '2.0', report: await_report(), chain }), /does not verify/);
});
function await_report(): Report { return { verdict: 'X', coverage: { checked: 0, total: 0 }, counts: { findings: 0 } } as unknown as Report; }   // minimal report fixture

test('a work item with no target version is still checked: the fact rules run and the skipped rule is named', async () => {
  const r = await checkRelease({
    issues: [issue('F-1', 'Token expiry', { description: 'Access token expiry should be 1 hour' })],
    getTransition: async () => ({ at: iso, by: 'Dana' }),
    getRemoteLinkIds: async () => [],
    searchPages: async () => [{ id: 'pf', title: 'Token expiry runbook', text: 'Access tokens expire after 30 minutes.', modifiedAt: old, labels: [] }],
  });
  const item = r.items[0]!;
  assert.equal(item.status, 'findings');
  assert.equal(item.findings?.[0]?.ruleId, 'R8_DURATION_DIFFERS');
  assert.match(item.skippedRules?.[0] ?? '', /names no target version/);
});
