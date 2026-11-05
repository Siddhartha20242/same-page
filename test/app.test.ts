import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCql, keywords, createDeps } from '../src/atlassianDeps.ts';
import { buildPanelModel } from '../src/panelModel.ts';
import { buildReviewTask } from '../src/reviewTask.ts';
import { deriveTargetVersion } from '../src/adapters.ts';
import { checkRelease } from '../src/release.ts';
import type { HttpError, HttpResponse } from '../src/atlassianDeps.ts';
import type { PanelFinding } from '../src/reviewTask.ts';

// Narrowing helper: a missing value fails the test with a clear message instead of a TypeError later.
function must<T>(v: T | undefined | null, what = 'value'): T { assert.ok(v != null, `expected ${what} to be present`); return v; }
// The panel model is a union; the demo scenario must be a findings model.
function findingsOf(m: Awaited<ReturnType<typeof buildPanelModel>>): PanelFinding[] {
  assert.ok(m.status === 'findings' || m.status === 'notes', `expected findings, got ${m.status}`);
  return m.findings;
}

// A fake Jira + Confluence returning documented response shapes (written here, NOT captured: see scripts/capture-payloads.mjs).
function fakeSite(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const routes: Record<string, unknown> = {
    '/rest/api/3/issue/PAY-1?fields=': { fields: { summary: 'Migrate Payment API to v2', status: { name: 'In Progress' }, components: [{ name: 'payments' }], fixVersions: [], labels: [] }, key: 'PAY-1' },
    '/rest/api/3/issue/PAY-1/changelog?startAt=0': { total: 2, values: [
      { created: '2026-09-01T00:00:00Z', author: { displayName: 'Dana' }, items: [{ field: 'status' }] },
      { created: '2026-10-01T00:00:00Z', author: { displayName: 'Sam' }, items: [{ field: 'status' }] }] },
    '/rest/api/3/issue/PAY-1/remotelink': [
      { object: { url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/111/Payment+Runbook' } },
      { globalId: 'appId=a&pageId=222' }],
    '/wiki/rest/api/search': { results: [{ content: { id: '111', type: 'page' }, title: 'Payment Runbook', excerpt: 'Call @@@hl@@@POST@@@endhl@@@ /api/v1/charge', lastModified: '2026-08-01T00:00:00Z' }] },
    '/wiki/api/v2/pages/111/labels': { results: [] },
    '/wiki/api/v2/pages/111': { id: '111', title: 'Payment Runbook', version: { createdAt: '2026-08-01T00:00:00Z', authorId: 'u1' }, body: { storage: { value: '<h2>Charging</h2><p>Call POST /api/v1/charge to charge.</p>' } } },
    '/wiki/api/v2/pages/222/labels': { results: [{ name: 'deprecated' }] },
    '/wiki/api/v2/pages/222': { id: '222', title: 'ADR-12 Use the legacy queue', version: { createdAt: '2026-07-01T00:00:00Z' }, body: { storage: { value: '<p>Decision: use the legacy queue.</p>' } } },
    ...over,
  };
  const respond = (path: string): HttpResponse => {
    calls.push(path);
    const hit = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => path.startsWith(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const v = routes[hit];
    if (v instanceof Error) { const e = v as HttpError; return { ok: false, status: e.status ?? 500, headers: { get: () => (e.retryAfter === undefined ? null : String(e.retryAfter)) }, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => structuredClone(v) };
  };
  return { calls, deps: createDeps({ requestJira: async (p) => respond(p), requestConfluence: async (p) => respond(p) }) };
}

test('CQL carries the issue key as a phrase and the strongest words, with no injection from odd summaries', () => {
  const cql = buildCql({ key: 'PAY-1', summary: 'Migrate "Payment" API gateway to v2' });
  assert.match(cql, /text ~ "\\"PAY-1\\""/);
  assert.match(cql, /title ~ "payment"/);
  assert.ok(!cql.includes('"Payment"'));            // quotes in the summary never reach the query
  assert.deepEqual(keywords('Migrate Payment API gateway to v2'), ['payment', 'gateway']);
});

test('the deps read issue, changelog, linked pages, search results and page bodies in the documented shapes', async () => {
  const { deps } = fakeSite();
  const issue = await deps.loadIssue('PAY-1');
  assert.deepEqual([issue.summary, issue.status, issue.components], ['Migrate Payment API to v2', 'In Progress', ['payments']]);
  assert.deepEqual(await deps.getTransition('PAY-1'), { at: '2026-10-01T00:00:00Z', by: 'Sam' });
  assert.deepEqual((await deps.getRemoteLinkIds('PAY-1')).sort(), ['111', '222']);
  const found = await deps.searchPages(issue);
  assert.equal(found[0]?.text, 'Call POST /api/v1/charge');             // highlight markers stripped
  const body = must(await deps.getPageBody('222'), 'page 222');
  assert.deepEqual(body.labels, ['deprecated']);
  assert.equal(body.text, 'Decision: use the legacy queue.');
});

test('invalid keys and ids never reach the API', async () => {
  const { deps, calls } = fakeSite();
  await assert.rejects(deps.loadIssue('PAY-1/../../admin'), /valid issue key/);
  assert.equal(await deps.getPageBody('111/../secret'), null);
  assert.equal(calls.length, 0);
});

test('a page the viewer cannot read comes back null; a 429 is raised with its Retry-After', async () => {
  const denied = Object.assign(new Error('x'), { status: 403 });
  assert.equal(await fakeSite({ '/wiki/api/v2/pages/111': denied }).deps.getPageBody('111'), null);
  const limited = Object.assign(new Error('x'), { status: 429, retryAfter: 12 });
  await assert.rejects(fakeSite({ '/wiki/api/v2/pages/111': limited }).deps.getPageBody('111'), (e: HttpError) => e.status === 429 && e.retryAfter === 12);
});

test('the changelog is read from its LAST page so the most recent status change is used', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ created: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`, items: [{ field: 'assignee' }] }));
  const { deps } = fakeSite({
    '/rest/api/3/issue/PAY-1/changelog?startAt=0': { total: 150, values: many },
    '/rest/api/3/issue/PAY-1/changelog?startAt=50': { total: 150, values: [{ created: '2026-10-20T00:00:00Z', author: { displayName: 'Lee' }, items: [{ field: 'status' }] }] },
  });
  assert.deepEqual(await deps.getTransition('PAY-1'), { at: '2026-10-20T00:00:00Z', by: 'Lee' });
});

test('panel model for the demo scenario: R1 with a verified suggestion, R2 with an honest "needs a human"', async () => {
  const { deps } = fakeSite();
  const m = await buildPanelModel('PAY-1', deps);
  assert.equal(m.status, 'findings');
  assert.equal(m.status === 'findings' && m.verdict, 'BLOCKED');
  const r1 = must(findingsOf(m).find((f) => f.ruleId === 'R1_VERSION_MISMATCH'), 'R1 finding');
  const r2 = must(findingsOf(m).find((f) => f.ruleId === 'R2_DEPRECATED_DECISION_ACTIVE_WORK'), 'R2 finding');
  assert.equal(r1.evidence.docLine, 'Call POST /api/v1/charge to charge.');
  assert.equal(r1.evidence.ticket, 'PAY-1 targets v2');
  assert.equal(r1.suggestion?.after, 'Call POST /api/v2/charge to charge.');
  assert.equal(r1.foundBecause?.[0], 'linked from the Jira issue');
  assert.ok(r2.why && r2.suggestion === null);
  assert.match(r2.evidence.ticket ?? '', /^PAY-1 is /);                       // R2 is about status, so it must not say "targets n/a"
  assert.ok(!/n\/a/.test(r2.evidence.ticket ?? ''));
  assert.ok(r1.id && r1.id !== r2.id);
});

test('panel model explains why it cannot check, instead of showing an empty panel', async () => {
  const { deps } = fakeSite({ '/rest/api/3/issue/PAY-1?fields=': { key: 'PAY-1', fields: { summary: 'Improve search', status: { name: 'To Do' }, components: [] } } });
  const m = await buildPanelModel('PAY-1', deps);
  assert.equal(m.status, 'clean');                                       // no version no longer stops the check, but the panel says what was skipped
  assert.match(m.status === 'clean' ? (m.skippedRules?.[0] ?? '') : '', /names no target version/);
});

test('a linked page that search did not return is still checked, and an unreadable one is reported', async () => {
  const { deps } = fakeSite({ '/wiki/rest/api/search': { results: [] } });          // search finds nothing, but two pages are linked
  const m = await buildPanelModel('PAY-1', deps);
  assert.equal(m.status, 'findings');
  const denied = Object.assign(new Error('x'), { status: 403 });
  const none = await buildPanelModel('PAY-1', fakeSite({ '/wiki/rest/api/search': { results: [] }, '/wiki/api/v2/pages/111': denied, '/wiki/api/v2/pages/222': denied }).deps);
  assert.equal(none.status, 'unchecked');
  assert.match(none.status === 'unchecked' ? none.reason : '', /not readable/);
});

test('the whole release check works on the same fake site', async () => {
  const { deps } = fakeSite();
  const report = await checkRelease({ issues: [await deps.loadIssue('PAY-1')], ...deps });
  assert.equal(report.verdict, 'ATTENTION');
  assert.equal(report.counts.blockers, 2);
});

test('the review task is a plain Jira task carrying the evidence, with page text only as text nodes', async () => {
  const { deps } = fakeSite();
  const m = await buildPanelModel('PAY-1', deps);
  const first = must(findingsOf(m)[0], 'first finding');
  const f: PanelFinding = { ...first, evidence: { ...first.evidence, docLine: '<script>alert(1)</script> Call /api/v1/x' } };
  const t = buildReviewTask({ issueKey: 'PAY-1', finding: f });
  assert.equal(t.fields.project.key, 'PAY');
  assert.equal(t.fields.issuetype.name, 'Task');
  assert.ok(t.fields.description.content.every((n) => n.type === 'paragraph' && n.content[0].type === 'text'));
  assert.ok(t.fields.description.content.some((n) => n.content[0].text.includes('<script>')), 'kept as inert text, not parsed');
});

test('a review task for a finding with no quoted line never prints "undefined"', () => {
  const f = { id: 'x', ruleId: 'R2_DEPRECATED_DECISION_ACTIVE_WORK', severity: 'block', summary: 's', why: 'w', pageId: '1', pageTitle: 'ADR', evidence: { ticket: 'PAY-1 is In Progress' }, suggestion: null } as unknown as PanelFinding;
  const body = JSON.stringify(buildReviewTask({ issueKey: 'PAY-1', finding: f }));
  assert.ok(!body.includes('undefined'));
  assert.ok(!body.includes('Doc says'));
});

test('the panel marks exactly the stale token, in the doc line and on both sides of the proposed edit', async () => {
  const { deps } = fakeSite();
  const r1 = must(findingsOf(await buildPanelModel('PAY-1', deps)).find((f) => f.ruleId === 'R1_VERSION_MISMATCH'), 'R1 finding');
  const doc = must(r1.evidence.docHighlight, 'doc highlight');
  assert.equal(r1.evidence.docLine!.slice(doc.start, doc.end), 'v1');
  const before = must(r1.suggestion?.beforeHighlight, 'before highlight');
  assert.equal(r1.suggestion!.before!.slice(before.start, before.end), 'v1');
  const after = must(r1.suggestion?.afterHighlight, 'after highlight');
  assert.equal(r1.suggestion!.after!.slice(after.start, after.end), 'v2');
});

test('a target version set from the panel (an issue property) is read as the dedicated field and wins over the summary', async () => {
  const reply = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body }) as never;
  const deps = createDeps({
    requestJira: reply({ key: 'PAY-9', fields: { summary: 'Payments work, see v1 notes', status: { name: 'To Do' } }, properties: { 'same-page.targetVersion': { version: 'v3' } } }),
    requestConfluence: reply({}),
  });
  const issue = await deps.loadIssue('PAY-9');
  assert.equal(issue.apiVersionField, 'v3');
  assert.equal(deriveTargetVersion(issue), 'v3');
  const none = createDeps({ requestJira: reply({ key: 'PAY-9', fields: { summary: 'Migrate to v2', status: { name: 'To Do' } } }), requestConfluence: reply({}) });
  assert.equal((await none.loadIssue('PAY-9')).apiVersionField, undefined);
  assert.equal(deriveTargetVersion(await none.loadIssue('PAY-9')), 'v2');
});
