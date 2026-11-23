import { extractFacts } from '../src/factRules.ts';
for (const t of process.argv.slice(2)) for (const e of extractFacts(t)) for (const f of e.facts) console.log(f.kind, f.unit, f.value, JSON.stringify([...f.subject]), f.qual);
