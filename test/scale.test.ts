import test from 'node:test';
import assert from 'node:assert/strict';
import { storageToText } from '../src/adapters.ts';
import { check } from '../src/engine.ts';
import { extractOpenApi } from '../src/spec.ts';
import { checkRelease } from '../src/release.ts';
import { BUILT_IN_RULES } from '../src/rules.ts';
import type { Issue } from '../src/types.ts';

// Size and shape limits, measured on this machine with generous ceilings. They exist to catch an accidental O(n^2) or a catastrophic
// regular expression, not to claim a benchmark. Real Forge latency and rate limits are separate (see docs/live-results.md).

const timed = <T>(fn: () => T): { out: T; ms: number } => { const t = performance.now(); const out = fn(); return { out, ms: performance.now() - t }; };

test('a 3 MB page (50,000 lines, tables and code) is converted and checked in well under 2 seconds', () => {
  const row = '<tr><td>1</td><td>POST /api/v1/charge with the <strong>order</strong> id &amp; retry</td></tr>';
  const html = '<table><tbody>' + row.repeat(15000) + '</tbody></table>' + '<p>Some prose about the system and its history.</p>'.repeat(20000);
  assert.ok(html.length > 2_000_000, `fixture too small: ${html.length}`);
  const { out: text, ms: convertMs } = timed(() => storageToText(html));
  const { out: result, ms: checkMs } = timed(() => check({ workItem: { key: 'PAY-1', apiVersion: 'v2', status: 'In Progress', statusChangedAt: '2026-11-02T00:00:00Z' } as never, page: { id: '1', title: 'Big', text, modifiedAt: '2026-10-01T00:00:00Z', labels: [] }, siblings: [] }, BUILT_IN_RULES));
  assert.ok(result.findings.length >= 1);
  assert.ok(convertMs < 2000, `storageToText took ${convertMs.toFixed(0)} ms`);
  assert.ok(checkMs < 2000, `check took ${checkMs.toFixed(0)} ms`);
});

test('pathological text does not hang the rules (long runs of version-like characters, no newlines)', () => {
  const nasty = 'v1'.repeat(200_000) + ' ' + 'version 1 '.repeat(50_000) + 'POST /' + 'a/'.repeat(50_000);
  const { ms } = timed(() => check({ workItem: { key: 'PAY-1', apiVersion: 'v2', status: 'In Progress', statusChangedAt: '2026-11-02T00:00:00Z' } as never, page: { id: '1', title: 'x', text: nasty, modifiedAt: '2026-10-01T00:00:00Z', labels: [] }, siblings: [] }, BUILT_IN_RULES));
  assert.ok(ms < 3000, `took ${ms.toFixed(0)} ms`);
});

test('a spec with 5,000 operations is read once and a 5,000-line doc is judged against it quickly', () => {
  const paths: Record<string, unknown> = {};
  for (let i = 0; i < 5000; i++) paths[`/resource${i}/{id}`] = { get: {}, post: { deprecated: i % 7 === 0 } };
  const specText = JSON.stringify({ openapi: '3.0.3', info: { title: 'Big' }, paths }, null, 1);
  const { out: spec, ms: readMs } = timed(() => extractOpenApi(`Intro\n${specText}\nOutro`));
  assert.equal(spec?.operations.length, 10000);
  assert.ok(readMs < 2000, `spec read took ${readMs.toFixed(0)} ms`);
  const doc = Array.from({ length: 5000 }, (_, i) => `Call POST /resource${i}/42 now`).join('\n');
  const { out, ms } = timed(() => check({ workItem: { key: 'PAY-1', apiVersion: 'v2', status: 'In Progress', statusChangedAt: '2026-11-02T00:00:00Z' } as never, page: { id: 'd', title: 'Doc', text: doc, modifiedAt: '2026-10-01T00:00:00Z', labels: [] }, siblings: [{ id: 's', title: 'Spec', text: `Intro\n${specText}`, modifiedAt: '2026-10-01T00:00:00Z', labels: [] }, { id: 'd', title: 'Doc', text: doc, modifiedAt: '2026-10-01T00:00:00Z', labels: [] }] }, BUILT_IN_RULES));
  assert.ok(out.findings.some((f) => f.ruleId === 'R5_SPEC_DISAGREES'));
  assert.ok(ms < 1000, `judging took ${ms.toFixed(0)} ms`);                 // was 4.7 s before the spec was indexed
});

test('a 200-issue release makes a bounded number of requests per issue and caches repeated pages', async () => {
  const counts = { transition: 0, links: 0, search: 0, body: 0 };
  const issues: Issue[] = Array.from({ length: 200 }, (_, i) => ({ key: `PAY-${i + 1}`, summary: 'Migrate to v2', status: 'In Progress', components: [], fixVersions: [], labels: [], requiredFields: [], fields: {} }));
  const shared = Array.from({ length: 5 }, (_, i) => ({ id: String(100 + i), title: `Shared page ${i}`, text: '', labels: [] as string[] }));
  const started = performance.now();
  const report = await checkRelease({
    issues,
    getTransition: async () => { counts.transition++; return { at: '2026-11-02T00:00:00Z', by: 'Dana' }; },
    getRemoteLinkIds: async () => { counts.links++; return []; },
    searchPages: async () => { counts.search++; return shared; },
    getPageBody: async (id) => { counts.body++; return { text: `Call POST /api/v1/charge (page ${id})`, modifiedAt: '2026-10-01T00:00:00Z', labels: [], title: `Shared page ${id}` }; },
  });
  const ms = performance.now() - started;
  assert.equal(report.coverage.total, 200);
  assert.equal(counts.transition, 200);
  assert.equal(counts.search, 200);
  assert.ok(counts.body <= 5, `page bodies are read once each and cached, not 200 x 5: got ${counts.body}`);
  assert.ok(ms < 5000, `release took ${ms.toFixed(0)} ms`);
});
