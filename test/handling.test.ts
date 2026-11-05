import test from 'node:test';
import assert from 'node:assert/strict';
import { recordHandling } from '../src/handling.ts';
import { verifyStored, headOf } from '../src/ledgerStore.ts';
import { markSeen } from '../src/metrics.ts';

const mem = () => { const m = new Map<string, unknown>(); return { m, get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('a finding gets a handling timeline in the same verified chain, with who and why where a person acted', async () => {
  const s = mem();
  assert.equal(await recordHandling(s, { event: 'DISCOVERED', ruleId: 'R1_VERSION_MISMATCH', issueKey: 'PAY-1', pageId: '9' }), true);
  await recordHandling(s, { event: 'DISMISSED', ruleId: 'R1_VERSION_MISMATCH', issueKey: 'PAY-1', pageId: '9', note: 'reason: intentional rollback section', by: 'acct-123' });
  await recordHandling(s, { event: 'REVIEW_TASK', ruleId: 'R1_VERSION_MISMATCH', issueKey: 'PAY-1', pageId: '9', note: 'task PAY-7', by: 'acct-123' });
  const v = await verifyStored(s);
  assert.ok(v.ok);
  assert.equal((await headOf(s)).length, 3);
  const e1 = s.m.get('ledger:e:1') as { ruleId: string; evidence: { page: { snippet: string } } };
  assert.equal(e1.ruleId, 'R1_VERSION_MISMATCH:DISMISSED');
  assert.match(e1.evidence.page.snippet, /reason: intentional rollback section by acct-123/);
  assert.equal((s.m.get('ledger:e:0') as { evidence: { page: { snippet?: string } } }).evidence.page.snippet, undefined);   // discovery records no person
});

test('editing an old handling entry breaks the chain', async () => {
  const s = mem();
  await recordHandling(s, { event: 'DISCOVERED', ruleId: 'R1_VERSION_MISMATCH', issueKey: 'PAY-1' });
  await recordHandling(s, { event: 'DISMISSED', ruleId: 'R1_VERSION_MISMATCH', issueKey: 'PAY-1', note: 'reason: x', by: 'a' });
  const e = s.m.get('ledger:e:0') as { ruleId: string };
  s.m.set('ledger:e:0', { ...e, ruleId: 'R1_VERSION_MISMATCH:APPLIED' });
  assert.equal((await verifyStored(s)).ok, false);
});

test('a storage failure never throws, and only findings shown for the first time are reported as new', async () => {
  const broken = { get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); } };
  assert.equal(await recordHandling(broken, { event: 'DISCOVERED', ruleId: 'R1', issueKey: 'PAY-1' }), false);
  const s = mem();
  assert.deepEqual(await markSeen(s, ['a', 'b']), ['a', 'b']);
  assert.deepEqual(await markSeen(s, ['b', 'c']), ['c']);
});
