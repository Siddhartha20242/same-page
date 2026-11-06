import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGateMode, toGateMode } from '../src/gate.ts';
import { buildPilotReport } from '../src/pilotReport.ts';
import { loadImpact } from '../src/impact.ts';
import { markFinding, loadReviewCounts } from '../src/review.ts';
import { bump } from '../src/metrics.ts';

const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('watch mode allows every transition and says it would have refused; enforce is the default and refuses', () => {
  const refuse = { result: false, errorMessage: 'blocked', basis: 'live' as const };
  const allow = { result: true, basis: 'live' as const };
  assert.deepEqual(applyGateMode(refuse, 'watch'), { result: true, watched: true });
  assert.deepEqual(applyGateMode(refuse, 'enforce'), { result: false, errorMessage: 'blocked', watched: false });
  assert.deepEqual(applyGateMode(allow, 'watch'), { result: true, watched: false });
  assert.equal(toGateMode(undefined), 'enforce');
  assert.equal(toGateMode('nonsense'), 'enforce');
  assert.equal(toGateMode('watch'), 'watch');
});

test('the impact line and the pilot report carry the watch-only count, per-rule marks and the caveats, and no page text or keys', async () => {
  const s = mem();
  await bump(s, 'seen', 4); await bump(s, 'gateWouldBlock', 3);
  await markFinding(s, { id: 'a', ruleId: 'R1_VERSION_MISMATCH', verdict: 'real' });
  await markFinding(s, { id: 'b', ruleId: 'R1_VERSION_MISMATCH', verdict: 'false' });
  const impact = await loadImpact(s as never);
  assert.match(impact.line, /3 would have been refused in watch-only mode/);
  const text = buildPilotReport({ impact, reviews: await loadReviewCounts(s), gateMode: 'watch', customRules: 2, on: '2026-11-06' });
  assert.match(text, /Gate: watch only; transitions refused: 0; would have been refused in watch-only mode: 3/);
  assert.match(text, /R1 Stale version: 1 real, 1 false alarm/);
  assert.match(text, /Under 10 reviewed findings is too few/);
  assert.match(text, /Time saved: not stated\./);
  assert.doesNotMatch(text, /PAY-\d|acct-|https?:/);
});
