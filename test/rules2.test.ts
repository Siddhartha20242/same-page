import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOpenApi, judgeOperation, operationsInLine, pathMatches } from '../src/spec.ts';
import { specDisagrees, statusClaim, BUILT_IN_RULES } from '../src/rules.ts';
import { storageToText } from '../src/adapters.ts';
import { check } from '../src/engine.ts';

const SPEC_JSON = JSON.stringify({
  openapi: '3.0.3', info: { title: 'Payments API' }, servers: [{ url: 'https://api.test/api/v2' }],
  paths: { '/charge': { post: { summary: 'Charge' } }, '/charge/{id}': { get: {}, delete: { deprecated: true } }, '/refund': { post: {} } },
}, null, 2);
const SPEC_PAGE_HTML = `<p>Our API contract.</p><ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${SPEC_JSON}]]></ac:plain-text-body></ac:structured-macro><p>Updated weekly.</p>`;
const specPage = { id: 's', title: 'Payments OpenAPI', text: storageToText(SPEC_PAGE_HTML), modifiedAt: '2026-10-01T00:00:00Z', labels: [] };
const docPage = (text: string) => ({ id: 'd', title: 'Runbook', text, modifiedAt: '2026-10-01T00:00:00Z', labels: [] });
const WORK = { key: 'PAY-1', apiVersion: 'v2', status: 'In Progress', statusChangedAt: '2026-11-02T00:00:00Z', statusChangedBy: 'Dana' } as never;

test('an OpenAPI document inside a code macro is found among surrounding prose, and nothing else is mistaken for one', () => {
  const spec = extractOpenApi(specPage.text)!;
  assert.equal(spec.title, 'Payments API');
  assert.deepEqual(spec.basePaths, ['/api/v2']);
  assert.deepEqual(spec.operations.map((o) => `${o.method} ${o.path}${o.deprecated ? ' (deprecated)' : ''}`).sort(),
    ['DELETE /charge/{id} (deprecated)', 'GET /charge/{id}', 'POST /charge', 'POST /refund']);
  assert.equal(extractOpenApi('just a runbook, {"not": "a spec"}'), null);
  assert.equal(extractOpenApi('{"openapi": "3.0.0", "broken": '), null);                // malformed: never throws
  assert.equal(extractOpenApi(''), null);
});

test('documented operations are read from a line, without hosts, queries or trailing punctuation', () => {
  assert.deepEqual(operationsInLine('Call POST https://api.test/api/v2/charge?x=1, then GET /api/v2/charge/42.').map((o) => [o.method, o.path]),
    [['POST', '/api/v2/charge'], ['GET', '/api/v2/charge/42']]);
  assert.equal(pathMatches('/charge/42', '/charge/{id}'), true);
  assert.equal(pathMatches('/charge/:id', '/charge/{id}'), true);
  assert.equal(pathMatches('/charge/42/extra', '/charge/{id}'), false);
});

test('judging: live operations pass, deprecated ones are named, unknown ones in the same API are missing, other services are left alone', () => {
  const spec = extractOpenApi(specPage.text)!;
  assert.equal(judgeOperation(spec, { method: 'POST', path: '/api/v2/charge' }), null);
  assert.equal(judgeOperation(spec, { method: 'GET', path: '/api/v2/charge/9' }), null);
  assert.equal(judgeOperation(spec, { method: 'DELETE', path: '/api/v2/charge/9' })?.kind, 'deprecated');
  const missing = judgeOperation(spec, { method: 'POST', path: '/api/v1/charge' });
  assert.equal(missing?.kind, 'missing');
  assert.equal(judgeOperation(spec, { method: 'GET', path: '/health' }), null);            // not this API's family
  assert.equal(judgeOperation(spec, { method: 'POST', path: '/other-service/things' }), null);
});

test('R6 blocks on a deprecated operation, quotes the exact text, and never judges the spec page itself', () => {
  const doc = docPage('Intro\nTo remove a charge call DELETE /api/v2/charge/42 and confirm.');
  const found = specDisagrees.run({ workItem: WORK, page: doc, siblings: [doc, specPage] });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'block');
  assert.match(found[0]!.summary, /DELETE \/api\/v2\/charge\/42.*deprecated/);
  assert.equal(found[0]!.evidence.spec?.opText, 'DELETE /api/v2/charge/42');
  assert.equal(found[0]!.evidence.page?.line, 2);
  assert.deepEqual(specDisagrees.run({ workItem: WORK, page: specPage, siblings: [doc, specPage] }), []);
  assert.deepEqual(specDisagrees.run({ workItem: WORK, page: doc, siblings: [doc] }), []);            // no spec among the pages: nothing to compare with
});

test('R6 warns on an unknown operation, but leaves a stale-version line to R1 so one line is not reported twice', () => {
  const unknown = docPage('Use POST /api/v2/chargeback to dispute.');
  const w = specDisagrees.run({ workItem: WORK, page: unknown, siblings: [unknown, specPage] });
  assert.equal(w[0]?.severity, 'warn');
  assert.match(w[0]!.summary, /not|no POST/);
  const stale = docPage('Call POST /api/v1/charge with the order id.');
  assert.deepEqual(specDisagrees.run({ workItem: WORK, page: stale, siblings: [stale, specPage] }), []);
  const both = check({ workItem: WORK, page: stale, siblings: [stale, specPage] }, BUILT_IN_RULES).findings;
  assert.deepEqual(both.map((f) => f.ruleId), ['R1_VERSION_MISMATCH']);
});

test('R4 flags a page that says a work item is planned or shipped when Jira says otherwise, and only when the page predates the move', () => {
  const r = (text: string, over = {}, mod = '2026-10-01T00:00:00Z') => statusClaim.run({ workItem: { ...(WORK as object), ...over } as never, page: { ...docPage(text), modifiedAt: mod } });
  assert.equal(r('PAY-1 is planned for Q3.').length, 1);
  assert.match(r('PAY-1 is planned for Q3.')[0]!.summary, /not started.*In Progress/);
  assert.match(r('We shipped PAY-1 last week.')[0]!.summary, /finished/);
  assert.equal(r('PAY-1 was planned for Q3 but slipped.').length, 0);          // past tense describes history
  assert.equal(r('PAY-12 is planned for Q3.').length, 0);                      // a different work item
  assert.equal(r('PAY-1 is planned for Q3.', { status: 'To Do' }).length, 0);  // the claim is still true
  assert.equal(r('PAY-1 is completed.', { status: 'Done' }).length, 0);
  assert.equal(r('PAY-1 is planned for Q3.', {}, '2026-11-03T00:00:00Z').length, 0);   // edited after the move: not stale
  assert.equal(r('Unrelated text about planned work.').length, 0);
});
