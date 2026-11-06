import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketFactsOf } from '../src/factRules.ts';
import { receipt } from '../src/tools.ts';

test('the panel can show what was read from a ticket: values with what they are about, in the ticket\'s own words', () => {
  const facts = ticketFactsOf('Auth token expiry should be 1 hour\nThe service listens on port 8443\nRelease date is 2026-12-01');
  assert.ok(facts.some((f) => /^1 hour \(.*token.*\)$/.test(f)), facts.join(' | '));
  assert.ok(facts.some((f) => /^port 8443 \(/.test(f)));
  assert.ok(facts.some((f) => f === '2026-12-01 (release date)'), facts.join(' | '));
  assert.ok(facts.every((f) => !/\b(servic|expir)\b$/.test(f)), 'shows words as written, not stems');
});

test('a ticket with no number or date reads nothing, and the list is capped and de-duplicated', () => {
  assert.deepEqual(ticketFactsOf('Improve search relevance for the help center'), []);
  assert.deepEqual(ticketFactsOf(''), []);
  const many = ticketFactsOf(Array.from({ length: 30 }, (_, i) => `Cache ${i} TTL is ${i + 1} minutes`).join('\n'));
  assert.ok(many.length <= 8);
  assert.equal(new Set(many).size, many.length);
});

test('a receipt uses an injectable clock, pluralises, and truncates evidence ids to eight characters', () => {
  const at = new Date('2026-11-07T10:00:00.000Z');
  assert.equal(receipt('PAY-9', 2, ['aaaaaaaa1111', 'bbbbbbbb2222'], at).line, 'Same Page checked 2 linked pages for PAY-9 at 2026-11-07T10:00:00.000Z with fixed rules R1 to R10 (no model): 2 contradictions found (evidence #aaaaaaaa, #bbbbbbbb).');
  assert.match(receipt('PAY-9', 1, [], at).line, /checked 1 linked page for PAY-9 .* no contradiction found by the rules/);
});
