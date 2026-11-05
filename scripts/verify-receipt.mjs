#!/usr/bin/env node
// Re-verifies a Same Page audit receipt WITHOUT the app, a network or a login. A receipt is one ledger entry as JSON:
//   { seq, prevHash, at, ruleId, issueKey, evidenceHash, entryHash, evidence }
// It checks, with plain SHA-256 over canonical JSON (keys sorted):
//   1. sha256(canonical(evidence)) equals evidenceHash        -> the evidence was not altered
//   2. sha256(canonical(entry core)) equals entryHash         -> the entry was not altered
// and, when you pass the PREVIOUS receipt too, that this entry's prevHash is that receipt's entryHash (the chain link).
// What it cannot prove: that the app never skipped recording something, or that nobody with storage access rewrote the whole chain.
//
// Usage:  node scripts/verify-receipt.mjs receipt.json [previous-receipt.json]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
// Must stay identical to canonicalize() in src/ledger.ts: keys sorted at every level, undefined values dropped.
const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

const [file, prevFile] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/verify-receipt.mjs receipt.json [previous-receipt.json]'); process.exit(2); }
const { entryHash, evidence, ...core } = JSON.parse(readFileSync(file, 'utf8'));
let bad = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) bad++; };

if (evidence !== undefined) check('evidence matches evidenceHash', sha256(canonical(evidence)) === core.evidenceHash);
else console.log('SKIP  evidence was dropped to save storage; only the entry itself can be checked');
check('entry matches entryHash', sha256(canonical(core)) === entryHash);
if (prevFile) {
  const prev = JSON.parse(readFileSync(prevFile, 'utf8'));
  check('previous receipt is the one this entry points back to', prev.entryHash === core.prevHash && prev.seq + 1 === core.seq);
}
console.log(bad ? `\n${bad} check(s) FAILED: this receipt was altered or is not what it claims.` : `\nReceipt #${core.seq} (${core.ruleId}, ${core.issueKey ?? 'no issue'}) verifies.`);
process.exit(bad ? 1 : 0);
