import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedDeps } from '../src/seedDeps.ts';
import { seedDemo, DEMO_EPIC_SUMMARY } from '../src/seed.ts';
import { confluencePageIdsFromRemoteLinks } from '../src/links.ts';
import type { FetchLikeResponse, RequestInit2 } from '../src/seedDeps.ts';

// Narrowing helper: a missing value fails the test with a clear message instead of a TypeError later.
function must<T>(v: T | undefined | null, what = 'value'): T { assert.ok(v != null, `expected ${what} to be present`); return v; }

function site({ spaces = [{ id: '9' }], projects = [{ key: 'PAY' }], noTransition = false } = {}) {
  const calls: string[] = []; let n = 100;
  const request = async (_kind: 'jira' | 'confluence', path: string, init: RequestInit2 = {}): Promise<FetchLikeResponse> => {
    calls.push(`${init.method ?? 'GET'} ${path}`);
    const reply = (v: unknown, status = 200): FetchLikeResponse => ({ ok: status < 300, status, json: async () => v });
    if (path.startsWith('/wiki/api/v2/spaces')) return reply({ results: spaces });
    if (path.startsWith('/rest/api/3/project/search')) return reply({ values: projects });
    if (path === '/wiki/api/v2/pages') return reply({ id: String(++n) });
    if (path.includes('/label')) return reply([]);
    if (path === '/rest/api/3/issue') return reply({ key: 'PAY-7' });
    if (path.endsWith('/transitions') && !init.method) return reply({ transitions: noTransition ? [] : [{ id: '31', name: 'Start', to: { name: 'In Progress' } }] });
    return reply({}, 204);
  };
  return { calls, request };
}

test('the seed runs end to end through the real call shapes: page, epic, transition, decision page, links', async () => {
  const { calls, request } = site();
  const sd = createSeedDeps(request, 'https://acme.atlassian.net');
  const out = await seedDemo({ ...sd.makeDeps(await sd.findPlace()), sleep: async () => {} });
  assert.equal(out.ok, true);
  assert.equal(out.epicKey, 'PAY-7');
  const order = calls.map((c) => c.split(' ')[1]);
  assert.ok(order.indexOf('/wiki/api/v2/pages') < order.indexOf('/rest/api/3/issue'));          // page BEFORE the epic: no backdating needed
  assert.ok(order.indexOf('/rest/api/3/issue') < order.findIndex((p) => p.endsWith('/transitions')));
  assert.ok(calls.some((c) => c.includes('/label')));                                           // R2 needs the deprecated label
  assert.equal(DEMO_EPIC_SUMMARY, 'Migrate Payment API to v2');
});

test('the remote link the seed writes is one the engine can read back', () => {
  assert.deepEqual(confluencePageIdsFromRemoteLinks([{ object: { url: '/wiki/pages/viewpage.action?pageId=101' } }]), ['101']);
});

test('no space or no project gives a readable error, not a half-seeded site', async () => {
  await assert.rejects(createSeedDeps(site({ spaces: [] }).request).findPlace(), /No Confluence space/);
  await assert.rejects(createSeedDeps(site({ projects: [] }).request).findPlace(), /No Jira software project/);
});

test('a workflow without an In Progress transition fails with a clear message and keeps the partial state', async () => {
  const sd = createSeedDeps(site({ noTransition: true }).request);
  const out = await seedDemo({ ...sd.makeDeps(await sd.findPlace()), sleep: async () => {}, retries: 0 });
  assert.equal(out.ok, false);
  assert.equal(out.failedAt, 'transitioned');
  assert.match(out.error, /No transition/);
  assert.ok(out.state.runbookId && out.state.epicKey);   // resumable
});

test('remote links use the absolute site URL (Jira rejects relative ones), and a failed link is retried on the next run', async () => {
  const { request } = site();
  const bodies: string[] = [];
  const spy = async (kind: 'jira' | 'confluence', path: string, init?: RequestInit2) => {
    if (path.endsWith('/remotelink')) bodies.push(String(init?.body));
    return request(kind, path, init);
  };
  const noSite = createSeedDeps(spy);
  const first = await seedDemo({ ...noSite.makeDeps(await noSite.findPlace()), sleep: async () => {} });
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.state.linked, false);                       // no site URL: recorded, not fatal
  const sd = createSeedDeps(spy, 'https://acme.atlassian.net/');
  const again = await seedDemo({ ...sd.makeDeps(await sd.findPlace()), existing: first.state, sleep: async () => {} });
  assert.equal(again.ok && again.state.linked, true);                          // retried and fixed
  assert.equal(JSON.parse(bodies[0]!).object.url.startsWith('https://acme.atlassian.net/wiki/pages/viewpage.action?pageId='), true);
  assert.ok(!bodies[0]!.includes('net//wiki'));
});

test('the seed asks only for software projects (a service desk project cannot hold the demo epic)', async () => {
  const asked: string[] = [];
  const { request } = site();
  const spy = async (kind: 'jira' | 'confluence', path: string, init?: RequestInit2) => { if (path.includes('/project/search')) asked.push(path); return request(kind, path, init); };
  await createSeedDeps(spy).findPlace();
  assert.ok(asked[0]!.includes('typeKey=software'));
});

test('the demo epic goes in the project the panel was opened in when that is a software project', async () => {
  const { request } = site({ projects: [{ key: 'OTHER' }] });
  const spy = async (kind: 'jira' | 'confluence', path: string, init?: RequestInit2) => {
    if (path === '/rest/api/3/project/PAY') return { ok: true, status: 200, json: async () => ({ key: 'PAY', projectTypeKey: 'software' }) } as unknown as FetchLikeResponse;
    if (path === '/rest/api/3/project/DESK') return { ok: true, status: 200, json: async () => ({ key: 'DESK', projectTypeKey: 'service_desk' }) } as unknown as FetchLikeResponse;
    return request(kind, path, init);
  };
  assert.equal((await createSeedDeps(spy).findPlace('PAY')).projectKey, 'PAY');
  assert.equal((await createSeedDeps(spy).findPlace('DESK')).projectKey, 'OTHER');       // not software: fall back to the search
  assert.equal((await createSeedDeps(spy).findPlace('bad key!')).projectKey, 'OTHER');   // never put odd text in a URL
});
