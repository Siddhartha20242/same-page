// Verifies an audit export produced by Same Page ("Export for an auditor") without the app: node scripts/verify-export.mjs export.json
// It re-computes every entry hash, checks each entry links to the one before it and that the last entry matches the stated head.
// Hash-chained, not signed: compare the head with the copy anchored on the Jira work item to detect a rewritten history.
import { readFileSync } from 'node:fs';
import { verifyChain } from '../src/ledger.ts';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/verify-export.mjs export.json'); process.exit(2); }
const bundle = JSON.parse(readFileSync(file, 'utf8'));
if (bundle.samePageAudit !== 1 || !Array.isArray(bundle.entries)) { console.error('not a Same Page audit export'); process.exit(2); }
const r = verifyChain(bundle.entries, { startSeq: bundle.from, startPrevHash: bundle.startPrevHash });
if (!r.ok) { console.error(`BROKEN at entry ${r.brokenAt}: ${r.reason}`); process.exit(1); }
if (bundle.entries.length && r.head !== bundle.head) { console.error('The last entry does not match the stated head.'); process.exit(1); }
console.log(`OK: ${bundle.entries.length} entries (${bundle.from} to ${bundle.from + bundle.entries.length - 1} of ${bundle.totalEntries}), head ${bundle.head.slice(0, 12)}…`);
