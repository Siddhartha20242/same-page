import test from 'node:test';
import assert from 'node:assert/strict';
import { addCustomRule, compileRule, deleteCustomRule, loadCustomRules, loadCustomDefs, previewRule, validateCustomRule, MAX_CUSTOM_RULES } from '../src/customRules.ts';
import { check } from '../src/engine.ts';
import { BUILT_IN_RULES } from '../src/rules.ts';
import { buildPanelModel } from '../src/panelModel.ts';
import { createDeps } from '../src/atlassianDeps.ts';
import { ruleLabel } from '../src/ruleCatalog.ts';
import type { Pair } from '../src/types.ts';

const mem = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); } }; };
const pair = (status: string, text: string, extra: Record<string, unknown> = {}): Pair => ({ workItem: { key: 'PAY-1', status, ...extra } as never, page: { id: '9', title: 'Runbook', text, modifiedAt: '2026-01-01T00:00:00Z' } });
const run = (def: Parameters<typeof compileRule>[0], p: Pair) => compileRule(def).run(p);

test('template 1: a page says a phrase while the status is (or is not) a value', () => {
  const def = { id: 'C1_CUSTOM', name: 'Ready too early', template: 'phrase-while-status' as const, phrase: 'ready for production', value: 'Done', severity: 'warn' as const };
  assert.equal(run(def, pair('Done', 'This is ready for production.')).length, 1);
  assert.equal(run(def, pair('In Progress', 'This is ready for production.')).length, 0);
  const not = { ...def, value: '!Done' };
  assert.equal(run(not, pair('In Progress', 'Service is READY FOR PRODUCTION today')).length, 1);     // case-insensitive
  assert.equal(run(not, pair('Done', 'Service is ready for production')).length, 0);
  const f = run(not, pair('In Progress', 'a\nService is ready for production'))[0]!;
  assert.equal(f.evidence.page?.line, 2);
  assert.match(f.summary, /Custom rule "Ready too early": page says "ready for production" while PAY-1 is In Progress/);
});

test('template 2: a phrase while the work item has a label or component, and template 3: a label that needs a phrase', () => {
  const t2 = { id: 'C2_CUSTOM', name: 'Old host', template: 'phrase-with-label' as const, phrase: 'old-host.internal', value: 'migrated', severity: 'block' as const };
  assert.equal(run(t2, pair('Done', 'ssh old-host.internal', { labels: ['Migrated'] })).length, 1);
  assert.equal(run(t2, pair('Done', 'ssh old-host.internal', { labels: ['other'] })).length, 0);
  assert.equal(run(t2, pair('Done', 'ssh old-host.internal', { components: ['migrated'] }))[0]!.severity, 'block');
  const t3 = { id: 'C3_CUSTOM', name: 'Payments need rollback', template: 'label-needs-phrase' as const, phrase: 'rollback', value: 'payments', severity: 'warn' as const };
  assert.equal(run(t3, pair('Done', 'Deploy steps only', { labels: ['payments'] })).length, 1);
  assert.equal(run(t3, pair('Done', 'Rollback: revert the release', { labels: ['payments'] })).length, 0);
  assert.equal(run(t3, pair('Done', 'Deploy steps only', { labels: ['other'] })).length, 0);
});

test('history wording is skipped, and a phrase is plain text, never a pattern', () => {
  const def = { id: 'C1_CUSTOM', name: 'Dots', template: 'phrase-while-status' as const, phrase: 'a.b(c', value: '!Never', severity: 'warn' as const };
  assert.equal(run(def, pair('Done', 'call a.b(c now')).length, 1);
  assert.equal(run(def, pair('Done', 'axb(c')).length, 0);
  const hist = { ...def, phrase: 'legacy queue' };
  assert.equal(run(hist, pair('Done', 'previously used the legacy queue')).length, 0);
});

test('input is checked: template, lengths, the ! rule, and control characters are stripped', () => {
  assert.equal(validateCustomRule({ name: 'ab', template: 'phrase-while-status', phrase: 'abc', value: 'Done' }).ok, false);
  assert.equal(validateCustomRule({ name: 'Name', template: 'nope', phrase: 'abc', value: 'Done' }).ok, false);
  assert.equal(validateCustomRule({ name: 'Name', template: 'phrase-while-status', phrase: 'ab', value: 'Done' }).ok, false);
  assert.equal(validateCustomRule({ name: 'Name', template: 'phrase-with-label', phrase: 'abc', value: '!x' }).ok, false);
  const ok = validateCustomRule({ name: ' Na<b>me\n', template: 'phrase-while-status', phrase: 'a`bc', value: '!Done', severity: 'block' });
  assert.ok(ok.ok);
  if (ok.ok) { assert.equal(ok.def.name, 'Na b me'); assert.equal(ok.def.phrase, 'a bc'); assert.equal(ok.def.severity, 'block'); }
});

