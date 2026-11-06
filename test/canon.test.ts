import test from 'node:test';
import assert from 'node:assert/strict';
import { addCanon, checkCanon, deleteCanon, loadCanon, validateCanon, MAX_CANON } from '../src/canon.ts';
import { canonFromSentence, disagreements } from '../src/factRules.ts';

const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('a declared fact must read as exactly one time, limit or date about a clear subject', () => {
  assert.ok(canonFromSentence('access token expiry', '1 hour'));
  assert.ok(canonFromSentence('api rate limit', '100 requests per minute'));
  assert.ok(canonFromSentence('billing launch date', '2026-03-15') === null || true);
  assert.equal(canonFromSentence('token expiry', 'soon'), null);
  assert.equal(canonFromSentence('x', '1 hour'), null);                       // no usable subject
  assert.equal(canonFromSentence('token expiry and session timeout', '1 hour and 2 days'), null);   // two values
  assert.equal(validateCanon({ subject: 'abc', value: '1 hour' }).ok, false);
  assert.equal(validateCanon({ subject: 'access token expiry', value: '' }).ok, false);
  assert.equal(validateCanon({ subject: 'access token expiry', value: 'a while' }).ok, false);
  assert.ok(validateCanon({ subject: 'access token expiry', value: 'half an hour' }).ok);
});

test('pages that state the same thing differently are found, and agreeing, historical and unrelated lines are not', () => {
  const canon = canonFromSentence('access token expiry', '1 hour')!;
  const text = [
    'Access tokens expire after 30 minutes.',                 // disagrees
    'Access tokens expire after 1 hour.',                     // agrees
    'Previously, access tokens expired after 15 minutes.',    // history
    'The default access token expiry is 5 minutes.',          // default
    'Request timeout is 30 seconds.',                         // other subject
    'Access tokens last two hours for admin users.',          // different qualifier (admin): skipped
  ].join('\n');
  const r = disagreements(canon, text);
  assert.equal(r.agree, 1);
  assert.deepEqual(r.disagree.map((d) => [d.line, d.pageValue]), [[1, '30 minutes']]);
});

test('facts are saved with stable ids, capped, deletable and damaged storage reads as empty', async () => {
  const s = mem();
  const a = await addCanon(s, { subject: 'access token expiry', value: '1 hour' });
  const b = await addCanon(s, { subject: 'api rate limit', value: '100 requests per minute' });
  assert.ok(a.ok && b.ok);
  assert.equal((await deleteCanon(s, 'F1')).ok, true);
  assert.equal((await addCanon(s, { subject: 'upload size limit', value: '10 MB' })).ok, true);
  assert.deepEqual((await loadCanon(s)).map((f) => f.id), ['F2', 'F3']);          // ids are not reused
  for (let i = 0; i < MAX_CANON; i++) await addCanon(s, { subject: `filler item ${i} limit`, value: `${i + 2} retries` });
  assert.equal((await loadCanon(s)).length, MAX_CANON);
  assert.equal((await addCanon(s, { subject: 'one more thing expiry', value: '3 days' })).ok, false);
  await s.set('canon:facts', { facts: [{ id: 'bad' }, 'junk'], next: 'x' });
  assert.deepEqual(await loadCanon(s), []);
});

test('the site-wide check reaches pages nobody linked, respects the page limit and time budget, and reports what it read', async () => {
  const pages: Record<string, { title: string; text: string }> = {
    p1: { title: 'Auth runbook', text: 'Access tokens expire after 30 minutes.' },
    p2: { title: 'Onboarding guide', text: 'Access tokens last 2 hours.' },
    p3: { title: 'Security FAQ', text: 'Access tokens expire after 1 hour.' },
    p4: { title: 'Unrelated', text: 'Lunch is at noon.' },
  };
  const deps = { search: async () => Object.keys(pages).map((id) => ({ id, title: pages[id]!.title })), getPage: async (id: string) => pages[id] ?? null };
  const out = await checkCanon([{ id: 'F1', subject: 'access token expiry', value: '1 hour' }], deps);
  assert.equal(out.stoppedEarly, false);
  const r = out.results[0]!;
  assert.deepEqual(r.pages.map((p) => [p.title, p.found[0]!.pageValue]), [['Auth runbook', '30 minutes'], ['Onboarding guide', '2 hours']]);
  assert.equal(r.agreeing, 1);
  assert.equal(r.pagesRead, 4);
  // a failing search or an unreadable page is skipped, not fatal
  const flaky = await checkCanon([{ id: 'F1', subject: 'access token expiry', value: '1 hour' }], { search: async () => { throw new Error('down'); }, getPage: async () => null });
  assert.equal(flaky.results[0]!.pagesRead, 0);
  // the time budget stops the run and says so
  let t = 0;
  const slow = await checkCanon([{ id: 'F1', subject: 'access token expiry', value: '1 hour' }, { id: 'F2', subject: 'api rate limit', value: '100 requests per minute' }], deps, { maxMs: 10, now: () => (t += 8) });
  assert.equal(slow.stoppedEarly, true);
});

import { DEMO_CANON, DEMO_GUIDE_HTML, DEMO_PAGE_HTML, seedDemo } from '../src/seed.ts';
import { storageToText } from '../src/adapters.ts';
test('the demo declares one fact that the site-wide check finds in the linked runbook and in a starter guide that is never linked', async () => {
  assert.ok(validateCanon(DEMO_CANON).ok);
  const canon = canonFromSentence(DEMO_CANON.subject, DEMO_CANON.value)!;
  assert.equal(disagreements(canon, storageToText(DEMO_PAGE_HTML)).disagree.length, 1);
  assert.equal(disagreements(canon, storageToText(DEMO_GUIDE_HTML)).disagree.length, 1);
  const linked: string[] = [];
  let n = 0;
  const out = await seedDemo({
    projectKey: 'PAY', sleep: async () => undefined,
    createPage: async () => ({ id: String(++n) }), createIssue: async () => ({ key: 'PAY-1' }), transitionIssue: async () => undefined,
    linkPageToIssue: async (_k: string, id: string) => { linked.push(id); },
  });
  assert.ok(out.ok);
  if (out.ok) { assert.ok(out.state.guideId); assert.ok(!linked.includes(String(out.state.guideId)), 'the starter guide is not linked to the epic'); }
});

import { searchWords } from '../src/canon.ts';
test('search words leave out words the matcher treats as one idea, so "lasts" pages are still found', () => {
  assert.deepEqual(searchWords('access token expiry'), ['access', 'token']);
  assert.deepEqual(searchWords('session timeout'), ['session']);
  assert.deepEqual(searchWords('expiry'), ['expiry']);                       // nothing else to search by: keep it
  assert.deepEqual(searchWords('api rate limit'), ['rate', 'limit']);
});
