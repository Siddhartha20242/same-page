import test from 'node:test';
import assert from 'node:assert/strict';
import { recordDrafted, loadDraftCounts } from '../src/draft.ts';
import { withSeverities, saveSeverity, loadSeverityOverrides } from '../src/ruleCatalog.ts';
import { filterModelByTriage } from '../src/triage.ts';
import { addCustomRule, compileRule } from '../src/customRules.ts';

const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('a rule in draft is taken out of the findings, reported as drafted, and cannot raise the verdict', () => {
  const m = { findings: [{ id: 'a', ruleId: 'R1_VERSION_MISMATCH', severity: 'block' }, { id: 'b', ruleId: 'R4_STATUS_CLAIM_STALE', severity: 'warn' }], notes: [{ id: 'n', ruleId: 'R1_VERSION_MISMATCH', severity: 'info' }], verdict: 'BLOCKED' };
  const out = withSeverities(m, { R1_VERSION_MISMATCH: 'draft' });
  assert.deepEqual(out.findings.map((f) => f.id), ['b']);
  assert.deepEqual(out.drafted, [{ id: 'a', ruleId: 'R1_VERSION_MISMATCH' }]);
  assert.equal(out.verdict, 'WARN');
  assert.equal(out.notes.length, 1);                                     // notes are history and are not drafted
});

test('a model whose only finding is drafted ends up clean after triage', () => {
  const m = { issueKey: 'PAY-1', status: 'findings', pagesChecked: 1, findings: [{ id: 'a', ruleId: 'R8_DURATION_DIFFERS', severity: 'warn' }], notes: [], verdict: 'WARN' };
  const after = filterModelByTriage(withSeverities(m, { R8_DURATION_DIFFERS: 'draft' }) as never, {}) as { status: string };
  assert.equal(after.status, 'clean');
});

test('draft is a third setting for a built-in rule and for a team rule, and drafted findings are counted once each', async () => {
  const s = mem();
  assert.ok((await saveSeverity(s, 'R8_DURATION_DIFFERS', 'draft')).ok);
  assert.deepEqual(await loadSeverityOverrides(s), { R8_DURATION_DIFFERS: 'draft' });
  assert.equal((await saveSeverity(s, 'R8_DURATION_DIFFERS', 'nonsense')).ok, false);
  const c = await addCustomRule(s, { name: 'Draft rule', template: 'phrase-while-status', phrase: 'some phrase', value: 'Done', severity: 'draft' });
  assert.ok(c.ok && c.def.severity === 'draft');
  if (c.ok) assert.equal(compileRule(c.def).severity, 'warn');          // hidden by the settings, not by the rule itself
  await recordDrafted(s, [{ id: 'a', ruleId: 'R8_DURATION_DIFFERS' }, { id: 'b', ruleId: 'R8_DURATION_DIFFERS' }]);
  await recordDrafted(s, [{ id: 'a', ruleId: 'R8_DURATION_DIFFERS' }]);   // seen before
  assert.deepEqual(await loadDraftCounts(s), { R8_DURATION_DIFFERS: 2 });
  await recordDrafted({ get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); } }, [{ id: 'x', ruleId: 'R1' }]);   // never throws
});
