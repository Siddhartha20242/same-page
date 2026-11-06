import test from 'node:test';
import assert from 'node:assert/strict';
import { runPlayground } from '../src/playground.ts';
import { BUILT_IN_RULES } from '../src/rules.ts';
import { compileRule } from '../src/customRules.ts';

test('the playground shows which built-in rules fire on pasted sample text, with the triggering line', () => {
  const r = runPlayground({ ticketText: 'Migrate Payment API to v2\nAccess token expiry should be 1 hour', pageText: 'Call POST /api/v1/charge.\nAccess tokens expire after 30 minutes.' }, BUILT_IN_RULES);
  assert.ok(r.ok);
  if (!r.ok) return;
  const labels = r.hits.map((h) => h.label);
  assert.ok(labels.includes('R1 Stale version'));
  assert.ok(labels.includes('R8 Duration differs'));
  assert.equal(r.hits.find((h) => h.label === 'R1 Stale version')!.line, 1);
});

test('a team rule and a declared fact are tried too, and an empty paste or a quiet sample says so plainly', () => {
  const rule = compileRule({ id: 'C1_CUSTOM', name: 'Ready too early', template: 'phrase-while-status', phrase: 'ready for production', value: '!Done', severity: 'warn' });
  const r = runPlayground({ ticketText: 'Checkout', pageText: 'The checkout is ready for production.\nAccess tokens last 2 hours.', status: 'In Progress' }, [...BUILT_IN_RULES, rule], [{ id: 'F1', subject: 'access token expiry', value: '1 hour' }]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.hits.some((h) => h.label === 'Custom rule'));
  assert.ok(r.hits.some((h) => h.kind === 'fact' && /2 hours/.test(h.summary)));
  assert.equal(runPlayground({}, BUILT_IN_RULES).ok, false);
  const quiet = runPlayground({ ticketText: 'Fix typo', pageText: 'Nothing relevant here.' }, BUILT_IN_RULES);
  assert.ok(quiet.ok && quiet.hits.length === 0);
});

import { stripLegacySections, storageToText } from '../src/adapters.ts';
test('a section under a Legacy or Deprecated heading is left out, up to the next heading of the same or higher level', () => {
  const html = '<h2>Charging</h2><p>Call POST /api/v2/charge.</p><h2>Legacy endpoints</h2><p>POST /api/v1/charge</p><h3>Details</h3><p>v1 details</p><h2>Refunds</h2><p>POST /api/v2/refund</p>';
  const text = storageToText(html);
  assert.match(text, /\/api\/v2\/charge/);
  assert.match(text, /\/api\/v2\/refund/);
  assert.doesNotMatch(text, /v1/);
  assert.equal(stripLegacySections('<p>no headings</p>'), '<p>no headings</p>');
  assert.match(storageToText('<h2>Old versions</h2><p>v1</p>'), /^$/);
  assert.match(storageToText('<h2>Overview</h2><p>v1 is described here</p>'), /v1 is described here/);
});

test('a legacy section hides the stale line from R1 while a live line outside it is still found', async () => {
  const { check } = await import('../src/engine.ts');
  const text = storageToText('<h2>Charging</h2><p>Call POST /api/v1/charge.</p><h2>Legacy</h2><p>POST /api/v1/old</p>');
  const r = check({ workItem: { key: 'PAY-1', status: 'In Progress', apiVersion: 'v2', statusChangedAt: '2026-10-01T00:00:00Z' } as never, page: { id: '1', title: 't', text, modifiedAt: '2026-01-01T00:00:00Z' } });
  assert.equal(r.findings.filter((f) => f.ruleId === 'R1_VERSION_MISMATCH')[0]!.evidence.page?.snippet, 'Call POST /api/v1/charge.');
});
