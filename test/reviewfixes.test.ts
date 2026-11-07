import test from 'node:test';
import assert from 'node:assert/strict';
import { runPlayground } from '../src/playground.ts';
import { BUILT_IN_RULES } from '../src/rules.ts';
import { canonFromSentence, disagreements, extractFacts } from '../src/factRules.ts';
import { loadCited } from '../src/release.ts';
import { checkPage } from '../src/pageCheck.ts';
import { findingHistory } from '../src/tools.ts';
import { recordHandling } from '../src/handling.ts';
import type { Issue } from '../src/types.ts';

const fired = (ticketText: string, pageText: string) => { const r = runPlayground({ ticketText, pageText }, BUILT_IN_RULES); return r.ok ? r.hits.length : -1; };

test('equal values written in different units never differ by floating-point error (1.1 hours is 66 minutes)', () => {
  assert.equal(fired('Auth token expiry should be 1.1 hours', 'Auth tokens expire after 66 minutes.'), 0);
  assert.equal(fired('Max upload size is 2.2 MB', 'The maximum upload size is 2252.8 KB.'), 0);
  assert.equal(fired('Auth token expiry should be 1.1 hours', 'Auth tokens expire after 67 minutes.'), 1);          // a real difference still fires
  const c = canonFromSentence('access token expiry', '1.1 hours')!;
  assert.equal(disagreements(c, 'Access tokens expire after 66 minutes.').agree, 1);
});

test('a dated log line is skipped by the site-wide check even when its wording was rewritten (half an hour, 1h30m, two hours)', () => {
  const c = canonFromSentence('access token expiry', '1 hour')!;
  for (const said of ['half an hour', '1h30m', 'two hours', '30 minutes']) {
    assert.equal(disagreements(c, `2017-10-31: access tokens expire after ${said}`).disagree.length, 0, `dated: ${said}`);
    assert.equal(disagreements(c, `Access tokens expire after ${said}.`).disagree.length, 1, `undated: ${said}`);        // and the same line without a date is still found
  }
  assert.equal(fired('Access token expiry should be 1 hour', '2017-10-31: access tokens expire after half an hour'), 0);   // the rules apply the same guard
});

test('facts are extracted once per text and the normalized line is kept for slicing', () => {
  const t = 'Tokens expire after half an hour\nPort 8080';
  assert.equal(extractFacts(t), extractFacts(t));
  assert.equal(extractFacts(t)[0]!.norm, 'Tokens expire after 30 minutes');
  assert.equal(extractFacts(t)[0]!.lines[0], 'Tokens expire after half an hour');         // evidence still quotes the page as written
});

const issue = (key: string, status: string, summary = 'Cleanup'): Issue => ({ key, summary, status, components: [], fixVersions: [], labels: [], requiredFields: [], fields: {} } as never);

test('closing times are read only for closed cited tickets, and the tickets are read in parallel', async () => {
  const statuses: Record<string, string> = { 'PAY-2': 'Done', 'PAY-3': 'In Progress', 'PAY-4': 'Closed' };
  const asked: string[] = []; let inFlight = 0; let peak = 0;
  const cited = await loadCited('PAY-1', [{ id: 'p', title: 'Runbook', text: 'See PAY-2, PAY-3 and PAY-4.', modifiedAt: '2026-10-01T00:00:00Z' } as never],
    async (k) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 15)); inFlight--; return issue(k, statuses[k]!); },
    async (k) => { asked.push(k); return { at: '2026-09-15T00:00:00Z', by: null }; });
  assert.deepEqual(asked.sort(), ['PAY-2', 'PAY-4']);                                   // the open ticket's changelog is never fetched
  assert.ok(peak >= 2, `expected parallel reads, peak was ${peak}`);
  assert.equal(cited!['PAY-2']!.changedAt, '2026-09-15T00:00:00Z');
  assert.equal(cited!['PAY-3']!.changedAt, undefined);
  assert.deepEqual(Object.keys(cited!).sort(), ['PAY-2', 'PAY-3', 'PAY-4']);
});

test('the Confluence byline check applies the same "page edited after the ticket closed" test as the panel', async () => {
  const run = async (closedAt: string) => checkPage('77', {
    loadPage: async () => ({ text: 'Rollout is blocked by PAY-9 until it lands. See PAY-1 for the v2 migration.', modifiedAt: '2026-10-01T00:00:00Z', title: 'Runbook' }),
    loadIssue: async (k) => (k === 'PAY-1' ? issue('PAY-1', 'In Progress', 'Migrate to v2') : issue('PAY-9', 'Done')),
    getTransition: async (k) => ({ at: k === 'PAY-1' ? '2026-11-02T00:00:00Z' : closedAt, by: null }),
  });
  const after = await run('2026-09-15T00:00:00Z');                                       // closed before the page was last edited
  assert.equal(after.status, 'clean');
  const before = await run('2026-10-20T00:00:00Z');                                      // closed after: the page may simply be behind
  assert.equal(before.status, 'issues');
  assert.match(JSON.stringify(before), /still open/);
});

test('findingHistory reads the ledger in parallel batches of at most 25, keeps order, and names the Audit trail tab', async () => {
  const m = new Map<string, unknown>(); let inFlight = 0; let peak = 0;
  const kv = {
    get: async (k: string) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 2)); inFlight--; return m.get(k); },
    set: async (k: string, v: unknown) => { m.set(k, v); },
  };
  for (let i = 0; i < 60; i++) await recordHandling(kv as never, { event: i % 2 ? 'DISMISSED' : 'DISCOVERED', ruleId: 'R1_VERSION_MISMATCH', issueKey: i % 3 ? 'PAY-1' : 'PAY-2', pageId: '9' });
  peak = 0;
  const r = await findingHistory({ issueKey: 'PAY-2' }, kv as never) as { status: string; events: { at: string; event: string }[]; note: string };
  assert.equal(r.status, 'found');
  assert.equal(r.events.length, 20);                                                      // every third of 60 entries
  assert.deepEqual(r.events.map((e) => e.at), [...r.events.map((e) => e.at)].sort());      // oldest first
  assert.ok(peak > 1 && peak <= 25, `peak concurrent reads was ${peak}`);
  assert.match(r.note, /Audit trail tab/);
  assert.doesNotMatch(r.note, /Show the audit trail/);
});

test('the playground says which rules it cannot try', () => {
  const r = runPlayground({ ticketText: 'x', pageText: 'y' }, BUILT_IN_RULES);
  assert.ok(r.ok && /R5/.test(r.note) && /R6/.test(r.note) && /R7/.test(r.note));
});
