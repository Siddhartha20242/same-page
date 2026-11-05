import test from 'node:test';
import assert from 'node:assert/strict';
import { storageToText } from '../src/adapters.ts';
import { applyProposal } from '../src/apply.ts';
import { versionMismatch } from '../src/rules.ts';
import { verifyFix } from '../src/propose.ts';

// Real Confluence pages are not one clean <p>: tables, code macros, formatted runs, lists, entities, repeated lines.
// These pin down what is detected, what Apply can change, and that it still refuses to guess.

const lineOf = (html: string, text: string) => storageToText(html).split('\n').findIndex((l) => l === text) + 1;
const apply = (html: string, before: string, after: string, target = 'v2') =>
  applyProposal({ html, target, proposal: { ok: true, before, after, line: lineOf(html, before) } });

const WORK = { key: 'PAY-1', apiVersion: 'v2', status: 'In Progress', statusChangedAt: '2026-11-02T00:00:00Z' } as never;
const page = (html: string) => ({ id: '1', title: 'Runbook', text: storageToText(html), modifiedAt: '2026-10-01T00:00:00Z', labels: [] }) as never;

test('table cells are kept apart, so the quoted line is the real cell text', () => {
  const html = '<table><tbody><tr><th>Step</th><th>Call</th></tr><tr><td>1</td><td>POST /api/v1/charge</td></tr></tbody></table>';
  assert.equal(storageToText(html), 'Step | Call\n1 | POST /api/v1/charge');
});

test('code macros are documentation too: a stale curl line inside one is detected', () => {
  const html = '<p>Run:</p><ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[curl -X POST https://api.test/v1/charge -d id=1]]></ac:plain-text-body></ac:structured-macro>';
  assert.match(storageToText(html), /curl -X POST https:\/\/api\.test\/v1\/charge/);
  const found = versionMismatch.run({ workItem: WORK, page: page(html) });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.evidence.page?.snippet, 'curl -X POST https://api.test/v1/charge -d id=1');
});

test('a URL may change by its version only; a different or new URL is still refused', () => {
  const a = 'curl https://api.test/v1/charge';
  assert.equal(verifyFix(a, 'curl https://api.test/v2/charge', 1, 'v2').ok, true);
  assert.equal(verifyFix(a, 'curl https://evil.test/v2/charge', 1, 'v2').ok, false);
  assert.equal(verifyFix(a, 'curl https://api.test/v2/charge https://evil.test/x', 1, 'v2').ok, false);
});

test('Apply fixes a line inside a code macro and leaves the macro intact', () => {
  const html = '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[curl -X POST https://api.test/v1/charge -d id=1]]></ac:plain-text-body></ac:structured-macro>';
  const out = apply(html, 'curl -X POST https://api.test/v1/charge -d id=1', 'curl -X POST https://api.test/v2/charge -d id=1');
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.html, html.replace('/v1/', '/v2/'));
});

test('Apply fixes a table cell, touching only that cell', () => {
  const html = '<table><tbody><tr><td>1</td><td>POST /api/v1/charge</td></tr></tbody></table>';
  const out = apply(html, '1 | POST /api/v1/charge', '1 | POST /api/v2/charge');
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.html, '<table><tbody><tr><td>1</td><td>POST /api/v2/charge</td></tr></tbody></table>');
});

test('Apply fixes a line split by inline formatting (the whole line is not contiguous in the source)', () => {
  const html = '<p>Call <strong>POST</strong> <code>/api/v1/charge</code> now</p><p>Other 1 thing</p>';
  const out = apply(html, 'Call POST /api/v1/charge now', 'Call POST /api/v2/charge now');
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.html, '<p>Call <strong>POST</strong> <code>/api/v2/charge</code> now</p><p>Other 1 thing</p>');   // the other "1" is untouched
});

test('Apply still refuses to guess: a repeated line, or a token that could be in two places', () => {
  const dup = '<p>Call POST /api/v1/charge</p><p>Call POST /api/v1/charge</p>';
  assert.equal(apply(dup, 'Call POST /api/v1/charge', 'Call POST /api/v2/charge').ok, false);
  const split = '<p>See <b>/api/v1/charge</b> and <i>/api/v1/charge</i> for details</p>';
  const out = apply(split, 'See /api/v1/charge and /api/v1/charge for details', 'See /api/v2/charge and /api/v1/charge for details');
  assert.equal(out.ok, false);
});

test('entities in the source do not break a match', () => {
  const html = '<p>Use &lt;host&gt;/api/v1/charge &amp; retry</p>';
  const out = apply(html, 'Use <host>/api/v1/charge & retry', 'Use <host>/api/v2/charge & retry');
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.html, '<p>Use &lt;host&gt;/api/v2/charge &amp; retry</p>');
});

test('list items are separate lines', () => {
  const html = '<ul><li>Call POST /api/v1/charge</li><li>Then GET /api/v1/status</li></ul>';
  assert.deepEqual(storageToText(html).split('\n'), ['Call POST /api/v1/charge', 'Then GET /api/v1/status']);
});

test('R1 says how many OTHER lines on the page also name an old version, so a partly fixed page is never silently "clean"', () => {
  const html = '<p>Call POST /api/v1/charge now.</p><p>Retry GET /api/v1/status later.</p><p>Refund via POST /api/v1/refund.</p><p>Old note, v3 does not matter here (v2 era).</p>';
  const found = versionMismatch.run({ workItem: { ...(WORK as object), apiVersion: 'v4' } as never, page: page(html) });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.evidence.page?.moreStale, 3);
  const single = versionMismatch.run({ workItem: WORK, page: page('<p>Call POST /api/v1/charge now.</p>') });
  assert.equal(single[0]!.evidence.page?.moreStale, 0);
});
