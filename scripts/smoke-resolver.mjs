// Runs the REAL resolver code (same-page-app/src/index.ts plus the synced core) against a fake Atlassian.
// Forge's own packages are swapped for tiny stand-ins, so this checks OUR wiring: the routes, the asUser calls, the model, the task.
// It does not check Atlassian. Needs esbuild (installed in ./forge-tools). Run: node scripts/smoke-resolver.mjs
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { build } = await import(pathToFileURL(resolve('forge-tools/node_modules/esbuild/lib/main.js')).href);
const dir = mkdtempSync(join(tmpdir(), 'same-page-smoke-'));

writeFileSync(join(dir, 'resolver.mjs'), `
export default class Resolver {
  constructor() { this.defs = {}; }
  define(name, fn) { this.defs[name] = fn; }
  getDefinitions() { return async (req) => this.defs[req.call.functionKey](req); }
}`);
writeFileSync(join(dir, 'api.mjs'), `
export const route = (strings, ...v) => strings.reduce((a, s, i) => a + s + (v[i] ?? ''), '');
export const assumeTrustedRoute = (p) => p;
const call = (kind) => (path, init) => globalThis.__site(kind, String(path), init);
export default { asUser: () => ({ requestJira: call('jira'), requestConfluence: call('confluence') }), asApp: () => ({ requestJira: call('jira'), requestConfluence: call('confluence') }) };`);

writeFileSync(join(dir, 'kvs.mjs'), `
const m = (globalThis.__kvs ??= new Map());
export const kvs = { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } };`);

const out = join(dir, 'bundle.mjs');
await build({
  entryPoints: ['same-page-app/src/index.ts'], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent',
  alias: { '@forge/api': join(dir, 'api.mjs'), '@forge/resolver': join(dir, 'resolver.mjs'), '@forge/kvs': join(dir, 'kvs.mjs') },
});

// A fake site, documented response shapes (written here, not captured). Records every call and every created issue.
const log = []; const created = []; const puts = [];
const routes = {
  '/rest/api/3/issue/PAY-1?fields=': { key: 'PAY-1', fields: { summary: 'Migrate Payment API to v2', status: { name: 'In Progress' }, components: [], fixVersions: [], labels: [] } },
  '/rest/api/3/issue/PAY-1/changelog': { total: 1, values: [{ created: '2026-10-01T00:00:00Z', author: { displayName: 'Sam' }, items: [{ field: 'status' }] }] },
  '/rest/api/3/issue/PAY-1/remotelink': [{ object: { url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/111/Runbook' } }],
  '/wiki/rest/api/search': { results: [] },
  '/wiki/api/v2/pages/111/labels': { results: [] },
  '/wiki/api/v2/pages/111': { id: '111', title: 'Payment Runbook', version: { createdAt: '2026-08-01T00:00:00Z', number: 3 }, body: { storage: { value: '<p>Call POST /api/v1/charge to charge.</p>' } } },
};
globalThis.__site = async (kind, path, init = {}) => {
  log.push(`${init.method ?? 'GET'} ${path}`);
  if (path.startsWith('/rest/api/3/myself')) return { ok: true, status: 200, json: async () => ({ displayName: 'Dana' }) };
  if (init.method === 'PUT' && path === '/wiki/api/v2/pages/111') { puts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}) }; }
  if (init.method === 'POST' && path === '/rest/api/3/issue') { created.push(JSON.parse(init.body)); return { ok: true, status: 201, json: async () => ({ key: 'PAY-9' }) }; }
  const hit = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => path.startsWith(k));
  return hit ? { ok: true, status: 200, json: async () => structuredClone(routes[hit]) } : { ok: false, status: 404, json: async () => ({}) };
};

const { panel, validator } = await import(pathToFileURL(out).href);
const ctx = { extension: { issue: { key: 'PAY-1' } } };
const invoke = (functionKey, payload) => panel({ call: { functionKey }, payload, context: ctx });
const fail = (m) => { console.error('SMOKE FAIL:', m); process.exit(1); };

const model = await invoke('getPanel');
if (model.status !== 'findings') fail(`expected findings, got ${model.status} ${model.reason ?? model.message ?? ''}`);
const f = model.findings[0];
if (f.suggestion?.after !== 'Call POST /api/v2/charge to charge.') fail('no verified suggestion');
console.log('getPanel ok:', model.verdict, '|', f.summary, '|', f.suggestion.after);

const task = await invoke('createReviewTask', { findingId: f.id });
if (task.key !== 'PAY-9') fail('task not created');
const body = created[0];
const text = body.fields.description.content.map((n) => n.content[0].text).join('\n');
if (body.fields.project.key !== 'PAY' || !text.includes('Suggested edit')) fail('task body wrong');
console.log('createReviewTask ok:', task.key, '| project', body.fields.project.key);

const blocked = await validator({ issue: { key: 'PAY-1' } });
if (blocked.result !== false || !/api\/v1\/charge|v1/.test(blocked.errorMessage ?? '')) fail(`validator should block with evidence, got ${JSON.stringify(blocked)}`);
console.log('validator ok: BLOCKED |', blocked.errorMessage);
if ((await validator({})).result !== true) fail('validator must allow when it cannot tell which issue');
if ((await validator({ issue: { key: 'NOPE-9' } })).result !== true) fail('validator must fail open on an unreadable issue');

const applied = await invoke('applyFix', { findingId: f.id });
if (!applied.ok || puts.length !== 1) fail(`apply failed: ${applied.reason ?? 'no PUT'}`);
if (puts[0].version.number !== 4 || !puts[0].version.message.includes('approved by Dana') || puts[0].body.value !== '<p>Call POST /api/v2/charge to charge.</p>') fail('apply wrote the wrong page body');
console.log('applyFix ok: version', puts[0].version.number, '|', puts[0].version.message);
const forged = await invoke('applyFix', { findingId: 'made-up' });
if (forged.ok !== false || puts.length !== 1) fail('apply must refuse an unknown finding and write nothing');
const noReason = await invoke('triage', { findingId: f.id, kind: 'dismiss', reason: '' });
if (noReason.ok !== false) fail('dismiss without a reason must be refused');
const dismissed = await invoke('triage', { findingId: f.id, kind: 'dismiss', reason: 'historical on purpose' });
if (!dismissed.ok) fail('dismiss failed');
const after = await invoke('getPanel');
if (after.status !== 'clean' || after.hidden !== 1) fail(`dismissed finding should be hidden with a count, got ${after.status}`);
console.log('triage ok: dismissed finding hidden, count kept');
if ((await validator({ issue: { key: 'PAY-1' } })).result !== true) fail('after dismissal the validator must allow (cache cleared, live re-check clean)');
console.log('validator ok: ALLOWED after the finding was dismissed');

let threw = false;
try { await invoke('createReviewTask', { findingId: 'made-up' }); } catch { threw = true; }
if (!threw) fail('an unknown finding id must be refused');
const noKey = await panel({ call: { functionKey: 'getPanel' }, payload: {}, context: {} });
if (noKey.status !== 'error') fail('a missing issue key must be an error model');
if (log.some((l) => /undefined|\.\.|\/\//.test(l.replace('https://', '')))) fail(`suspicious request path: ${log.find((l) => /undefined|\.\./.test(l))}`);
console.log(`${log.length} fake-Atlassian calls (panel as the viewer, validator as the app). Unknown finding refused, missing key handled. SMOKE OK`);
