import test from 'node:test';
import assert from 'node:assert/strict';
import { pagesDisagree, BUILT_IN_RULES } from '../src/rules.ts';
import { check } from '../src/engine.ts';
import { buildPanelModel } from '../src/panelModel.ts';
import { buildReviewTask } from '../src/reviewTask.ts';
import { fingerprint } from '../src/triage.ts';

const WORK = { key: 'PAY-1', apiVersion: 'v3', status: 'In Progress', statusChangedAt: '2026-11-02T00:00:00Z' } as never;
const NO_TARGET = { key: 'PAY-1', status: 'In Progress', statusChangedAt: '2026-11-02T00:00:00Z' } as never;
const pg = (id: string, title: string, text: string) => ({ id, title, text, modifiedAt: '2026-10-01T00:00:00Z', labels: [] as string[] });
const A = pg('a', 'Runbook', 'Charge a card with POST /api/v1/charge and a JSON body.');
const B = pg('b', 'Integration guide', 'Charge a card with POST /api/v2/charge and a JSON body.');
const run = (workItem: unknown, page: ReturnType<typeof pg>, siblings: ReturnType<typeof pg>[]) => pagesDisagree.run({ workItem: workItem as never, page, siblings });

test('R7 fires once, with both lines, when two pages disagree and the ticket target matches neither', () => {
  const out = run(WORK, A, [A, B]);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'warn');
  assert.equal(out[0].evidence.page?.snippet, A.text);
  assert.deepEqual(out[0].evidence.other, { pageId: 'b', pageTitle: 'Integration guide', line: 1, snippet: B.text });
  assert.equal(run(WORK, B, [A, B]).length, 0);                       // the pair is reported once, by the lower page id
});

test('R7 fires when the work item has no target version, and for named APIs', () => {
  assert.equal(run(NO_TARGET, A, [A, B]).length, 1);
  const x = pg('a', 'Overview', 'We expose the Payments API v1 to partners.');
  const y = pg('b', 'Partner page', 'Partners call Payments API v2 today.');
  const out = run(NO_TARGET, x, [x, y]);
  assert.equal(out.length, 1);
  assert.match(out[0].summary, /Payments API/);
});

test('R7 stays silent when R1 can judge, or when it is unsure', () => {
  assert.equal(run({ ...(WORK as object), apiVersion: 'v2' }, A, [A, B]).length, 0);       // target matches one page: R1 reports the other
  assert.equal(run(NO_TARGET, A, [A, A]).length, 0);                                       // same version
  assert.equal(run(NO_TARGET, A, [A]).length, 0);                                          // no sibling
  assert.equal(run(NO_TARGET, A, []).length, 0);
  assert.equal(pagesDisagree.run({ workItem: NO_TARGET, page: A }).length, 0);              // no siblings given
  const legacy = pg('b', 'Old', 'Legacy: POST /api/v2/charge was the old way.');
  assert.equal(run(NO_TARGET, A, [A, legacy]).length, 0);                                  // historical wording is ignored
  const both = pg('a', 'Migration', 'POST /api/v1/charge\nPOST /api/v2/charge');
  assert.equal(run(NO_TARGET, both, [both, B]).length, 0);                                 // a page naming two versions is ambiguous
  const other = pg('b', 'Other', 'POST /api/v2/refund');
  assert.equal(run(NO_TARGET, A, [A, other]).length, 0);                                   // different resource
  const get = pg('b', 'Other', 'GET /api/v2/charge');
  assert.equal(run(NO_TARGET, A, [A, get]).length, 0);                                     // different method
});

test('R7 is a warning in the built-in set, so it can never block, and the verdict is WARN', () => {
  assert.ok(BUILT_IN_RULES.includes(pagesDisagree));
  assert.notEqual(pagesDisagree.severity, 'block');
  const r = check({ workItem: WORK, page: pg('a', 'Runbook', A.text), siblings: [A, B] }, [pagesDisagree]);
  assert.equal(r.verdict, 'WARN');
});

test('R7 reaches the panel as "Other page says" with plain wording, and the review task names the other page', async () => {
  const bodies: Record<string, string> = { a: A.text, b: B.text };
  const issue = { key: 'PAY-1', summary: 'Ship Payments v3', status: 'In Progress', components: [], fixVersions: [], labels: [], requiredFields: [], fields: {} };
  const model = await buildPanelModel('PAY-1', {
    loadIssue: async () => issue, getTransition: async () => ({ at: '2026-11-02T00:00:00Z', by: 'Dana' }), getRemoteLinkIds: async () => ['a', 'b'],
    searchPages: async () => [{ id: 'a', title: 'Runbook', text: '', labels: [] }, { id: 'b', title: 'Integration guide', text: '', labels: [] }],
    getPageBody: async (id: string | number) => ({ text: bodies[String(id)] as string, modifiedAt: '2026-10-01T00:00:00Z', labels: [], title: String(id) === 'a' ? 'Runbook' : 'Integration guide' }),
  } as never);
  assert.equal(model.status, 'findings');
  if (model.status !== 'findings') return;
  const f = model.findings.find((x) => x.ruleId === 'R7_PAGES_DISAGREE')!;
  assert.ok(f);
  assert.equal(f.evidence.sourceLabel, 'Other page says');
  assert.equal(f.evidence.ticket, `"Integration guide" says: ${B.text}`);
  assert.match(buildReviewTask({ issueKey: 'PAY-1', finding: f }).fields.description.content.map((c) => c.content[0].text).join('\n'), /Other page: "Integration guide" says/);
});

test('a changed line on the other page makes R7 a new finding for triage', () => {
  const f1 = run(WORK, A, [A, B])[0]; const f2 = run(WORK, A, [A, pg('b', 'Integration guide', 'Charge with POST /api/v4/charge')])[0];
  assert.notEqual(fingerprint({ ...f1, pageId: 'a' }), fingerprint({ ...f2, pageId: 'a' }));
});

test('R7 stays fast on large pages and on pathological lines', () => {
  const big = (v: string, id: string) => pg(id, `Big ${id}`, Array.from({ length: 50000 }, (_, i) => `Call POST /api/${v}/res${i} now`).join('\n'));
  const x = big('v1', 'a'); const y = big('v2', 'b');
  const t = performance.now();
  const out = run(WORK, x, [x, y]);
  const ms = performance.now() - t;
  assert.equal(out.length, 5);                                          // capped
  assert.ok(ms < 1500, `R7 took ${ms.toFixed(0)} ms`);
  const nasty = pg('a', 'n', 'POST /' + 'v1/'.repeat(200000) + '\n' + 'Payments API v1 '.repeat(100000));
  const t2 = performance.now();
  run(WORK, nasty, [nasty, y]);
  assert.ok(performance.now() - t2 < 1500);
});
