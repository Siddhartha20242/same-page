import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/engine.ts';
import { refsInLine } from '../src/rules.ts';
import { proposeFix } from '../src/propose.ts';
import { applyProposal } from '../src/apply.ts';
import { storageToText } from '../src/adapters.ts';
import { checkRelease, renderReportHtml } from '../src/release.ts';
import { pageIdFromUrl, confluencePageIdsFromRemoteLinks } from '../src/links.ts';
import { pairs, knownMisses } from '../fixtures/pairs.ts';
import type { AdfNode } from '../src/bind.ts';
import type { Finding, Issue, Page, WorkItem } from '../src/types.ts';

// Narrowing helper: a missing value fails the test with a clear message instead of a TypeError later.
function must<T>(v: T | undefined | null, what = 'value'): T { assert.ok(v != null, `expected ${what} to be present`); return v; }

const workItem = (o: Partial<WorkItem> = {}): WorkItem => ({ key: 'PAY-1', status: 'In Progress', apiVersion: 'v2', statusChangedAt: '2026-10-01T00:00:00Z', requiredFields: [], fields: {}, ...o });
const page = (text: string): Page => ({ id: 'p1', title: 'Runbook', text, modifiedAt: '2026-08-01T00:00:00Z', labels: [] });
const r1 = (text: string): Finding => must(check({ workItem: workItem(), page: page(text) }).findings.find((f) => f.ruleId === 'R1_VERSION_MISMATCH'), 'an R1 finding');

// ---- weakness 2: prose version references, only where the line is about an API or service ----
test('"API version 1" is read as a version reference; unrelated prose is not', () => {
  assert.deepEqual(refsInLine('The API version 1 endpoint is used.').map((r) => r.version), ['v1']);
  assert.deepEqual(refsInLine('Version 1 of the contract was signed in May.'), []);   // no API/service context
});

test('a prose version mismatch is found and fixed mechanically end to end', async () => {
  const html = '<p>The API version 1 charge endpoint takes an order id.</p>';
  const p = page(storageToText(html));
  const finding = r1(p.text);
  assert.equal(finding.severity, 'block');
  const proposal = await proposeFix({ finding, page: p, workItem: workItem() });
  assert.equal(proposal.ok, true);
  assert.ok(proposal.ok);
  assert.equal(proposal.after, 'The API version 2 charge endpoint takes an order id.');
  const applied = applyProposal({ html, proposal, target: 'v2' });
  assert.ok(applied.ok);
  assert.equal(applied.html, '<p>The API version 2 charge endpoint takes an order id.</p>');
});

test('a prose reference with a minor part is ambiguous: no invented version', async () => {
  const p = page('The service version 1.4 handles charges.');
  const out = await proposeFix({ finding: r1(p.text), page: p, workItem: workItem() });
  assert.equal(out.ok, false);
  assert.ok(!out.ok);
  assert.match(out.reason, /ambiguous/);
});

// ---- weakness 4: historical wording becomes a note, not a silent miss ----
test('stale references near rollback/legacy wording become notes, not silence and not blockers', () => {
  const f = r1('Rollback: redeploy v1 image.');
  assert.equal(f.severity, 'info');
  assert.match(f.summary, /may be intentional/);
  assert.equal(check({ workItem: workItem(), page: page('Rollback: redeploy v1 image.') }).verdict, 'PASS');
});

test('one live reference alongside a historical one is still a blocker', () => {
  const f = r1('Legacy v1 was retired.\nTo deploy, call POST /api/v1/charge.');
  assert.equal(f.severity, 'block');
  assert.equal(f.evidence.page?.line, 2);
});

test('every previously documented known miss is now surfaced as a note', () => {
  for (const k of knownMisses) {
    const f = check({ workItem: k.workItem, page: k.page }).findings[0];
    assert.equal(f?.severity, 'info', `${k.id} should surface as a note`);
  }
});

test('the historical clean fixtures still pass cleanly but now carry a note', () => {
  for (const id of ['n11', 'n12']) {
    const p = must(pairs.find((x) => x.id === id), `fixture ${id}`);
    const res = check(p);
    assert.equal(res.verdict, 'PASS');
    assert.equal(must(res.findings[0]).severity, 'info');
  }
});

test('no fix is proposed for a note', async () => {
  const p = page('Rollback: redeploy v1 image.');
  const out = await proposeFix({ finding: r1(p.text), page: p, workItem: workItem() });
  assert.equal(out.ok, false);
  assert.ok(!out.ok);
  assert.match(out.reason, /probably intentional/);
});

test('release report lists notes separately and does not let them raise the verdict', async () => {
  const issue: Issue = { key: 'PAY-1', summary: 'Move to v2', status: 'In Progress', components: [], fixVersions: [], labels: [], requiredFields: [], fields: {} };
  const report = await checkRelease({
    issues: [issue],
    getTransition: async () => ({ at: '2026-10-01T00:00:00Z', by: 'Dana' }),
    getRemoteLinkIds: async () => ['p1'],
    searchPages: async () => [page('Rollback: redeploy v1 image.')],
  });
  assert.equal(report.verdict, 'NO CONTRADICTIONS FOUND');
  assert.equal(report.counts.notes, 1);
  assert.equal(report.counts.findings, 0);
  const html = renderReportHtml(report, { version: '2.0' });
  assert.match(html, /NOTE/);
  assert.match(html, /1 note\(s\)/);
});

// ---- weakness 5: finding the page without guessing ----
test('pageIdFromUrl handles the common Confluence URL shapes and admits what it cannot resolve', () => {
  assert.equal(pageIdFromUrl('https://acme.atlassian.net/wiki/spaces/ENG/pages/426141234/Payment+Runbook'), '426141234');
  assert.equal(pageIdFromUrl('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=987'), '987');
  assert.equal(pageIdFromUrl('https://acme.atlassian.net/wiki/x/AbC123'), null);      // short link: cannot resolve offline
  assert.equal(pageIdFromUrl('not a url at all'), null);
});

