import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeps } from '../src/atlassianDeps.ts';
import { whatIfVersionTool, NOTICE } from '../src/tools.ts';
import { whatIfVersion, normalizeVersion } from '../src/whatIf.ts';
import type { HttpResponse } from '../src/atlassianDeps.ts';
import type { Page, WorkItem } from '../src/types.ts';

const wi = (apiVersion: string | undefined): WorkItem => ({ key: 'PAY-1', status: 'In Progress', apiVersion, statusChangedAt: '2026-10-01T00:00:00Z', text: 'Migrate Payment API' });
const pg = (id: string, text: string): Page => ({ id, title: `Page ${id}`, text, modifiedAt: '2026-08-01T00:00:00Z' });

test('normalizeVersion accepts v3, V3, 3 and 3.1 and refuses anything else', () => {
  assert.equal(normalizeVersion('v3'), 'v3');
  assert.equal(normalizeVersion(' V3 '), 'v3');
  assert.equal(normalizeVersion('3'), 'v3');
  assert.equal(normalizeVersion('3.1'), 'v3');
  for (const bad of ['', 'latest', 'v', 'v3; drop', '1e3', undefined, null, {}]) assert.equal(normalizeVersion(bad), null);
});

test('a page that matches today starts contradicting if the target moves, and a stale one stops', () => {
  const pages = [pg('1', 'Call POST /api/v2/charge to charge.'), pg('2', 'Call POST /api/v1/refund to refund.')];
  const r = whatIfVersion({ workItem: wi('v2'), pages }, 'v3');
  assert.equal(r.currentVersion, 'v2');
  assert.deepEqual(r.wouldStartContradicting.map((x) => x.pageId), ['1']);
  assert.deepEqual(r.wouldStopContradicting, []);
  assert.equal(r.stillContradicting, 1);                       // page 2 was already stale and still is
  const back = whatIfVersion({ workItem: wi('v2'), pages }, 'v1');
  assert.deepEqual(back.wouldStopContradicting.map((x) => x.pageId), ['2']);
  assert.deepEqual(back.wouldStartContradicting.map((x) => x.pageId), ['1']);
});

test('proposing the current version changes nothing, and the input is not modified', () => {
  const item = { workItem: wi('v2'), pages: [pg('1', 'Call POST /api/v1/charge.')] };
  const snapshot = structuredClone(item);
  const r = whatIfVersion(item, 'v2');
  assert.deepEqual([r.wouldStartContradicting, r.wouldStopContradicting], [[], []]);
  assert.deepEqual(item, snapshot);
});

function site(pageText: string) {
  const routes: Record<string, unknown> = {
    '/rest/api/3/issue/PAY-1?fields=': { key: 'PAY-1', fields: { summary: 'Migrate Payment API to v2', status: { name: 'In Progress' }, components: [], fixVersions: [], labels: [] } },
    '/rest/api/3/issue/PAY-1/changelog': { total: 1, values: [{ created: '2026-10-01T00:00:00Z', author: { displayName: 'Sam' }, items: [{ field: 'status' }] }] },
    '/rest/api/3/issue/PAY-1/remotelink': [{ object: { url: 'https://acme.atlassian.net/wiki/spaces/E/pages/111/Runbook' } }],
    '/wiki/rest/api/search': { results: [] },
    '/wiki/api/v2/pages/111/labels': { results: [] },
    '/wiki/api/v2/pages/111': { id: '111', title: 'Payment Runbook', version: { createdAt: '2026-08-01T00:00:00Z' }, body: { storage: { value: `<p>${pageText}</p>` } } },
  };
  const respond = async (path: string): Promise<HttpResponse> => {
    const hit = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => path.startsWith(k));
    return hit ? { ok: true, status: 200, json: async () => structuredClone(routes[hit]) } : { ok: false, status: 404, json: async () => ({}) };
  };
  return createDeps({ requestJira: respond, requestConfluence: respond });
}

interface Out { status?: string; error?: string; changed?: boolean; proposedVersion?: string; wouldStartContradicting?: { docTitle: string; quotedDocLine: string; rule: string }[]; wouldStopContradicting?: unknown[]; notice?: string }

test('what_if_version names the page that would start contradicting, quotes its line, and says nothing was changed', async () => {
  const r = (await whatIfVersionTool({ issueKey: 'PAY-1', proposedVersion: 'v3' }, site('Call POST /api/v2/charge to charge.'))) as Out;
  assert.equal(r.status, 'previewed');
  assert.equal(r.changed, false);
  assert.equal(r.proposedVersion, 'v3');
  assert.equal(r.wouldStartContradicting?.length, 1);
  assert.equal(r.wouldStartContradicting?.[0]?.docTitle, 'Payment Runbook');
  assert.equal(r.wouldStartContradicting?.[0]?.quotedDocLine, 'Call POST /api/v2/charge to charge.');
  assert.equal(r.notice, NOTICE);
});

test('what_if_version refuses a bad key or version and never calls Atlassian for them', async () => {
  const boom = createDeps({ requestJira: async () => { throw new Error('should not be called'); }, requestConfluence: async () => { throw new Error('should not be called'); } });
  assert.match(String(((await whatIfVersionTool({ issueKey: 'nope', proposedVersion: 'v3' }, boom)) as Out).error), /PAY-123/);
  assert.match(String(((await whatIfVersionTool({ issueKey: 'PAY-1', proposedVersion: 'latest' }, boom)) as Out).error), /v3/);
});
