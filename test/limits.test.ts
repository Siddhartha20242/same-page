import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/engine.ts';
import { deriveTargetVersion, recommendSources } from '../src/adapters.ts';
import { proposeFix } from '../src/propose.ts';
import { applyToStorage } from '../src/apply.ts';
import { rankCandidates } from '../src/candidates.ts';
import { checkRelease } from '../src/release.ts';
import { createJob, runBatch, finalizeJob, withBackoff, rateLimited, worstCaseRequests } from '../src/job.ts';
import { appendFinding, verifyChain, compactChain, entryBytes } from '../src/ledger.ts';
import { appendToStore, verifyStored, compactStored, headOf, verifyAnchorStored } from '../src/ledgerStore.ts';
import { releaseRecord } from '../src/release.ts';
import type { Finding, Issue, Page, WorkItem } from '../src/types.ts';
import type { Job, JobDeps } from '../src/job.ts';
import type { Report } from '../src/release.ts';
import type { LedgerEntry } from '../src/ledger.ts';
import { fingerprint, dismiss, snooze, applyTriage, ruleNoise } from '../src/triage.ts';

const OLD = '2026-08-01T00:00:00Z';
const NEW = '2026-10-01T00:00:00Z';
const wi = (o: Partial<WorkItem> = {}): WorkItem => ({ key: 'PAY-1', status: 'In Progress', apiVersion: 'v2', statusChangedAt: NEW, requiredFields: [], fields: {}, ...o });
const pg = (text: string, o: Partial<Page> = {}): Page => ({ id: 'p1', title: 'Runbook', text, modifiedAt: OLD, labels: [], ...o });
const r1 = (text: string, w: WorkItem = wi()): Finding | undefined => check({ workItem: w, page: pg(text) }).findings.find((f) => f.ruleId === 'R1_VERSION_MISSING' || f.ruleId === 'R1_VERSION_MISMATCH');

// ===== #2 version formats =====
test('real-world formats: v2.0-beta, api/v1.1 and prerelease Fix Versions resolve; patch-0.8 is honestly skipped', () => {
  assert.equal(deriveTargetVersion({ summary: 'Ship API v2.0-beta' }), 'v2');
  assert.equal(deriveTargetVersion({ fixVersions: ['2.0-beta'] }, { sources: ['fixVersion'] }), 'v2');
  assert.equal(deriveTargetVersion({ fixVersions: ['v2.0-rc.1'] }, { sources: ['fixVersion'] }), 'v2');
  assert.equal(deriveTargetVersion({ summary: 'patch-0.8 hotfix' }), undefined);            // not an API major: unchecked, visibly
  assert.equal(r1('Call POST /api/v1.1/charge.')!.evidence.page!.line, 1);                    // api/v1.1 is read as v1
  assert.equal(r1('Targets v2.0-beta only.'), undefined);                                    // already the target
});

// ===== #10 no custom field required =====
test('components are a version source, and recommendSources tells a team what works for them', () => {
  assert.equal(deriveTargetVersion({ components: ['payments-api-v2', 'web'] }), 'v2');
  const issues = [
    { summary: 'Move to v2' }, { summary: 'Fix typo' }, { summary: 'Upgrade API v3' },
    { summary: 'x', components: ['svc-v2'] }, { summary: 'y', apiVersionField: 'v1' },
  ];
  const rec = recommendSources(issues);
  assert.equal(rec.rows.find((r) => r.source === 'summary')!.count, 2);
  assert.equal(rec.rows.find((r) => r.source === 'field')!.count, 1);
  assert.ok(rec.suggested.includes('summary'));
  assert.ok(!rec.suggested.includes('fixVersion'), 'Fix Version is never auto-suggested');
});

// ===== #4 context =====
test('"migrating away from v1 to support v2" is not flagged: the page states the target', () => {
  assert.equal(r1('We are migrating away from v1 to support v2 on this ticket.'), undefined);
});
test('migrating away from v1 alone becomes a note, not a blocker', () => {
  assert.equal(r1('We are migrating away from v1.')!.severity, 'info');
  assert.equal(r1('v1 has been sunset and is no longer supported.')!.severity, 'info');
  assert.equal(r1('The v1 endpoints were retired last year.')!.severity, 'info');
});

