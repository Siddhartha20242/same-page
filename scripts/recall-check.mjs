// Recall on reworded contradictions: runs every case in fixtures/rewording.json through the real rules and prints what fired.
// The cases are written by the authors, so this is a regression guard for wording, not a measurement of real recall.
import { readFileSync } from 'node:fs';
import { runPlayground } from '../src/playground.ts';
import { BUILT_IN_RULES } from '../src/rules.ts';
const cases = JSON.parse(readFileSync(new URL('../fixtures/rewording.json', import.meta.url), 'utf8'));
let caught = 0, missed = 0, quiet = 0, noisy = 0; const rows = [];
for (const c of cases) {
  const r = runPlayground({ ticketText: c.ticket, pageText: c.page }, BUILT_IN_RULES);
  const hit = r.ok ? r.hits.filter((h) => /^R(8|9|10) /.test(h.label)).length > 0 : false;
  if (c.fire) { hit ? caught++ : missed++; } else { hit ? noisy++ : quiet++; }
  if (hit !== c.fire) rows.push(`${c.id} ${c.fire ? 'MISSED' : 'FALSE ALARM'}: "${c.ticket}" vs "${c.page}"`);
}
const fires = cases.filter((c) => c.fire).length;
console.log(`contradictions caught ${caught}/${fires}; agreeing statements left alone ${quiet}/${cases.length - fires}`);
rows.forEach((x) => console.log('  ' + x));
if (process.argv.includes('--strict') && rows.length) process.exit(1);
