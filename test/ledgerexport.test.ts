import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAuditExport } from '../src/ledgerExport.ts';
import { recordHandling } from '../src/handling.ts';

const mem = () => { const m = new Map<string, unknown>(); return { m, get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('the audit export holds hashes and no evidence text, covers the latest entries, and verifies offline', async () => {
  const s = mem();
  for (let i = 0; i < 6; i++) await recordHandling(s, { event: i % 2 ? 'DISMISSED' : 'DISCOVERED', ruleId: 'R1_VERSION_MISMATCH', issueKey: 'PAY-1', note: i % 2 ? 'reason: secret reason text' : undefined, by: 'acct-9' });
  const full = await buildAuditExport(s as never);
  assert.equal(full.entries.length, 6);
  assert.doesNotMatch(JSON.stringify(full), /secret reason text|acct-9|evidence"/);
  const part = await buildAuditExport(s as never, { max: 3 });
  assert.equal(part.from, 3);
  assert.equal(part.entries.length, 3);
  assert.notEqual(part.startPrevHash, '0'.repeat(64));
  const dir = mkdtempSync(join(tmpdir(), 'sp-'));
  const good = join(dir, 'good.json');
  writeFileSync(good, JSON.stringify(part));
  assert.match(execFileSync('node', ['scripts/verify-export.mjs', good], { encoding: 'utf8' }), /^OK: 3 entries/);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ ...part, entries: part.entries.map((e, i) => (i === 1 ? { ...e, ruleId: 'R4_STATUS_CLAIM_STALE:APPLIED' } : e)) }));
  assert.throws(() => execFileSync('node', ['scripts/verify-export.mjs', bad], { encoding: 'utf8', stdio: 'pipe' }));
});