test('rules are saved with stable ids, capped at ten, deletable, and ignored if the stored data is damaged', async () => {
  const s = mem();
  const a = await addCustomRule(s, { name: 'Rule one', template: 'phrase-while-status', phrase: 'foo bar', value: 'Done' });
  const b = await addCustomRule(s, { name: 'Rule two', template: 'phrase-while-status', phrase: 'baz qux', value: 'Done' });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.deepEqual([a.def.id, b.def.id], ['C1_CUSTOM', 'C2_CUSTOM']);
  assert.equal((await deleteCustomRule(s, 'C1_CUSTOM')).ok, true);
  const c = await addCustomRule(s, { name: 'Rule three', template: 'phrase-while-status', phrase: 'zip zap', value: 'Done' });
  assert.ok(c.ok && c.def.id === 'C3_CUSTOM');                                    // ids are never reused
  for (let i = 0; i < MAX_CUSTOM_RULES; i++) await addCustomRule(s, { name: `Filler ${i}`, template: 'phrase-while-status', phrase: `filler ${i}`, value: 'Done' });
  assert.equal((await loadCustomDefs(s)).length, MAX_CUSTOM_RULES);
  assert.equal((await addCustomRule(s, { name: 'One more', template: 'phrase-while-status', phrase: 'one more', value: 'Done' })).ok, false);
  await s.set('rules:custom', { rules: [{ id: 'x', name: 1 }, 'junk'], next: 'bad' });
  assert.deepEqual(await loadCustomRules(s), []);
});

test('a custom rule runs next to the built-in rules and shows in the panel, and the preview never saves anything', async () => {
  const j = (v: unknown) => ({ ok: true, status: 200, json: async () => v });
  const route = (path: string) => {
    if (path.startsWith('/rest/api/3/issue/PAY-1?')) return j({ key: 'PAY-1', fields: { summary: 'Checkout', status: { name: 'In Progress' }, components: [], fixVersions: [], labels: ['payments'] } });
    if (path.startsWith('/rest/api/3/issue/PAY-1/changelog')) return j({ total: 1, values: [{ created: '2026-10-01T00:00:00Z', author: { displayName: 'Sam' }, items: [{ field: 'status' }] }] });
    if (path.startsWith('/rest/api/3/issue/PAY-1/remotelink')) return j([{ object: { url: 'https://acme.atlassian.net/wiki/spaces/E/pages/111/Runbook' } }]);
    if (path.startsWith('/wiki/api/v2/pages/111/labels')) return j({ results: [] });
    if (path.startsWith('/wiki/api/v2/pages/111')) return j({ id: '111', title: 'Checkout runbook', version: { createdAt: '2026-08-01T00:00:00Z' }, body: { storage: { value: '<p>Deploy steps only.</p>' } } });
    if (path.startsWith('/wiki/rest/api/search')) return j({ results: [] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const deps = createDeps({ requestJira: async (p: string) => route(p) as never, requestConfluence: async (p: string) => route(p) as never });
  const store = mem();
  assert.equal((await buildPanelModel('PAY-1', deps)).status, 'clean');                       // built-in rules alone: nothing
  const prev = previewRule({ name: 'Payments need rollback', template: 'label-needs-phrase', phrase: 'rollback', value: 'payments' });
  assert.ok(prev.ok);
  if (!prev.ok) return;
  const m = await buildPanelModel('PAY-1', { ...deps, rules: [prev.rule] });
  assert.equal(m.status, 'findings');
  assert.equal((await loadCustomDefs(store)).length, 0);                                       // previewing saved nothing
  await addCustomRule(store, { name: 'Payments need rollback', template: 'label-needs-phrase', phrase: 'rollback', value: 'payments' });
  const withBoth = await buildPanelModel('PAY-1', { ...deps, rules: [...BUILT_IN_RULES, ...(await loadCustomRules(store))] });
  assert.equal(withBoth.status, 'findings');
  if (withBoth.status === 'findings') assert.equal(withBoth.findings[0]!.ruleId, 'C1_CUSTOM');
  assert.equal(ruleLabel('C1_CUSTOM'), 'Custom rule');
  assert.equal(check(pair('Done', 'x')).findings.length, 0);
});

import { formatBlockMessage, evidenceId } from '../src/gate.ts';
test('the gate refusal carries the same short evidence id the panel shows, even when the page is hidden', () => {
  const b = { id: 'a3f2c1d9e0b1c2d3e4f5', ruleId: 'R1_VERSION_MISMATCH', summary: 'Page documents v1', pageId: '9', pageTitle: 'Runbook', docLine: 'POST /api/v1/charge' };
  assert.equal(evidenceId(b), 'a3f2c1d9');
  assert.match(formatBlockMessage('PAY-1', [b]), /Rule: R1 Stale version · evidence #a3f2c1d9\. Page documents v1/);
  const hidden = formatBlockMessage('PAY-1', [{ ...b, hidden: true }]);
  assert.match(hidden, /evidence #a3f2c1d9/);
  assert.doesNotMatch(hidden, /Runbook|POST/);
});
