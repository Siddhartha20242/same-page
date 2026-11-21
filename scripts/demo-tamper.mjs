// Shows, offline and with no credentials, why the audit trail is tamper-evident: node scripts/demo-tamper.mjs
// It builds a small chain with the app's own ledger code, writes an audit export in the real format, verifies it with the real verifier
// (scripts/verify-export.mjs), changes ONE field of ONE entry, and verifies again. The entries are generated here for the demonstration:
// this is not data from a real site. Hash-chained, not signed (see docs/security.md for what that does and does not prove).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAuditExport } from '../src/ledgerExport.ts';
import { recordHandling } from '../src/handling.ts';

const m = new Map();
const store = { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } };
const EVENTS = ['DISCOVERED', 'DISMISSED', 'DISCOVERED', 'APPLIED', 'DISCOVERED', 'DISMISSED'];
for (const [i, event] of EVENTS.entries()) await recordHandling(store, { event, ruleId: 'R1_VERSION_MISMATCH', issueKey: 'DEMO-1', note: event === 'DISMISSED' ? `reason: example ${i}` : undefined });

const bundle = await buildAuditExport(store);
const dir = mkdtempSync(join(tmpdir(), 'same-page-demo-'));
const run = (file) => { try { return { ok: true, out: execFileSync('node', ['scripts/verify-export.mjs', file], { encoding: 'utf8', stdio: 'pipe' }).trim() }; } catch (e) { return { ok: false, out: String(e.stderr).trim() }; } };

console.log('Generated demonstration data (not from a real site): a chain of', bundle.entries.length, 'entries.\n');
const good = join(dir, 'export.json');
writeFileSync(good, JSON.stringify(bundle));
console.log('1. Verify the untouched export:\n   ', run(good).out, '\n');

const target = 2;
const forged = { ...bundle, entries: bundle.entries.map((e, i) => (i === target ? { ...e, ruleId: 'R4_STATUS_CLAIM_STALE' } : e)) };
const bad = join(dir, 'export-edited.json');
writeFileSync(bad, JSON.stringify(forged));
console.log(`2. Change one field of entry ${target} (the rule id) and verify again:\n   `, run(bad).out, '\n');

console.log('Every entry stores the hash of the one before it, so changing any past entry breaks the link from that point on.');
