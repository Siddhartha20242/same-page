import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/engine.ts';
import { pairs } from '../fixtures/pairs.ts';

for (const p of pairs) {
  test(`fixture ${p.id}`, () => {
    const got = check(p).findings.filter((f) => f.severity !== 'info').map((f) => f.ruleId).sort();
    assert.deepEqual(got, [...p.expect].sort());
  });
}

test('precision/recall summary', () => {
  let tp = 0, fp = 0, fn = 0;
  for (const p of pairs) {
    const got = check(p).findings.filter((f) => f.severity !== 'info').map((f) => f.ruleId);
    const exp = [...p.expect];
    for (const g of got) { const i = exp.indexOf(g); if (i >= 0) { tp++; exp.splice(i, 1); } else fp++; }
    fn += exp.length;
  }
  console.log(`# findings: TP=${tp} FP=${fp} FN=${fn} precision=${(tp / (tp + fp)).toFixed(2)} recall=${(tp / (tp + fn)).toFixed(2)}`);
  assert.equal(fp, 0);
  assert.equal(fn, 0);
});
