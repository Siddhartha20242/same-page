import { extractFacts } from '../src/factRules.ts';
import { realistic } from '../fixtures/realistic.ts';
for (const id of process.argv.slice(2)) {
  const r = realistic.find((x) => x.id === id);
  for (const [n, t] of [['T', r.ticket], ['P', r.page]])
    for (const e of extractFacts(t)) for (const f of e.facts) console.log(id, n, f.kind, f.unit, f.value, JSON.stringify([...f.subject]), f.qual, '|', e.lines[0].trim().slice(0, 60));
}