test('remote links yield Confluence page ids from either the url or the globalId', () => {
  const links = [
    { object: { url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/111/Runbook', title: 'Runbook' } },
    { globalId: 'appId=abc&pageId=222' },
    { object: { url: 'https://example.com/other' } },
    { object: {} },
  ];
  assert.deepEqual(confluencePageIdsFromRemoteLinks(links).sort(), ['111', '222']);
  assert.deepEqual(confluencePageIdsFromRemoteLinks(undefined), []);
  assert.deepEqual(confluencePageIdsFromRemoteLinks('oops'), []);
});

test('a heading-like line above gives historical context to the lines under it, but a sentence with its own version does not', () => {
  assert.equal(r1('Rollback procedure\nRedeploy the v1 image.').severity, 'info');
  assert.equal(r1('Legacy v1 was retired.\nCall POST /api/v1/charge.').severity, 'block');
});

// ---- lessons from the public-data probe (Apache Kafka wiki and Jira) ----
import { deriveTargetVersion } from '../src/adapters.ts';
import { bindInAdf } from '../src/bind.ts';

test('a version-looking token inside a filename is not a version reference', () => {
  assert.deepEqual(refsInLine('The current implementation (in KAFKA-1000-v1.patch) implements #1.'), []);
  assert.deepEqual(refsInLine('Download release-v2.zip first.'), []);
  assert.deepEqual(refsInLine('Call POST /api/v1/charge.').map((r) => r.version), ['v1']);
});

test('the probe false positive is gone: 0.8.2.0 is not API v0, and the patch name is not v1', () => {
  assert.equal(deriveTargetVersion({ fixVersions: ['0.8.2.0'] }, { sources: ['fixVersion'] }), undefined);
  assert.equal(deriveTargetVersion({ summary: 'Backport to v0.9' }), undefined);
  const w: WorkItem = { key: 'KAFKA-1000', status: 'Done', apiVersion: undefined, statusChangedAt: '2026-01-01T00:00:00Z', requiredFields: [], fields: {} };
  assert.equal(check({ workItem: w, page: page('The current implementation (in KAFKA-1000-v1.patch) implements #1.') }).findings.length, 0);
});

test('Fix Version is opt-in as a version source, because it usually names a product release', () => {
  assert.equal(deriveTargetVersion({ fixVersions: ['3.7.0'], summary: 'Improve search' }), undefined);
  assert.equal(deriveTargetVersion({ fixVersions: ['3.7.0'], summary: 'Improve search' }, { sources: ['fixVersion'] }), 'v3');
});

// ---- bind forever: pure ADF transform (extension node shape is supplied, never assumed) ----
const adf = (...paras: AdfNode[][]): AdfNode => ({ type: 'doc', version: 1, content: paras.map((c) => ({ type: 'paragraph', content: c })) });
const macro: AdfNode = { type: 'extension', attrs: { extensionKey: 'PLACEHOLDER', parameters: { field: 'apiVersion' } } };

test('bindInAdf swaps the stale token for the macro node and leaves the rest untouched', () => {
  const doc = adf([{ type: 'text', text: 'Call POST /api/v1/charge now.' }], [{ type: 'text', text: 'Escalate on 5xx.' }]);
  const out = bindInAdf(doc, { line: 'Call POST /api/v1/charge now.', token: 'v1', node: macro });
  assert.equal(out.ok, true);
  assert.ok(out.ok);
  const content = must(out.doc.content, 'doc content');
  assert.deepEqual(content[0]?.content, [
    { type: 'text', text: 'Call POST /api/' }, macro, { type: 'text', text: '/charge now.' },
  ]);
  assert.deepEqual(content[1], must(doc.content)[1]);
  assert.equal(must(must(doc.content)[0]?.content).length, 1, 'input is not mutated');
});

test('bindInAdf keeps text marks on both halves', () => {
  const marks = [{ type: 'strong' }];
  const doc = adf([{ type: 'text', text: 'Use API v1 here', marks }]);
  const out = bindInAdf(doc, { line: 'Use API v1 here', token: 'v1', node: macro });
  assert.ok(out.ok);
  const para = must(must(out.doc.content)[0]?.content, 'paragraph content');
  assert.deepEqual(para.map((n) => n.marks && n.type), ['text', undefined, 'text'].map((t, i) => (i === 1 ? undefined : t)));
  assert.deepEqual(para[0]?.marks, marks);
  assert.deepEqual(para[2]?.marks, marks);
});

test('bindInAdf refuses when it cannot be sure', () => {
  const split = adf([{ type: 'text', text: 'Call ' }, { type: 'text', text: '/api/v1', marks: [{ type: 'code' }] }, { type: 'text', text: '/charge' }]);
  const reasonOf = (r: ReturnType<typeof bindInAdf>): string => (r.ok ? '' : r.reason);
  assert.match(reasonOf(bindInAdf(split, { line: 'Call /api/v1/charge', token: 'v1', node: macro })), /single text run/);
  const twice = adf([{ type: 'text', text: 'Use v1.' }], [{ type: 'text', text: 'Use v1.' }]);
  assert.match(reasonOf(bindInAdf(twice, { line: 'Use v1.', token: 'v1', node: macro })), /more than one place/);
  const tokTwice = adf([{ type: 'text', text: 'v1 and v1 again' }]);
  assert.match(reasonOf(bindInAdf(tokTwice, { line: 'v1 and v1 again', token: 'v1', node: macro })), /exactly once/);
});
