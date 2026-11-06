import test from 'node:test';
import assert from 'node:assert/strict';
import { markFinding, loadReviewCounts, loadReviewMarks, reviewSummary } from '../src/review.ts';
import { loadImpact } from '../src/impact.ts';

const mem = () => { const m = new Map<string, unknown>(); return { m, get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('marks count once per finding, can be changed, and feed a summary that warns when the sample is small', async () => {
  const s = mem();
  assert.equal((await markFinding(s, { id: 'a1', ruleId: 'R1_VERSION_MISMATCH', verdict: 'real' })).ok, true);
  await markFinding(s, { id: 'a1', ruleId: 'R1_VERSION_MISMATCH', verdict: 'real' });                 // same mark again: no double count
  await markFinding(s, { id: 'a2', ruleId: 'R1_VERSION_MISMATCH', verdict: 'false' });
  await markFinding(s, { id: 'a3', ruleId: 'R8_DURATION_DIFFERS', verdict: 'real' });
  let c = await loadReviewCounts(s);
  assert.deepEqual(c.R1_VERSION_MISMATCH, { real: 1, false: 1 });
  const sum = reviewSummary(c);
  assert.equal(sum.total, 3);
  assert.equal(sum.realPercent, 67);
  assert.match(sum.line, /too few to say anything about accuracy/);
  await markFinding(s, { id: 'a2', ruleId: 'R1_VERSION_MISMATCH', verdict: 'real' });                // a person changes their mind
  c = await loadReviewCounts(s);
  assert.deepEqual(c.R1_VERSION_MISMATCH, { real: 2, false: 0 });
  assert.deepEqual(await loadReviewMarks(s, ['a1', 'a2', 'zzz']), { a1: 'real', a2: 'real' });
});

test('bad input is refused, damaged storage reads as empty, and the small-sample warning goes away at ten', async () => {
  const s = mem();
  assert.equal((await markFinding(s, { id: 'x', ruleId: 'R1', verdict: 'maybe' })).ok, false);
  assert.equal((await markFinding(s, { id: '', ruleId: 'R1', verdict: 'real' })).ok, false);
  s.m.set('review:counts', 'junk');
  assert.deepEqual(await loadReviewCounts(s), {});
  assert.equal(reviewSummary({}).line, 'No findings have been marked yet.');
  assert.doesNotMatch(reviewSummary({ R1: { real: 8, false: 2 } }).line, /too few/);
  assert.match(reviewSummary({ R1: { real: 8, false: 2 } }).line, /10 findings reviewed.*8 real, 2 false alarms \(80% real\)/);
});

test('the impact figures carry the review summary and never turn marks into a time-saved number', async () => {
  const s = mem();
  await markFinding(s, { id: 'a1', ruleId: 'R1_VERSION_MISMATCH', verdict: 'real' });
  const i = await loadImpact(s as never) as { review?: { total: number }; estimatedHoursSaved: number | null };
  assert.equal(i.review?.total, 1);
  assert.equal(i.estimatedHoursSaved, null);
});
