import test from 'node:test';
import assert from 'node:assert/strict';
import { tuningHint } from '../src/tuning.ts';
import { addCustomRule, exportRules, importRules, loadCustomDefs, MAX_CUSTOM_RULES } from '../src/customRules.ts';

const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('tuning hints come from marks and dismissals, need enough samples, and are only suggestions', () => {
  assert.equal(tuningHint({ severity: 'block', real: 1, falseAlarm: 3, dismissed: 0, acted: 0 }), null);                    // 4 marks: too few
  assert.match(tuningHint({ severity: 'block', real: 2, falseAlarm: 4, dismissed: 0, acted: 0 })!, /4 of 6 findings.*false alarms.*making it a Warning/);
  assert.match(tuningHint({ severity: 'warn', real: 2, falseAlarm: 4, dismissed: 0, acted: 0 })!, /Keep it a Warning.*narrower team rule/);
  assert.match(tuningHint({ severity: 'warn', real: 5, falseAlarm: 1, dismissed: 0, acted: 0 })!, /5 of 6.*real.*Blocker/);
  assert.equal(tuningHint({ severity: 'block', real: 5, falseAlarm: 1, dismissed: 0, acted: 0 }), null);                    // already a blocker and mostly real: nothing to suggest
  assert.match(tuningHint({ severity: 'warn', real: 0, falseAlarm: 0, dismissed: 4, acted: 1 })!, /dismissed 4 of 5.*few findings are marked/);
  assert.equal(tuningHint({ severity: 'warn', real: 0, falseAlarm: 0, dismissed: 1, acted: 1 }), null);
});

test('team rules can be exported as text and imported on another site, with every rule checked', async () => {
  const a = mem();
  await addCustomRule(a, { name: 'Ready too early', template: 'phrase-while-status', phrase: 'ready for production', value: '!Done', severity: 'block' });
  await addCustomRule(a, { name: 'Payments need rollback', template: 'label-needs-phrase', phrase: 'rollback', value: 'payments' });
  const text = exportRules(await loadCustomDefs(a));
  assert.doesNotMatch(text, /C\d+_CUSTOM/);                                  // ids are not exported
  const b = mem();
  const r = await importRules(b, text);
  assert.deepEqual(r, { ok: true, added: 2, skipped: 0, reasons: [] });
  const defs = await loadCustomDefs(b);
  assert.deepEqual(defs.map((d) => [d.name, d.severity]), [['Ready too early', 'block'], ['Payments need rollback', 'warn']]);
  assert.deepEqual(defs.map((d) => d.id), ['C1_CUSTOM', 'C2_CUSTOM']);        // the other site assigns its own ids
});

test('import refuses other text, skips bad rules and counts them, and respects the cap', async () => {
  const s = mem();
  assert.equal((await importRules(s, 'not json')).ok, false);
  assert.equal((await importRules(s, JSON.stringify({ hello: 1 }))).ok, false);
  const mixed = JSON.stringify({ samePageRules: 1, rules: [{ name: 'Good rule', template: 'phrase-while-status', phrase: 'some phrase', value: 'Done' }, { name: 'x', template: 'nope', phrase: 'a', value: '' }] });
  const r = await importRules(s, mixed);
  assert.ok(r.ok && r.added === 1 && r.skipped === 1 && r.reasons.length === 1);
  const many = JSON.stringify({ samePageRules: 1, rules: Array.from({ length: 15 }, (_, i) => ({ name: `Rule number ${i}`, template: 'phrase-while-status', phrase: `phrase ${i}`, value: 'Done' })) });
  await importRules(s, many);
  assert.ok((await loadCustomDefs(s)).length <= MAX_CUSTOM_RULES);
});
