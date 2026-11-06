import test from 'node:test';
import assert from 'node:assert/strict';
import { bump, markSeen, readCounts } from '../src/metrics.ts';

const mem = () => { const m = new Map<string, unknown>(); return { m, get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('counters start at zero, add up, and ignore garbage in storage', async () => {
  const s = mem();
  assert.deepEqual(await readCounts(s), { seen: 0, applied: 0, dismissed: 0, snoozed: 0, reviewTasks: 0, gateBlocks: 0, gateWouldBlock: 0, gateOverrides: 0 });
  await bump(s, 'applied'); await bump(s, 'applied'); await bump(s, 'gateBlocks', 3);
  assert.equal((await readCounts(s)).applied, 2);
  assert.equal((await readCounts(s)).gateBlocks, 3);
  s.m.set('metrics:counts', { applied: 'lots', seen: -4, dismissed: 7 });
  const c = await readCounts(s);
  assert.deepEqual([c.applied, c.seen, c.dismissed], [0, 0, 7]);
});

test('a finding is counted once, the first time it is shown, however often the panel reloads', async () => {
  const s = mem();
  await markSeen(s, ['a', 'b', 'a']);
  await markSeen(s, ['a', 'b']);
  await markSeen(s, ['b', 'c']);
  assert.equal((await readCounts(s)).seen, 3);
});

test('a broken store never throws into the panel or the gate', async () => {
  const broken = { get: async () => { throw new Error('kvs down'); }, set: async () => { throw new Error('kvs down'); } };
  await bump(broken, 'applied');
  await markSeen(broken, ['a']);
  assert.equal((await readCounts(broken)).applied, 0);
});

test('a burst of new ids is capped per call so one panel load cannot flood storage', async () => {
  const s = mem();
  await markSeen(s, Array.from({ length: 100 }, (_, i) => `id${i}`));
  assert.equal((await readCounts(s)).seen, 25);
});
