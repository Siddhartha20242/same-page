import test from 'node:test';
import assert from 'node:assert/strict';
import { durationDiffers, limitDiffers, dateDiffers } from '../src/factRules.ts';
import { check } from '../src/engine.ts';
import type { Pair } from '../src/types.ts';
import { adfToText } from '../src/adapters.ts';

const pair = (ticket: string, page: string): Pair => ({
  workItem: { key: 'PAY-1', status: 'In Progress', text: ticket },
  page: { id: '9', title: 'Auth runbook', text: page, modifiedAt: '2026-01-01T00:00:00Z' },
});
const ids = (t: string, p: string) => check(pair(t, p)).findings.filter((f) => /^R(8|9|10)_/.test(f.ruleId)).map((f) => f.ruleId);

test('R8: the example from the review, tokens expire after 30 minutes versus one hour', () => {
  const f = check(pair('Access token expiry should be 1 hour', 'Access tokens expire after 30 minutes.')).findings.filter((x) => x.ruleId === 'R8_DURATION_DIFFERS');
  assert.equal(f.length, 1);
  assert.match(f[0]!.summary, /30 minutes.*1 hour/);
  assert.equal(f[0]!.severity, 'warn');
  assert.equal(f[0]!.evidence.fact?.ticketValue, '1 hour');
});

test('R8: equal values in different units are not a contradiction (60 minutes is 1 hour)', () => {
  assert.deepEqual(ids('Token expiry is 1 hour', 'Tokens expire after 60 minutes.'), []);
});

test('R8: a different subject, an environment qualifier, a range, history and a default all stay silent', () => {
  assert.deepEqual(ids('Token expiry is 1 hour', 'Request timeout is 30 seconds.'), []);
  assert.deepEqual(ids('Production token expiry is 1 hour', 'Staging tokens expire after 5 minutes.'), []);
  assert.deepEqual(ids('Token expiry is 1 hour', 'Tokens expire after 30-60 minutes.'), []);
  assert.deepEqual(ids('Token expiry is 1 hour', 'Tokens previously expired after 30 minutes.'), []);
  assert.deepEqual(ids('Token expiry is 1 hour', 'The default token expiry is 30 minutes.'), []);
  assert.deepEqual(ids('Token expiry is 1 hour', '2026-01-04: token expiry was 30 minutes in the old build'), []);
});

test('R8: when the ticket states two values (a change from X to Y) nothing is proven, and a page that also states the ticket value is fine', () => {
  assert.deepEqual(ids('Change token expiry from 30 minutes to 1 hour', 'Tokens expire after 30 minutes.'), []);
  assert.deepEqual(ids('Token expiry is 1 hour', 'Tokens expire after 30 minutes.\nTokens expire after 1 hour for service accounts.'), []);
});

test('R8: "up to" and "at least" only compare with the same qualifier', () => {
  assert.deepEqual(ids('Token expiry is 1 hour', 'Tokens expire after up to 30 minutes.'), []);
  assert.equal(ids('Tokens expire after up to 1 hour', 'Tokens expire after up to 30 minutes.').length, 1);
});

test('R9: rate limits, sizes, counts and ports', () => {
  assert.deepEqual(ids('Rate limit is 100 requests per minute', 'The rate limit is 200 requests per minute.'), ['R9_LIMIT_DIFFERS']);
  assert.deepEqual(ids('Rate limit is 100 requests per minute', 'The rate limit is 6000 requests per hour.'), []);   // same rate, different unit
  assert.deepEqual(ids('Upload size limit is 10 MB', 'Maximum upload size limit is 25 MB.').length, 0);                // "maximum" is a qualifier the ticket lacks
  assert.deepEqual(ids('Upload size limit is 10 MB', 'The upload size limit is 25 MB.'), ['R9_LIMIT_DIFFERS']);
  assert.deepEqual(ids('Service listens on port 8080', 'The service listens on port 9090.'), ['R9_LIMIT_DIFFERS']);
  assert.deepEqual(ids('Admin port 8080', 'Metrics port 9090'), []);                                                     // different subject
  assert.deepEqual(ids('Retry up to 3 attempts', 'Retry 3 attempts.'), []);
});

test('R9: version numbers, ids and dates are not read as counts', () => {
  assert.deepEqual(ids('Retry limit is 3 attempts', 'See v2.3 requests and ticket PAY-45 of 2026-02-01 for 5 users.'), []);
});

