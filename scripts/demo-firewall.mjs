// Offline demo of the agent firewall core on generated data. Not from a real site. Nothing is changed anywhere.
import { evaluate, previewLines, approvedChanges, buildJournal, undoPlan, seal } from '../src/firewall.ts';
import { verifyChain } from '../src/ledger.ts';

const proposed = Array.from({ length: 180 }, (_, i) => ({ issueKey: `OPS-${i + 1}`, field: 'status', from: 'In Progress', to: 'Done' }));
console.log('Generated data, not from a real site.\n\nAn agent asks to close 180 work items.');
const d = evaluate(proposed);
console.log(previewLines(d).map((l) => '  ' + l).join('\n'));
const chosen = proposed.slice(0, 150).map(({ issueKey, field }) => ({ issueKey, field }));
const go = approvedChanges(d, chosen);
console.log(`\nA person approves 150 of them. ${go.length} go ahead, ${proposed.length - go.length} are held back.`);
const j = buildJournal('demo-1', 'cleanup-agent', go);
let chain = seal([], 'FW_APPLIED', j, d, 'dana');
console.log(`Sealed in the hash chain: ${JSON.stringify(verifyChain(chain))}`);
const now = new Map(go.map((c) => [c.issueKey, 'Done'])); now.set('OPS-7', 'Reopened by Sam');
const plan = undoPlan(j, (k) => now.get(k));
console.log(`\nUndo: ${plan.revert.length} would be put back, ${plan.skipped.length} left alone (${plan.skipped[0]?.why})`);
chain = seal(chain, 'FW_UNDONE', j, d, 'dana');
console.log(`After the undo is sealed too: ${JSON.stringify(verifyChain(chain))}`);