// ===== #8 rewrite safety =====
test('a comparison page that mentions the target version is never flagged or rewritten', async () => {
  const text = 'Version comparison\nv1: old auth\nv2: new auth';
  assert.equal(check({ workItem: wi(), page: pg(text) }).findings.length, 0);
});
test('a line mixing several different stale versions is not rewritten mechanically', async () => {
  const p = pg('Clients on v1 and v0 differ in auth.');
  const finding = check({ workItem: wi(), page: p }).findings[0];
  const out = await proposeFix({ finding, page: p, workItem: wi() });
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /ambiguous/);
});
test('applying refuses a table cell that appears twice instead of editing the wrong one', () => {
  const html = '<table><tr><td>Use v1</td><td>Use v1</td></tr></table>';
  assert.equal(applyToStorage(html, 'Use v1', 'Use v2').ok, false);
});

// ===== #7 cross-space and cross-project documentation =====
test('a pinned runbook in another space is found even with no link, label or title match', () => {
  const issue = { key: 'PAY-1', summary: 'Rework settlement', components: ['ledger-svc'] };
  const pages = [
    { id: '9', title: 'Totally different title', text: '', labels: [] },
    { id: '5', title: 'Notes', text: '', labels: ['ledger-svc'] },
    { id: '7', title: 'Meeting notes', text: '', labels: [] },
  ];
  assert.deepEqual(rankCandidates(issue, pages, { pinnedIds: ['9'] }).map((c) => c.page.id), ['9', '5']);
  assert.match(rankCandidates(issue, pages, { pinnedIds: ['9'] })[0].reasons[0], /pinned/);
});
test('a page the viewer cannot read is reported as unchecked, not as clean', async () => {
  const issue = { key: 'PAY-1', summary: 'Move payments to v2', requiredFields: [], fields: {} } as unknown as Issue;   // partial issue on purpose
  const r = await checkRelease({
    issues: [issue],
    getTransition: async () => ({ at: NEW, by: 'd' }),
    getRemoteLinkIds: async () => ['p1'],
    searchPages: async () => [pg('', { id: 'p1' })],
    getPageBody: async () => null,                       // restricted space: no permission
  });
  assert.equal(r.items[0].status, 'unchecked');
  assert.match(r.items[0]!.reason as string, /not readable/);
  assert.equal(r.complete, false);
});

// ===== #1 / #3 batching, budgets, rate limits, page cache =====
function release(n: number) {
  const issues = Array.from({ length: n }, (_, i) => ({ key: `P-${i}`, summary: `Move svc ${i} to v2`, status: 'In Progress', requiredFields: [], fields: {} }) as unknown as Issue);
  let bodyCalls = 0, calls = 0;
  const deps: JobDeps = {
    loadIssue: async (k: string) => { calls++; return issues.find((i) => i.key === k) as Issue; },
    getTransition: async () => { calls++; return { at: NEW, by: 'd' }; },
    getRemoteLinkIds: async () => { calls++; return ['shared']; },                        // every issue links the same runbook
    searchPages: async () => { calls++; return [pg('', { id: 'shared' })]; },
    getPageBody: async () => { bodyCalls++; calls++; return 'Call /api/v1/charge.'; },
  };
  return { issues, deps, stats: () => ({ bodyCalls, calls }) };
}

test('a 50-issue release finishes across batches, each within its request budget', async () => {
  const { issues, deps } = release(50);
  let job = createJob(issues.map((i) => i.key));
  let batches = 0;
  for (let done = false; !done;) {
    const out = await runBatch(job, deps, { maxRequests: 30 });
    assert.ok(out.requests <= 30, `batch used ${out.requests} requests`);
    assert.ok(out.job.pending.length < job.pending.length || out.done, 'every batch makes progress');
    job = out.job; done = out.done; batches++;
  }
  assert.ok(batches > 1);
  const report = finalizeJob(job);
  assert.equal(report.coverage.checked, 50);
  assert.equal(report.counts.blockers, 50);
});

test('the shared runbook is fetched once per batch, not once per issue', async () => {
  const { issues, deps, stats } = release(10);
  const out = await runBatch(createJob(issues.map((i) => i.key)), deps, { maxRequests: 1000 });
  assert.equal(out.done, true);
  assert.equal(stats().bodyCalls, 1);
});

test('the time budget stops a batch and the rest is picked up next time', async () => {
  const { issues, deps } = release(10);
  let t = 0;
  const first = await runBatch(createJob(issues.map((i) => i.key)), { ...deps, getTransition: async () => { t += 10; return { at: NEW, by: 'd' }; } }, { maxMs: 25, maxRequests: 1000, now: () => t });
  assert.equal(first.done, false);
  assert.ok(first.job.items.length > 0 && first.job.pending.length > 0);
  const rest = await runBatch(first.job, deps, { maxRequests: 1000 });
  assert.equal(rest.done, true);
  assert.equal(finalizeJob(rest.job).coverage.checked, 10);
});

