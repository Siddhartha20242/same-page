// Offline demo of the on-call story on generated data. Not from a real site. Nothing is changed anywhere.
// A release ticket changed three facts; the linked runbook did not. Same Page names each one.
import { check } from '../src/engine.ts';

const ticket = 'Deploy payments-api v2. Timeout is 10 seconds. Release freeze starts on December 15, 2026.';
const runbook = ['Payments API runbook', 'Call POST /api/v1/charge to create a charge.', 'Timeout is 30 seconds.', 'Release freeze starts on December 1, 2026.', 'Restart payments-api in namespace payments-old.'].join('\n');
const r = check({
  workItem: { key: 'PAY-9', status: 'In Progress', apiVersion: 'v2', statusChangedAt: '2026-11-20T10:00:00Z', text: ticket },
  page: { id: '1', title: 'Payments API runbook', text: runbook, modifiedAt: '2026-08-01T10:00:00Z' },
});
console.log('Generated data, not from a real site.\n\nTicket PAY-9: ' + ticket + '\nRunbook, last edited 2026-08-01:\n  ' + runbook.split('\n').slice(1).join('\n  ') + '\n');
console.log(`Same Page found ${r.findings.length} contradiction(s):`);
for (const f of r.findings) console.log(`  ${f.ruleId.split('_')[0]}  ${f.summary}${f.evidence.page?.snippet ? `\n      page line: ${f.evidence.page.snippet}` : ''}`);
console.log('\nNot found: the retired namespace on the last line. A fixed rule reads versions, times, limits, ports, percentages, dates and declared names; an unnamed namespace is none of those.');
