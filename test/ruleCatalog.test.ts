import test from 'node:test';
import assert from 'node:assert/strict';
import { RULE_CATALOG, loadSeverityOverrides, saveSeverity, withSeverities, effectiveSeverity, ruleLabel } from '../src/ruleCatalog.ts';
import { BUILT_IN_RULES } from '../src/rules.ts';
import { formatBlockMessage } from '../src/gate.ts';

const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('the catalog lists every built-in rule with the severity it ships with', () => {
  assert.deepEqual(RULE_CATALOG.map((r) => r.ruleId), BUILT_IN_RULES.map((r) => r.id));
  for (const r of BUILT_IN_RULES) assert.equal(RULE_CATALOG.find((c) => c.ruleId === r.id)?.defaultSeverity, r.severity, r.id);
});

test('a severity can be moved between block and warn, and moving it back removes the override', async () => {
  const s = mem();
  assert.deepEqual(await loadSeverityOverrides(s), {});
  const r = await saveSeverity(s, 'R4_STATUS_CLAIM_STALE', 'block');
  assert.ok(r.ok);
  assert.equal(effectiveSeverity('R4_STATUS_CLAIM_STALE', await loadSeverityOverrides(s)), 'block');
  await saveSeverity(s, 'R4_STATUS_CLAIM_STALE', 'warn');
  assert.deepEqual(await loadSeverityOverrides(s), {});
});

test('unknown rules and unknown severities are refused', async () => {
  const s = mem();
  assert.equal((await saveSeverity(s, 'R99', 'block')).ok, false);
  assert.equal((await saveSeverity(s, 'R1_VERSION_MISMATCH', 'info')).ok, false);
  assert.deepEqual(await loadSeverityOverrides(s), {});
});

test('overrides change findings and the verdict; notes are never changed', () => {
  const m = { findings: [{ ruleId: 'R1_VERSION_MISMATCH', severity: 'block' }, { ruleId: 'R4_STATUS_CLAIM_STALE', severity: 'warn' }], notes: [{ ruleId: 'R1_VERSION_MISMATCH', severity: 'info' }], verdict: 'BLOCKED' };
  const down = withSeverities(m, { R1_VERSION_MISMATCH: 'warn' });
  assert.equal(down.verdict, 'WARN');
  assert.equal(down.notes[0]!.severity, 'info');
  const up = withSeverities(m, { R4_STATUS_CLAIM_STALE: 'block' });
  assert.equal(up.findings[1]!.severity, 'block');
  assert.equal(withSeverities(m, {}), m);
});

test('the refusal names the rule, the page and the next step, and withholds text when the page is hidden', () => {
  const b = { id: '1', ruleId: 'R1_VERSION_MISMATCH', summary: 'Page documents v1', pageId: '9', pageTitle: 'Payments runbook', docLine: 'POST /api/v1/charge' };
  const shown = formatBlockMessage('PAY-1', [b]);
  assert.match(shown, /Rule: R1 Stale version/);
  assert.match(shown, /Update the page "Payments runbook"/);
  assert.match(shown, /review task/);
  const hidden = formatBlockMessage('PAY-1', [{ ...b, hidden: true }]);
  assert.doesNotMatch(hidden, /Payments runbook|POST \/api/);
  assert.match(hidden, /cannot view/);
  assert.equal(ruleLabel('nope'), 'Rule');
});
