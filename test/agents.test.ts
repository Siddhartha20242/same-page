import test from 'node:test';
import assert from 'node:assert/strict';
import { findingHistory, ruleHealth, impactSummary } from '../src/tools.ts';
import { recordHandling } from '../src/handling.ts';
import { recordOutcome } from '../src/triage.ts';
import { saveSeverity } from '../src/ruleCatalog.ts';
import { addCustomRule } from '../src/customRules.ts';
import { bump } from '../src/metrics.ts';
import { loadImpact, setMinutesPerFix } from '../src/impact.ts';

const mem = () => { const m = new Map<string, unknown>(); return { m, get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };

test('finding history lists the events for one work item, without account ids, and says so when there are none', async () => {
  const s = mem();
  await recordHandling(s, { event: 'DISCOVERED', ruleId: 'R1_VERSION_MISMATCH', issueKey: 'PAY-1', pageId: '9' });
  await recordHandling(s, { event: 'DISMISSED', ruleId: 'R1_VERSION_MISMATCH', issueKey: 'PAY-1', pageId: '9', note: 'reason: intentional rollback section', by: 'acct-123' });
  await recordHandling(s, { event: 'DISCOVERED', ruleId: 'R4_STATUS_CLAIM_STALE', issueKey: 'PAY-2' });
  const r = await findingHistory({ issueKey: 'PAY-1' }, s as never) as { status: string; events: { rule: string; event: string; note: string }[] };
  assert.equal(r.status, 'found');
  assert.deepEqual(r.events.map((e) => `${e.rule}:${e.event}`), ['R1_VERSION_MISMATCH:DISCOVERED', 'R1_VERSION_MISMATCH:DISMISSED']);
  assert.match(r.events[1]!.note, /intentional rollback section/);
  assert.doesNotMatch(JSON.stringify(r), /acct-123/);
  assert.equal((await findingHistory({ issueKey: 'PAY-9' }, s as never) as { status: string }).status, 'none');
  assert.ok((await findingHistory({ issueKey: 'nope' }, s as never) as { error?: string }).error);
});

test('rule health shows severity changes, handling counts, noisy hints and custom rules', async () => {
  const s = mem();
  await saveSeverity(s, 'R4_STATUS_CLAIM_STALE', 'block');
  for (let i = 0; i < 4; i++) await recordOutcome(s, 'R1_VERSION_MISMATCH', 'dismissed');
  await recordOutcome(s, 'R1_VERSION_MISMATCH', 'acted');
  await addCustomRule(s, { name: 'Ready too early', template: 'phrase-while-status', phrase: 'ready for production', value: '!Done' });
  const r = await ruleHealth(s as never) as { rules: { id: string; severity: string; changedOnThisSite: boolean; dismissedPercent: number | null; looksNoisy: boolean }[]; customRules: { id: string; name: string }[] };
  const r1 = r.rules.find((x) => x.id === 'R1')!;
  assert.deepEqual([r1.dismissedPercent, r1.looksNoisy], [80, true]);
  assert.deepEqual([r.rules.find((x) => x.id === 'R4')!.severity, r.rules.find((x) => x.id === 'R4')!.changedOnThisSite], ['block', true]);
  assert.equal(r.rules.find((x) => x.id === 'R2')!.dismissedPercent, null);
  assert.equal(r.customRules[0]!.name, 'Ready too early');
  assert.equal(r.rules.length, 10);
});

test('impact: counts always, an hours figure only after an administrator sets minutes per fix', async () => {
  const s = mem();
  await bump(s, 'applied', 6); await bump(s, 'dismissed', 2); await bump(s, 'gateBlocks', 1);
  const none = await loadImpact(s);
  assert.equal(none.estimatedHoursSaved, null);
  assert.match(none.line, /6 fixed on the page · 0 sent to a page owner · 2 dismissed · 1 transition refused/);
  assert.match((await impactSummary(s as never) as { note: string }).note, /do not guess/);
  assert.equal((await setMinutesPerFix(s, '15')).ok, true);
  const set = await loadImpact(s);
  assert.equal(set.estimatedHoursSaved, 1.5);                          // 6 fixes x 15 minutes
  assert.equal((await setMinutesPerFix(s, '999')).ok, false);
  assert.equal((await setMinutesPerFix(s, 'abc')).ok, false);
  await setMinutesPerFix(s, '0');
  assert.equal((await loadImpact(s)).estimatedHoursSaved, null);       // 0 clears it
});

import { projectBrief } from '../src/tools.ts';
test('the project brief covers a full list of 20 items instead of stopping at the overview budget', async () => {
  const keys = Array.from({ length: 20 }, (_, i) => `PAY-${i + 1}`);
  const deps = {
    searchIssues: async () => keys.map((key) => ({ key, summary: key })),
    loadIssue: async (k: string) => ({ key: k, summary: 'Token expiry', status: 'In Progress', components: [], fixVersions: [], labels: [], requiredFields: [], fields: {} }),
    getTransition: async () => ({ at: '2026-10-01T00:00:00Z', by: 'Sam' }),
    getRemoteLinkIds: async () => [],
    searchPages: async () => [],
  };
  const r = await projectBrief({ projectKey: 'PAY' }, deps as never) as { items: { reasonNotChecked?: string }[]; status: string };
  assert.equal(r.status, 'scan complete');
  assert.equal(r.items.length, 20);
  assert.equal(r.items.filter((i) => /not reached/.test(i.reasonNotChecked ?? '')).length, 0);
});
