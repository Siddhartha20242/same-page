import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPlayground } from '../src/playground.ts';
import { BUILT_IN_RULES } from '../src/rules.ts';

// Cases are written by the authors (fixtures/rewording.json). This guards wording, it does not measure real recall.
const cases = JSON.parse(readFileSync(new URL('../fixtures/rewording.json', import.meta.url), 'utf8')) as { id: string; fire: boolean; ticket: string; page: string }[];
const fired = (c: { ticket: string; page: string }) => { const r = runPlayground({ ticketText: c.ticket, pageText: c.page }, BUILT_IN_RULES); return r.ok && r.hits.some((h) => /^R(8|9|10) /.test(h.label)); };

test('agreeing statements in different words never fire (stemming and wording must not add noise)', () => {
  for (const c of cases.filter((x) => !x.fire)) assert.equal(fired(c), false, `${c.id}: "${c.ticket}" vs "${c.page}"`);
});

test('reworded contradictions are caught, except the ones that need real meaning', () => {
  const needMeaning = new Set(['d5', 'd6', 'r1']);                 // "Cache TTL" vs "entries live", "retry window" vs "retried within", "timeout" vs "signed out after"
  for (const c of cases.filter((x) => x.fire && !needMeaning.has(x.id))) assert.equal(fired(c), true, `${c.id}: "${c.ticket}" vs "${c.page}"`);
  for (const id of needMeaning) assert.equal(fired(cases.find((x) => x.id === id)!), false, `${id} is documented as a known miss; if it now fires, update the list`);
});
