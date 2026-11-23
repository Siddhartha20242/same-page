// Runs the realistic-wording corpus and prints precision and recall. Offline.
import { check } from '../src/engine.ts';
import { realistic as tuned } from '../fixtures/realistic.ts';
import { heldout } from '../fixtures/heldout.ts';
const realistic = process.argv.includes('--heldout') ? heldout : process.argv.includes('--tuned') ? tuned : [...tuned, ...heldout];

const RULE = { R8: 'R8_DURATION_DIFFERS', R9: 'R9_LIMIT_DIFFERS', R10: 'R10_DATE_DIFFERS' };

export function score() {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const wrong = [];
  for (const r of realistic) {
    const res = check({
      workItem: { key: 'PAY-1', status: 'In Progress', text: r.ticket },
      page: { id: '9', title: 'Runbook', text: r.page, modifiedAt: '2026-01-01T00:00:00Z' },
    });
    const got = res.findings.filter((f) => /^R(8|9|10)_/.test(f.ruleId)).map((f) => f.ruleId);
    const want = r.fire ? RULE[r.fire] : null;
    const ok = want ? got.includes(want) : got.length === 0;
    if (want) { if (ok) tp++; else fn++; } else if (ok) tn++; else fp++;
    if (!ok) wrong.push(`${r.id}: want ${want ?? 'none'}, got ${got.join(',') || 'none'}`);
  }
  return { cases: realistic.length, tp, fp, fn, tn, wrong,
    precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = score();
  console.log(`cases ${s.cases}  true positives ${s.tp}  false alarms ${s.fp}  misses ${s.fn}  true negatives ${s.tn}`);
  console.log(`precision ${s.precision.toFixed(2)}  recall ${s.recall.toFixed(2)}  (authors' own wording, not real data)`);
  for (const x of s.wrong) console.log('  ' + x);
}