test('R10: milestone dates', () => {
  assert.deepEqual(ids('Billing launch date is 2026-03-15', 'Billing launch date: 2026-03-01'), ['R10_DATE_DIFFERS']);
  assert.deepEqual(ids('Billing launch date is March 15, 2026', 'Billing launch is planned for 1 March 2026'), ['R10_DATE_DIFFERS']);
  assert.deepEqual(ids('Billing launch date is 2026-03-15', 'Billing launch on 15 March 2026'), []);                     // same day, different format
  assert.deepEqual(ids('Billing launch date is 2026-03-15', 'Billing code freeze is 2026-03-01'), []);                    // different milestone kind
  assert.deepEqual(ids('Billing launch date is 2026-03-15', 'Reporting launch date is 2026-03-01'), []);                  // different thing
});

test('the fact rules need no target version and no status change', () => {
  const p = pair('Token expiry is 1 hour', 'Tokens expire after 30 minutes.');
  assert.equal(p.workItem.apiVersion, undefined);
  assert.equal(p.workItem.statusChangedAt, undefined);
  assert.equal(durationDiffers.run(p).length, 1);
  assert.equal(limitDiffers.run(p).length, 0);
  assert.equal(dateDiffers.run(p).length, 0);
});

test('a work item with no text produces no fact findings', () => {
  assert.deepEqual(ids('', 'Tokens expire after 30 minutes.'), []);
});

test('a Jira description in Atlassian Document Format becomes plain lines the fact rules can read', () => {
  const adf = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Access token expiry' }, { type: 'text', text: ' should be 1 hour.' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rate limit is 100 requests per minute' }] }] }] },
  ] };
  const t = adfToText(adf);
  assert.equal(t, 'Access token expiry should be 1 hour.\nRate limit is 100 requests per minute');
  assert.equal(adfToText('plain string'), 'plain string');
  assert.equal(adfToText(null), '');
  assert.deepEqual(ids(t, 'Access tokens expire after 30 minutes.'), ['R8_DURATION_DIFFERS']);
});

import { buildPanelModel } from '../src/panelModel.ts';
test('a fact finding in the panel offers no Apply and names both ways to resolve it', async () => {
  const j = (v: unknown) => ({ ok: true, status: 200, json: async () => v });
  const route = (path: string) => {
    if (path.startsWith('/rest/api/3/issue/PAY-1?')) return j({ key: 'PAY-1', fields: { summary: 'Token expiry', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Access token expiry should be 1 hour' }] }] }, status: { name: 'In Progress' }, components: [], fixVersions: [], labels: [] } });
    if (path.startsWith('/rest/api/3/issue/PAY-1/changelog')) return j({ total: 1, values: [{ created: '2026-10-01T00:00:00Z', author: { displayName: 'Sam' }, items: [{ field: 'status' }] }] });
    if (path.startsWith('/rest/api/3/issue/PAY-1/remotelink')) return j([{ object: { url: 'https://acme.atlassian.net/wiki/spaces/E/pages/111/Runbook' } }]);
    if (path.startsWith('/wiki/api/v2/pages/111/labels')) return j({ results: [] });
    if (path.startsWith('/wiki/api/v2/pages/111')) return j({ id: '111', title: 'Token expiry runbook', version: { createdAt: '2026-08-01T00:00:00Z' }, body: { storage: { value: '<p>Access tokens expire after 30 minutes.</p>' } } });
    if (path.startsWith('/wiki/rest/api/search')) return j({ results: [] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const { createDeps } = await import('../src/atlassianDeps.ts');
  const m = await buildPanelModel('PAY-1', createDeps({ requestJira: async (p: string) => route(p) as never, requestConfluence: async (p: string) => route(p) as never }));
  assert.equal(m.status, 'findings');
  if (m.status !== 'findings') return;
  const f = m.findings.find((x) => x.ruleId === 'R8_DURATION_DIFFERS')!;
  assert.ok(f);
  assert.equal(f.suggestion?.after, undefined);
  assert.match(f.suggestion?.unavailable ?? '', /cannot tell which side is right.*1 hour instead of 30 minutes/);
  assert.match(f.evidence.ticket ?? '', /PAY-1 says: Access token expiry should be 1 hour/);
  assert.match(m.skippedRules?.[0] ?? '', /names no target version/);
});

import { DEMO_EPIC_DESCRIPTION, DEMO_PAGE_HTML } from '../src/seed.ts';
import { storageToText } from '../src/adapters.ts';
test('the demo data holds a token-expiry contradiction that R8 finds without any version', () => {
  const p = pair(DEMO_EPIC_DESCRIPTION, storageToText(DEMO_PAGE_HTML));
  assert.deepEqual(ids(DEMO_EPIC_DESCRIPTION, storageToText(DEMO_PAGE_HTML)), ['R8_DURATION_DIFFERS']);
  assert.equal(p.workItem.apiVersion, undefined);
});
