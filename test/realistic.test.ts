import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../scripts/realistic-report.mjs';

// Three authored wording sets (fixtures/realistic.ts, heldout.ts, heldout2.ts). They guard wording and false alarms; they measure nothing about real sites.
// The held-out set's first run, before any fix, scored precision 0.86 and recall 0.40 (docs/accuracy.md). These eight still need real meaning.
const NEEDS_MEANING = ['h01', 'h04', 'h05', 'h06', 'h10', 'h11', 'i02', 'i04'];

test('the wording sets raise no false alarm, and miss only the documented cases that need meaning', () => {
  const s = score();
  assert.equal(s.fp, 0, s.wrong.join('\n'));
  assert.deepEqual(s.wrong.map((w) => w.split(':')[0]).sort(), NEEDS_MEANING, 'a documented miss now fires (update the list) or a new one appeared');
  assert.ok(s.cases >= 100);
});