test('a 429 stops the batch for a later retry instead of failing the release check', async () => {
  const { issues, deps } = release(6);
  let n = 0;
  const flaky = { ...deps, getTransition: async () => { if (++n === 3) { throw Object.assign(new Error('rate limited'), { status: 429, retryAfter: 30 }); } return { at: NEW, by: 'd' }; } };
  const out = await runBatch(createJob(issues.map((i) => i.key)), flaky, { maxRequests: 1000 });
  assert.equal(out.done, false);
  assert.equal(out.job.retryAfterSec, 30);
  assert.equal(out.job.items.length, 2);
  assert.equal(out.job.pending[0], 'P-2', 'the rate-limited issue is retried, not skipped');
});

test('an unexpected error on one issue marks it unchecked and the run continues', async () => {
  const { issues, deps } = release(3);
  const bad = { ...deps, getTransition: async () => { throw new Error('boom'); } };
  const out = await runBatch(createJob(issues.map((i) => i.key)), bad, { maxRequests: 1000 });
  assert.equal(out.done, true);
  assert.ok(out.job.items.every((i) => i.status === 'unchecked' && /boom/.test(i.reason as string)));
});

test('abandoning a job lists what was never reached as unchecked', () => {
  const report = finalizeJob({ pending: ['A-1', 'A-2'], items: [], batches: 1 } as unknown as Job, { abandon: true });   // retryAfterSec omitted on purpose
  assert.equal(report.coverage.checked, 0);
  assert.match(report.items[0]!.reason as string, /not reached/);
});

test('withBackoff honours Retry-After and gives up after the retry limit', async () => {
  const waits: number[] = [];
  let n = 0;
  const v = await withBackoff(async () => { if (++n < 3) { throw Object.assign(new Error('429'), { status: 429, retryAfter: 2 }); } return 'ok'; }, { sleep: async (ms) => waits.push(ms) });
  assert.equal(v, 'ok');
  assert.deepEqual(waits, [2000, 2000]);
  await assert.rejects(withBackoff(async () => { throw Object.assign(new Error('429'), { status: 429 }); }, { retries: 2, sleep: async () => {} }), /429/);
  await assert.rejects(withBackoff(async () => { throw new Error('500'); }, { sleep: async () => {} }), /500/);   // not retried
  assert.equal(await rateLimited({ f: async () => 1 }, { sleep: async () => {} }).f(), 1);
  assert.equal(worstCaseRequests(5), 14);
});

// ===== #5 storage =====
function fakeKv(limitBytes = 240 * 1024) {
  const m = new Map<string, unknown>();
  return {
    m,
    get: async (k: string) => (m.has(k) ? structuredClone(m.get(k)) : undefined),
    set: async (k: string, v: unknown) => { if (Buffer.byteLength(JSON.stringify(v)) > limitBytes) throw new Error(`value over ${limitBytes} bytes`); m.set(k, structuredClone(v)); },
  };
}
const finding = (i: number) => check({ workItem: wi({ key: `P-${i}` }), page: pg(`Use v1 client ${i}.`) }).findings[0];

test('one entry per key keeps every value tiny, where one big array would blow the 240 KiB value limit', async () => {
  const kv = fakeKv();
  let chain: LedgerEntry[] = [];
  for (let i = 0; i < 1000; i++) { await appendToStore(kv, finding(i), () => '2026-10-01T00:00:00Z'); chain = appendFinding(chain, finding(i), () => '2026-10-01T00:00:00Z'); }
  assert.ok(Buffer.byteLength(JSON.stringify(chain)) > 240 * 1024, 'a single-array design would have failed');
  assert.deepEqual(await verifyStored(kv), { ok: true, length: 1000, head: (await headOf(kv)).head });
  assert.ok(entryBytes(chain[0]) < 2048);
});

