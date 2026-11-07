import test from 'node:test';
import assert from 'node:assert/strict';
import { activeOverride, checkReason, grantOverride, revokeOverride, OVERRIDE_HOURS } from '../src/breakGlass.ts';
import { recordHandling } from '../src/handling.ts';
import { verifyStored } from '../src/ledgerStore.ts';

const mem = () => { const m = new Map<string, unknown>(); return { m, get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('a reason is required, trimmed and capped, and markup is stripped', () => {
  assert.equal(checkReason('short').ok, false);
  assert.equal(checkReason('').ok, false);
  const r = checkReason('  Emergency <b>hotfix</b> for INC-991 \n ');
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.reason, 'Emergency b hotfix /b for INC-991');
  const long = checkReason('x'.repeat(500));
  assert.ok(long.ok && long.reason.length === 200);
});

test('an override lasts 24 hours for that work item only, expires, and can be revoked', async () => {
  const s = mem();
  let t = Date.parse('2026-11-07T10:00:00Z');
  const g = await grantOverride(s, { issueKey: 'PAY-1', reason: 'Emergency hotfix for INC-991', by: 'acct-1' }, () => t);
  assert.ok(g.ok);
  assert.equal(OVERRIDE_HOURS, 24);
  assert.equal((await activeOverride(s, 'PAY-1', () => t + 3600_000))?.reason, 'Emergency hotfix for INC-991');
  assert.equal(await activeOverride(s, 'PAY-2', () => t + 3600_000), null);                 // another work item: not covered
  assert.equal(await activeOverride(s, 'PAY-1', () => t + 25 * 3600_000), null);            // expired
  await revokeOverride(s, 'PAY-1', () => t + 1800_000);                                     // the same fake clock: a revoke stamped with the real time made this test pass or fail by the hour of the day
  assert.equal(await activeOverride(s, 'PAY-1', () => t + 3600_000), null);
  assert.equal((await grantOverride(s, { issueKey: 'PAY-1', reason: 'no' })).ok, false);
});

test('granting and using an override are sealed in the hash chain with the reason', async () => {
  const s = mem();
  await recordHandling(s, { event: 'OVERRIDE', ruleId: 'GATE', issueKey: 'PAY-1', note: 'reason: Emergency hotfix for INC-991', by: 'acct-1' });
  await recordHandling(s, { event: 'OVERRIDE_USED', ruleId: 'GATE', issueKey: 'PAY-1', note: 'transition allowed' });
  assert.ok((await verifyStored(s)).ok);
  const e = s.m.get('ledger:e:0') as { ruleId: string; evidence: { page: { snippet: string } } };
  assert.equal(e.ruleId, 'GATE:OVERRIDE');
  assert.match(e.evidence.page.snippet, /Emergency hotfix for INC-991 by acct-1/);
});

// Forge storage rejects a null value ("Provided request body is invalid"), which broke Revoke on a real site. A store that behaves the same way:
const strict = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { if (v === null || v === undefined) throw new Error('Provided request body is invalid'); m.set(k, v); } }; };

test('revoking an override never writes null, and a revoked override is no longer active', async () => {
  const s = strict();
  const t = Date.parse('2026-11-07T10:00:00Z');
  await grantOverride(s, { issueKey: 'PAY-1', reason: 'Emergency hotfix for INC-991' }, () => t);
  assert.ok(await activeOverride(s, 'PAY-1', () => t + 1000));
  await revokeOverride(s, 'PAY-1', () => t + 2000);
  assert.equal(await activeOverride(s, 'PAY-1', () => t + 3000), null);
});

import { setMinutesPerFix, loadImpact } from '../src/impact.ts';
test('clearing the minutes-per-fix estimate never writes null either', async () => {
  const s = strict();
  assert.equal((await setMinutesPerFix(s as never, '15')).ok, true);
  assert.equal((await setMinutesPerFix(s as never, '0')).ok, true);
  assert.equal((await loadImpact(s as never)).estimatedHoursSaved, null);
});
