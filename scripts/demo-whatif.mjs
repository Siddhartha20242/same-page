// Shows, offline and with no credentials, the what-if check: node scripts/demo-whatif.mjs
// A work item targets v2 today. Before anyone changes it to v3, which linked pages would start contradicting it? The pages and the work
// item are generated here for the demonstration (not from a real site). The check is the app's own fixed rules, with no model, and nothing is written.
import { whatIfVersion } from '../src/whatIf.ts';

const workItem = { key: 'DEMO-1', status: 'In Progress', apiVersion: 'v2', statusChangedAt: '2026-10-01T00:00:00Z', text: 'Migrate the Payment API to v2' };
const pages = [
  { id: '1', title: 'Payment runbook', modifiedAt: '2026-08-01T00:00:00Z', text: 'Charge a card with POST /api/v2/charge.' },
  { id: '2', title: 'Refund guide', modifiedAt: '2026-08-01T00:00:00Z', text: 'Refund with POST /api/v1/refund.' },
  { id: '3', title: 'Onboarding notes', modifiedAt: '2026-08-01T00:00:00Z', text: 'Welcome. Ask your lead for access.' },
];
const show = (r) => `${r.pageTitle} (line ${r.line}): ${r.summary}`;
console.log('Example data, generated for this demo; not from a real site.\n');
console.log(`${workItem.key} targets ${workItem.apiVersion} today. What if it targeted v3?\n`);
const r = whatIfVersion({ workItem, pages }, 'v3');
console.log(`Would START contradicting (${r.wouldStartContradicting.length}):`);
for (const x of r.wouldStartContradicting) console.log(`  - ${show(x)}`);
console.log(`Would STOP contradicting (${r.wouldStopContradicting.length}):`);
for (const x of r.wouldStopContradicting) console.log(`  - ${show(x)}`);
console.log(`Already contradicting, and still would: ${r.stillContradicting}`);
console.log('\nNothing was changed. Same fixed rules, no model; only the target version was swapped for the question.');
