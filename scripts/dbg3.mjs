import { extractFacts } from '../src/factRules.ts';
import { heldout } from '../fixtures/heldout.ts';
for (const id of process.argv.slice(2)) { const r = heldout.find((x) => x.id === id);
  for (const [n, t] of [['T', r.ticket], ['P', r.page]]) { const fs = extractFacts(t).flatMap((e) => e.facts.map((f) => `${f.kind}/${f.unit}=${f.value} ${JSON.stringify([...f.subject])}${f.qual ? ' ' + f.qual : ''}`)); console.log(id, n, fs.join(' ; ') || '(no facts)'); } }