test('compaction drops stored evidence text but the chain and its anchor still verify', async () => {
  const kv = fakeKv();
  for (let i = 0; i < 30; i++) await appendToStore(kv, finding(i), () => '2026-10-01T00:00:00Z');
  const head = await headOf(kv);
  const record = { ledgerLength: head.length, ledgerHead: head.head };
  const before = Buffer.byteLength(JSON.stringify(await kv.get('ledger:e:0')));
  await compactStored(kv, { from: 0, to: 24 });
  assert.ok(Buffer.byteLength(JSON.stringify(await kv.get('ledger:e:0'))) < before);
  assert.equal((await verifyStored(kv)).ok, true);
  assert.deepEqual(await verifyAnchorStored(kv, record), { ok: true });
  await appendToStore(kv, finding(99));                                                   // history only grew
  assert.deepEqual(await verifyAnchorStored(kv, record), { ok: true });
});

test('tampering is still caught after compaction, in the remaining evidence and in the links', async () => {
  const kv = fakeKv();
  for (let i = 0; i < 10; i++) await appendToStore(kv, finding(i), () => '2026-10-01T00:00:00Z');
  await compactStored(kv, { from: 0, to: 4 });
  const e = (await kv.get('ledger:e:7')) as LedgerEntry; e.evidence!.page!.snippet = 'edited'; kv.m.set('ledger:e:7', e);
  assert.match(((await verifyStored(kv)) as { reason: string }).reason, /evidence was altered/);
  const kv2 = fakeKv();
  for (let i = 0; i < 10; i++) await appendToStore(kv2, finding(i), () => '2026-10-01T00:00:00Z');
  await compactStored(kv2, { from: 0, to: 4 });
  const c = (await kv2.get('ledger:e:2')) as LedgerEntry; c.ruleId = 'R3_MISSING_REQUIRED_FIELD'; kv2.m.set('ledger:e:2', c);
  assert.equal((await verifyStored(kv2)).ok, false);
});

test('compactChain keeps the newest entries whole and the release record still verifies', () => {
  let chain: LedgerEntry[] = [];
  for (let i = 0; i < 6; i++) chain = appendFinding(chain, finding(i), () => '2026-10-01T00:00:00Z');
  const small = compactChain(chain, { keepLast: 2 });
  assert.equal(small.filter((e) => e.evidence === undefined).length, 4);
  assert.equal(verifyChain(small).ok, true);
  assert.equal(releaseRecord({ version: '2.0', report: { verdict: 'X', coverage: { checked: 0, total: 0 }, counts: { findings: 0 } } as unknown as Report, chain: small }).ledgerLength, 6);   // minimal report fixture
});

// ===== #9 alert fatigue =====
test('a dismissal needs a reason, holds while the evidence is unchanged, and lapses when the evidence changes', () => {
  const f = finding(1);
  assert.throws(() => dismiss({}, f, '  ', 'dana'), /reason is required/);
  const records = dismiss({}, f, 'v1 shim is intentional here', 'dana');
  assert.equal(applyTriage([f], records)[0].triage, 'dismissed');
  const changed = { ...f, evidence: { ...f.evidence, page: { ...f.evidence.page, snippet: 'Use v1 client, now with new text.' } } };
  assert.notEqual(fingerprint(f), fingerprint(changed));
  assert.equal(applyTriage([changed], records)[0].triage, 'open');
});

test('a snooze expires on its own', () => {
  const f = finding(2);
  const records = snooze({}, f, '2026-11-15T00:00:00Z', 'dana');
  assert.equal(applyTriage([f], records, () => Date.parse('2026-11-01T00:00:00Z'))[0].triage, 'snoozed');
  const later = applyTriage([f], records, () => Date.parse('2026-11-16T00:00:00Z'))[0];
  assert.equal(later.triage, 'open');
  assert.match((later as { note: string }).note, /expired/);
  assert.throws(() => snooze({}, f, 'soon', 'dana'), /valid end date/);
});

test('a rule that people mostly dismiss is flagged as noisy, but only with enough samples', () => {
  const history = [
    ...Array(6).fill({ ruleId: 'R1_VERSION_MISMATCH', outcome: 'dismissed' }), ...Array(2).fill({ ruleId: 'R1_VERSION_MISMATCH', outcome: 'acted' }),
    ...Array(2).fill({ ruleId: 'R3_MISSING_REQUIRED_FIELD', outcome: 'dismissed' }),
  ];
  const noise = Object.fromEntries(ruleNoise(history).map((r) => [r.ruleId, r]));
  assert.equal(noise.R1_VERSION_MISMATCH.noisy, true);
  assert.equal(noise.R3_MISSING_REQUIRED_FIELD.noisy, false);                              // only 2 samples: no verdict yet
});
