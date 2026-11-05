import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFinding, verifyChain } from '../src/ledger.ts';
import { appendToStore, verifyStored, headOf } from '../src/ledgerStore.ts';

// The standalone verifier (scripts/verify-receipt.mjs) duplicates the hashing on purpose, so it can run with nothing else.
// These tests keep the two copies from drifting apart and prove tampering is caught.

const finding = (line: string) => ({ ruleId: 'R1_VERSION_MISMATCH:APPLIED', evidence: { page: { id: '1', line: 2, snippet: line, modifiedAt: '2026-11-05T00:00:00.000Z' }, workItem: { key: 'PAY-1' } } });
const fixedNow = (() => { let n = 0; return () => `2026-11-05T00:00:0${n++}.000Z`; })();
const script = join(import.meta.dirname, '..', 'scripts', 'verify-receipt.mjs');
const write = (dir: string, name: string, v: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(v)); return p; };

test('the standalone verifier accepts what the app writes, and the chain link between two receipts', () => {
  const chain = appendFinding(appendFinding([], finding('/api/v1/charge -> /api/v2/charge'), fixedNow), finding('/api/v1/refund -> /api/v2/refund'), fixedNow);
  assert.equal(verifyChain(chain).ok, true);
  const dir = mkdtempSync(join(tmpdir(), 'receipt-'));
  const a = write(dir, 'a.json', chain[0]); const b = write(dir, 'b.json', chain[1]);
  const out = execFileSync('node', [script, b, a], { encoding: 'utf8' });
  assert.match(out, /PASS {2}evidence matches evidenceHash/);
  assert.match(out, /PASS {2}previous receipt is the one this entry points back to/);
  assert.match(out, /verifies/);
});

test('the standalone verifier fails on altered evidence, an altered entry, and the wrong previous receipt', () => {
  const chain = appendFinding(appendFinding([], finding('x -> y'), fixedNow), finding('p -> q'), fixedNow);
  const dir = mkdtempSync(join(tmpdir(), 'receipt-'));
  const run = (...files: string[]) => spawnSync('node', [script, ...files], { encoding: 'utf8' });
  const evidenceEdited = write(dir, 'e.json', { ...chain[1], evidence: { ...chain[1]!.evidence, page: { ...chain[1]!.evidence!.page, snippet: 'something else' } } });
  assert.notEqual(run(evidenceEdited).status, 0);
  const entryEdited = write(dir, 'n.json', { ...chain[1], issueKey: 'PAY-999' });
  assert.notEqual(run(entryEdited).status, 0);
  const good = write(dir, 'g.json', chain[1]);
  const wrongPrev = write(dir, 'w.json', { ...chain[0], entryHash: '0'.repeat(64) });
  assert.notEqual(run(good, wrongPrev).status, 0);
  assert.equal(run(good).status, 0);
});

test('the app seals entries in storage and detects an entry that was rewritten afterwards', async () => {
  const m = new Map<string, unknown>();
  const kv = { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } };
  await appendToStore(kv, finding('a -> b'));
  await appendToStore(kv, finding('c -> d'));
  const third = await appendToStore(kv, finding('e -> f'));
  assert.equal((await headOf(kv)).length, 3);
  assert.equal((await verifyStored(kv)).ok, true);
  assert.equal((await headOf(kv)).head, third.entryHash);
  m.set('ledger:e:1', { ...(m.get('ledger:e:1') as object), ruleId: 'R1_VERSION_MISMATCH:EDITED' });      // someone rewrites history
  const after = await verifyStored(kv);
  assert.equal(after.ok, false);
});
