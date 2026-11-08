import Resolver from '@forge/resolver';
import api, { route, assumeTrustedRoute } from '@forge/api';
import { kvs } from '@forge/kvs';
import { createDeps, TARGET_PROPERTY } from './core/atlassianDeps';
import { buildPanelModel } from './core/panelModel';
import { buildReviewTask } from './core/reviewTask';
import { applySuggestion, triageFinding, loadTriage } from './core/panelActions';
import type { KeyValueStore } from './core/panelActions';
import { filterModelByTriage, loadNoisyRules, loadOutcomes, recordOutcome, withNoisyRules } from './core/triage';
import { seedDemo, DEMO_CANON } from './core/seed';
import { createSeedDeps } from './core/seedDeps';
import { forgeLlm } from './llm';
import { appendToStore, headOf, recentForViewer, verifyStored } from './core/ledgerStore';
import { bump, markSeen, readCounts } from './core/metrics';
import { recordHandling } from './core/handling';
import { addPin, PIN_PROPERTY, processPageUpdate } from './core/pin';
import type { Pin } from './core/pin';
import type { KV } from './core/ledgerStore';
import type { LedgerEntry } from './core/ledger';
import { decideTransition, gateKey, snapshotFromModel, cacheableFromPanel, applyGateMode, toGateMode, GATE_MODE_KEY } from './core/gate';
import type { CanView } from './core/gate';
import { runOverview, sanitizeCarried } from './core/overview';
import { runSoftGate, runChangeNudge } from './core/softGate';
import type { SoftGateEvent } from './core/softGate';
import { runDriftScan, loadDrift } from './core/drift';
import { loadImpact, setMinutesPerFix } from './core/impact';
import { markFinding, loadReviewMarks } from './core/review';
import { RULE_CATALOG, loadSeverityOverrides, saveSeverity, withSeverities } from './core/ruleCatalog';
import { BUILT_IN_RULES } from './core/rules';
import { TEMPLATES, addCustomRule, deleteCustomRule, exportRules, importRules, loadCustomDefs, loadCustomRules, previewRule } from './core/customRules';
import { tuningHint } from './core/tuning';
import { parsePageLink } from './core/linkPage';
import { loadReviewCounts } from './core/review';
import { buildPilotReport } from './core/pilotReport';
import { activeOverride, grantOverride, revokeOverride } from './core/breakGlass';
import { loadDraftCounts, recordDrafted } from './core/draft';
import { runPlayground } from './core/playground';
import { buildAuditExport } from './core/ledgerExport';
import { addCanon, checkCanon, deleteCanon, loadCanon } from './core/canon';
import { canonDeps } from './canonDeps';
import { checkPage, bylineTitle } from './core/pageCheck';
import type { PageCheck } from './core/pageCheck';

// Everything runs AS THE VIEWING USER (asUser), so Jira and Confluence permissions decide what is visible and what can be created.
// The engine under ./core is a synced copy of the tested code in the repo's ./src (scripts/sync-core.mjs).
const resolver = new Resolver();

// The rules every check runs: the ten built-in rules plus the rules this site's administrators defined.
const rulesNow = async () => [...BUILT_IN_RULES, ...(await loadCustomRules({ get: (k) => kvs.get(k), set: (k, v) => kvs.set(k, v) }))];

// Severity settings for built-in rules plus any team rule saved as a draft. Draft rules run but are hidden everywhere (see core/ruleCatalog withSeverities).
const overridesNow = async () => {
  const o = await loadSeverityOverrides(store);
  for (const d of await loadCustomDefs(store)) if (d.severity === 'draft') o[d.id] = 'draft';
  return o;
};

const makeDeps = () => createDeps({
  requestJira: (path) => api.asUser().requestJira(assumeTrustedRoute(path)),
  requestConfluence: (path) => api.asUser().requestConfluence(assumeTrustedRoute(path)),
});

// Triage records live in Forge KVS, one small record per issue.
const store: KeyValueStore = { get: (k) => kvs.get(k), set: (k, v) => kvs.set(k, v) };

// When the user has not yet allowed the app to act for them in a product, Forge throws NEEDS_AUTHENTICATION_ERR. It must NOT be caught
// and turned into a message: only an uncaught throw makes the platform show its "allow access" prompt.
const needsConsent = (e: unknown) => (e as { name?: string } | null)?.name === 'NEEDS_AUTHENTICATION_ERR';

const PAGE_ID = /^\d+$/;
const putPage = (id: string, body: unknown) => {
  if (!PAGE_ID.test(String(id))) throw new Error('not a valid page id');
  return api.asUser().requestConfluence(route`/wiki/api/v2/pages/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
};

// Pins live ON THE PAGE as a content property (see core/pin.ts): Forge storage is per installation, and Apply (Jira) and the page-updated
// event (Confluence) run in different installations, so they cannot share a storage key.
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };
// v2 properties API: the older v1 property endpoint answered the APP with HTTP 410 while answering a user normally.
type PinProp = { id?: string; value?: Pin; version?: { number?: number } };
const findPinProp = async (who: 'user' | 'app', pageId: string): Promise<PinProp | null> => {
  const res = await (who === 'user' ? api.asUser() : api.asApp()).requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties?key=${PIN_PROPERTY}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`could not read the pins (HTTP ${res.status})`);
  return ((await res.json()) as { results?: PinProp[] }).results?.[0] ?? null;
};
const readPinsAs = (who: 'user' | 'app') => async (pageId: string): Promise<Pin | null> => (PAGE_ID.test(pageId) ? (await findPinProp(who, pageId))?.value ?? null : null);
const writePin = async (pageId: string, issueKey: string) => {
  if (!PAGE_ID.test(pageId)) throw new Error('not a valid page id');
  const existing = await findPinProp('user', pageId);
  const value = addPin(existing?.value, issueKey);
  const res = existing?.id
    ? await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties/${existing.id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ key: PIN_PROPERTY, value, version: { number: (existing.version?.number ?? 1) + 1 } }) })
    : await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ key: PIN_PROPERTY, value }) });
  if (!res.ok) throw new Error(`could not pin the page (HTTP ${res.status})`);
};

/** The slice of the Forge resolver request these handlers read. */
interface Ctx { extension?: { issue?: { key?: string } }; accountId?: string; siteUrl?: string }
interface Req<P = Record<string, unknown>> { payload?: P; context?: Ctx }

const whoAmI = async (context?: Ctx): Promise<string> => {
  try { const r = await api.asUser().requestJira(route`/rest/api/3/myself`); return ((await r.json()) as { displayName?: string }).displayName ?? context?.accountId ?? 'a user'; } catch { return context?.accountId ?? 'a user'; }
};

// Gate snapshots are a cache of the latest check, so a validator click is cheap. Anything that changes the answer clears it.
// Forge storage rejects a null value, so clearing is an old, empty snapshot: the gate does not trust one older than five minutes and checks live instead.
const clearGate = async (issueKey: string) => { try { await store.set(gateKey(issueKey), { at: '1970-01-01T00:00:00.000Z', blockers: [] }); } catch { /* best effort */ } };

const issueKeyOf = (context?: Ctx) => context?.extension?.issue?.key;

resolver.define('getPanel', async ({ context }: Req) => {
  const issueKey = issueKeyOf(context);
  if (!issueKey) return { status: 'error', message: 'This panel must be opened from a Jira issue.' };
  try {
    const sev = withSeverities(await buildPanelModel(issueKey, { ...makeDeps(), rules: await rulesNow() }, { llm: forgeLlm }) as never, await overridesNow()) as { drafted?: { id: string; ruleId: string }[] };
    await recordDrafted(store, sev.drafted ?? []);          // what a draft rule would have raised, counted once; nothing is shown for it
    const model = filterModelByTriage(sev as never, await loadTriage(issueKey, store)) as never;
    const shown = model as { findings?: { id: string }[]; notes?: { id: string }[] };
    const present = [...(shown.findings ?? []), ...(shown.notes ?? [])] as { id: string; ruleId?: string; pageId?: string }[];
    await markSeen(store, present.map((f) => f.id), async (id) => {         // the first-seen event is written before the finding counts as seen
      const f = present.find((x) => x.id === id);
      return f?.ruleId ? recordHandling(store as KV, { event: 'DISCOVERED', ruleId: f.ruleId, issueKey, pageId: f.pageId }) : true;
    });
    // The panel runs with THIS viewer's permissions, so pages they cannot read are missing from the model. A snapshot with blockers is evidence and is kept for the gate; an
    // all-clear is never cached from here, because the gate trusts a fresh all-clear without re-checking (the app-scoped soft gate warms that case).
    const snap = cacheableFromPanel(snapshotFromModel(model));
    if (snap) { try { await store.set(gateKey(issueKey), snap); } catch { /* best effort */ } }
    // Marks a person made on these findings (real or false alarm), so the panel can show them. Counts only; findings are never changed by a mark.
    const lists = model as { findings?: { id: string; reviewed?: string }[]; notes?: { id: string; reviewed?: string }[] };
    const ov = await activeOverride(store, issueKey);
    (model as { override?: { until: string; reason: string } }).override = ov ? { until: ov.until, reason: ov.reason } : undefined;
    const marks = await loadReviewMarks(store, [...(lists.findings ?? []), ...(lists.notes ?? [])].map((f) => f.id));
    for (const f of [...(lists.findings ?? []), ...(lists.notes ?? [])]) if (marks[f.id]) f.reviewed = marks[f.id];
    // Dismissal learning: a calm hint only. Findings, severities and blockers are never hidden or changed because a rule is noisy.
    return withNoisyRules(model as never, await loadNoisyRules(store));
  } catch (e) {
    if (needsConsent(e)) throw e;
    // Say what happened in plain words; never show an empty panel.
    const status = (e as { status?: number } | null)?.status;
    const hint = status === 429 ? 'Atlassian is rate limiting this app. Try again in a minute.' : status === 403 ? 'You may not have permission to read something this check needs.' : 'Something went wrong while checking.';
    return { issueKey, status: 'error', message: hint };
  }
});

// The client sends only a finding id. The finding is rebuilt here, so nothing the browser sends ends up in the task.
resolver.define('createReviewTask', async ({ payload, context }: Req<{ findingId?: string }>) => {
  const issueKey = issueKeyOf(context) as string;
  const model = await buildPanelModel(issueKey, { ...makeDeps(), rules: await rulesNow() }, { llm: forgeLlm });
  const lists = model as { findings?: { id: string }[]; notes?: { id: string }[] };
  const finding = [...(lists.findings ?? []), ...(lists.notes ?? [])].find((f) => f.id === payload?.findingId);
  if (!finding) throw new Error('That finding is no longer present. Refresh the panel.');
  const res = await api.asUser().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(buildReviewTask({ issueKey, finding: finding as Parameters<typeof buildReviewTask>[0]['finding'] })),
  });
  if (!res.ok) throw new Error(`Jira did not create the task (HTTP ${res.status}).`);
  await bump(store, 'reviewTasks');
  await recordOutcome(store, (finding as { ruleId?: string }).ruleId, 'acted');
  const taskKey = ((await res.json()) as { key: string }).key;
  await recordHandling(store as KV, { event: 'REVIEW_TASK', ruleId: (finding as { ruleId?: string }).ruleId ?? 'UNKNOWN', issueKey, pageId: (finding as { pageId?: string }).pageId, note: `task ${taskKey}`, by: context?.accountId });
  return { key: taskKey };
});

// Apply: a human clicked. The edit is rebuilt and re-verified here; the write runs as that user and becomes a revertible page version.
resolver.define('applyFix', async ({ payload, context }: Req<{ findingId?: string; expectedAfter?: string }>) => {
  const issueKey = issueKeyOf(context) as string;
  const deps = { ...makeDeps(), rules: await rulesNow() };
  const out = await applySuggestion({ issueKey, findingId: payload?.findingId, expectedAfter: payload?.expectedAfter, approver: await whoAmI(context) }, {
    buildModel: (k) => buildPanelModel(k, deps, { llm: forgeLlm }), getPageSource: (id) => deps.getPageSource(id), putPage,
  });
  if (!out.ok) return out;
  await clearGate(issueKey);
  await bump(store, 'applied');
  await recordOutcome(store, out.ruleId, 'acted');
  // Seal the applied fix into the tamper-evident chain and anchor its hash on the Jira issue. Best effort: the page edit already happened,
  // so a storage hiccup must not turn a successful Apply into an error.
  try {
    const entry = await appendToStore(store as KV, {
      ruleId: `${out.ruleId}:APPLIED`,
      evidence: { page: { id: out.pageId, line: out.line, snippet: `${out.before} -> ${out.after}`, modifiedAt: new Date().toISOString() }, workItem: { key: issueKey } },
    });
    const anchor = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/properties/same-page.lastReceipt`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ seq: entry.seq, entryHash: entry.entryHash, at: entry.at, ruleId: entry.ruleId }),
    });
    const anchored = anchor.ok;                                                                       // a person without edit rights on the issue gets a 403 here
    if (!anchored) console.log(`same-page ledger: the receipt was sealed but not anchored on ${issueKey} (HTTP ${anchor.status})`);
    try { await writePin(out.pageId, issueKey); }                                                    // pin guard: watch this page for a regression
    catch (e) { console.log(`same-page pin: ${e instanceof Error ? e.message : String(e)}`); }
    return { ...out, receipt: entry, anchored };
  } catch (e) {
    console.log(`same-page ledger: could not seal the applied fix: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }
});

// The audit trail the panel shows: chain status, length, and the last three entries. Verifying reads every entry once (paged), so it runs on request.
resolver.define('ledgerView', async ({ context }: Req) => {
  const { length, head } = await headOf(store as KV);
  const verified = await verifyStored(store as KV);
  // Entries name work items, so a viewer sees the entries for the work item they are on; only a Jira administrator sees the latest site-wide. The chain's length, head and counts are hashes and totals.
  const from = Math.max(0, length - 60);
  const [admin, raw] = await Promise.all([isJiraAdmin(), Promise.all(Array.from({ length: length - from }, (_, k) => kvs.get(`ledger:e:${from + k}`)))]);
  const recent = recentForViewer(raw as (LedgerEntry | undefined)[], { admin, current: issueKeyOf(context) }).map((e) => ({ seq: e.seq, at: e.at, ruleId: e.ruleId, issueKey: e.issueKey, entryHash: e.entryHash.slice(0, 12), prevHash: e.prevHash.slice(0, 12) }));
  const counts = await readCounts(store);
  return verified.ok
    ? { status: 'verified', length, head: head.slice(0, 12), recent, counts }
    : { status: 'broken', length, head: head.slice(0, 12), reason: (verified as { reason?: string }).reason ?? 'chain does not verify', brokenAt: (verified as { brokenAt?: number }).brokenAt ?? null, recent, counts };
});

// Rules tab: the seven rules with their current severity. Anyone can read it; only a Jira administrator can change a severity, because it
// decides which findings can stop a transition. Only block and warn are allowed, and notes (history) are never affected.
const isJiraAdmin = async (): Promise<boolean> => {
  try {
    const r = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
    return r.ok && ((await r.json()) as { permissions?: { ADMINISTER?: { havePermission?: boolean } } }).permissions?.ADMINISTER?.havePermission === true;
  } catch { return false; }
};
resolver.define('getRules', async () => {
  // Independent reads, so they run together.
  const [overrides, outcomes, reviews, drafts, canEdit, mode, canon, customDefs] = await Promise.all([loadSeverityOverrides(store), loadOutcomes(store), loadReviewCounts(store), loadDraftCounts(store), isJiraAdmin(), store.get(GATE_MODE_KEY).catch(() => null), loadCanon(store), loadCustomDefs(store)]);
  return { canEdit, gateMode: toGateMode(mode), canon, templates: TEMPLATES, custom: customDefs.map((c) => ({ ...c, draftHits: drafts[c.id] ?? 0 })), rules: RULE_CATALOG.map((r) => ({ ...r, severity: overrides[r.ruleId] ?? r.defaultSeverity, changed: Boolean(overrides[r.ruleId]), dismissed: outcomes[r.ruleId]?.dismissed ?? 0, acted: outcomes[r.ruleId]?.acted ?? 0, markedReal: reviews[r.ruleId]?.real ?? 0, markedFalse: reviews[r.ruleId]?.false ?? 0, draftHits: drafts[r.ruleId] ?? 0, hint: tuningHint({ severity: (overrides[r.ruleId] ?? r.defaultSeverity) === 'block' ? 'block' : 'warn', real: reviews[r.ruleId]?.real ?? 0, falseAlarm: reviews[r.ruleId]?.false ?? 0, dismissed: outcomes[r.ruleId]?.dismissed ?? 0, acted: outcomes[r.ruleId]?.acted ?? 0 }) })) };
});
resolver.define('setRuleSeverity', async ({ payload }: Req<{ ruleId?: string; severity?: string }>) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can change a rule severity.' };
  const out = await saveSeverity(store, String(payload?.ruleId ?? ''), String(payload?.severity ?? ''));
  if (!out.ok) return out;
  return { ok: true };
});

// Custom rules: administrators only. Three fixed templates, plain-text phrases, at most ten per site. A rule can be previewed against the
// work item being viewed before it is saved, and a preview saves nothing.
resolver.define('saveCustomRule', async ({ payload }: Req<Record<string, unknown>>) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can change custom rules.' };
  const out = await addCustomRule(store, payload ?? {});
  return out.ok ? { ok: true } : out;
});
resolver.define('deleteCustomRule', async ({ payload }: Req<{ id?: string }>) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can change custom rules.' };
  return deleteCustomRule(store, String(payload?.id ?? ''));
});
resolver.define('setGateMode', async ({ payload }: Req<{ mode?: string }>) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can change the gate mode.' };
  await store.set(GATE_MODE_KEY, toGateMode(payload?.mode));
  return { ok: true };
});
resolver.define('pilotReport', async () => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can create the pilot report.' };
  const text = buildPilotReport({ impact: await loadImpact(store as KV), reviews: await loadReviewCounts(store), gateMode: toGateMode(await store.get(GATE_MODE_KEY).catch(() => null)), customRules: (await loadCustomDefs(store)).length, on: new Date().toISOString().slice(0, 10) });
  return { ok: true, text };
});
resolver.define('saveCanonFact', async ({ payload }: Req<{ subject?: unknown; value?: unknown }>) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can change the facts.' };
  const out = await addCanon(store, payload ?? {});
  return out.ok ? { ok: true } : out;
});
resolver.define('deleteCanonFact', async ({ payload }: Req<{ id?: string }>) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can change the facts.' };
  return deleteCanon(store, String(payload?.id ?? ''));
});
// Checks every declared fact against the pages Confluence returns for it, as the person asking. Read-only.
resolver.define('checkCanon', async () => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can run the site check.' };
  const facts = await loadCanon(store);
  if (!facts.length) return { ok: false, reason: 'Add a fact first.' };
  try {
    const out = await checkCanon(facts, canonDeps());
    return { ok: true, ...out };
  } catch (e) { if (needsConsent(e)) throw e; return { ok: false, reason: 'The check could not finish. Try again.' }; }
});
// Rule playground: paste sample text and see which rules would fire. Reads nothing from the site and saves nothing.
resolver.define('playground', async ({ payload }: Req<Record<string, unknown>>) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can use the playground.' };
  return runPlayground(payload ?? {}, await rulesNow(), await loadCanon(store));
});
// Audit export for an auditor: hashes only, no page text. Verify offline with scripts/verify-export.mjs.
resolver.define('exportAudit', async () => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can export the audit trail.' };
  return { ok: true, text: JSON.stringify(await buildAuditExport(store as KV, { max: 100 }), null, 1) };
});
resolver.define('exportCustomRules', async () => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can export custom rules.' };
  const defs = await loadCustomDefs(store);
  return defs.length ? { ok: true, text: exportRules(defs) } : { ok: false, reason: 'There are no custom rules to export yet.' };
});
resolver.define('importCustomRules', async ({ payload }: Req<{ text?: unknown }>) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can import custom rules.' };
  return importRules(store, payload?.text);
});
resolver.define('previewCustomRule', async ({ payload, context }: Req<Record<string, unknown>>) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can preview custom rules.' };
  const issueKey = issueKeyOf(context);
  const rule = previewRule(payload ?? {});
  if (!rule.ok) return rule;
  if (!issueKey) return { ok: false, reason: 'Open this from a work item to preview against it.' };
  try {
    const m = await buildPanelModel(issueKey, { ...makeDeps(), rules: [rule.rule] }) as { status: string; findings?: unknown[]; pagesChecked?: number; reason?: string };
    if (m.status === 'unchecked' || m.status === 'error') return { ok: true, count: 0, note: `This work item could not be checked (${m.reason ?? 'unknown reason'}), so there is nothing to preview against.` };
    return { ok: true, count: (m.findings ?? []).length, pagesChecked: m.pagesChecked ?? 0 };
  } catch (e) { if (needsConsent(e)) throw e; return { ok: false, reason: 'The preview could not run. Try again.' }; }
});

// A person marks a finding as a real contradiction or a false alarm. The finding is rebuilt here from its id; the browser sends nothing else.
resolver.define('reviewFinding', async ({ payload, context }: Req<{ findingId?: string; verdict?: string }>) => {
  const issueKey = issueKeyOf(context) as string;
  const model = await buildPanelModel(issueKey, { ...makeDeps(), rules: await rulesNow() });
  const lists = model as { findings?: { id: string; ruleId: string }[]; notes?: { id: string; ruleId: string }[] };
  const f = [...(lists.findings ?? []), ...(lists.notes ?? [])].find((x) => x.id === payload?.findingId);
  if (!f) return { ok: false, reason: 'That finding is no longer present. Refresh the panel.' };
  return markFinding(store, { id: f.id, ruleId: f.ruleId, verdict: payload?.verdict });
});

// Link a page: add a Confluence page on this site to the work item as a web link. Reads the page as the person first, so a page they cannot
// read is never linked; the address must be on this site. Nothing is sent anywhere else.
resolver.define('linkPage', async ({ payload, context }: Req<{ url?: string }>) => {
  const issueKey = issueKeyOf(context);
  if (!issueKey) return { ok: false, reason: 'Open this from a work item.' };
  const parsed = parsePageLink(payload?.url, context?.siteUrl);
  if (!parsed.ok) return parsed;
  const read = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${parsed.pageId}`);
  if (read.status === 404 || read.status === 403) return { ok: false, reason: 'You cannot read that page, so it was not linked.' };
  if (!read.ok) return { ok: false, reason: `Confluence did not answer (HTTP ${read.status}). Try again.` };
  const title = String(((await read.json()) as { title?: string }).title ?? 'Confluence page').slice(0, 200);
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ object: { url: parsed.url, title } }),
  });
  if (!res.ok) return { ok: false, reason: res.status === 403 ? 'You do not have permission to edit this work item.' : `Jira did not save the link (HTTP ${res.status}).` };
  await clearGate(issueKey);
  return { ok: true, title };
});

// Break glass. Project administrators (or Jira administrators) only. The reason is required, the override lasts 24 hours for this one work item,
// and both granting and using it are recorded in the hash chain. The validator cannot ask for input at transition time, so this is done beforehand.
const canOverride = async (issueKey: string): Promise<boolean> => {
  const project = issueKey.split('-')[0] ?? '';
  if (!/^[A-Z][A-Z0-9_]*$/.test(project)) return false;
  try {
    const r = await api.asUser().requestJira(assumeTrustedRoute(`/rest/api/3/mypermissions?projectKey=${project}&permissions=ADMINISTER_PROJECTS,ADMINISTER`));
    if (!r.ok) return false;
    const p = ((await r.json()) as { permissions?: Record<string, { havePermission?: boolean }> }).permissions ?? {};
    return Boolean(p.ADMINISTER_PROJECTS?.havePermission || p.ADMINISTER?.havePermission);
  } catch { return false; }
};
resolver.define('grantBreakGlass', async ({ payload, context }: Req<{ reason?: string }>) => {
  const issueKey = issueKeyOf(context);
  if (!issueKey) return { ok: false, reason: 'Open this from a work item.' };
  if (!(await canOverride(issueKey))) return { ok: false, reason: 'Only a project administrator or a Jira administrator can use break glass.' };
  const g = await grantOverride(store, { issueKey, reason: payload?.reason, by: context?.accountId });
  if (!g.ok) return { ok: false, reason: g.why };
  await recordHandling(store as KV, { event: 'OVERRIDE', ruleId: 'GATE', issueKey, note: `reason: ${g.override.reason}`, by: context?.accountId });
  await clearGate(issueKey);
  return { ok: true, until: g.override.until };
});
resolver.define('revokeBreakGlass', async ({ context }: Req) => {
  const issueKey = issueKeyOf(context);
  if (!issueKey) return { ok: false, reason: 'Open this from a work item.' };
  if (!(await canOverride(issueKey))) return { ok: false, reason: 'Only a project administrator or a Jira administrator can revoke it.' };
  await revokeOverride(store, issueKey);
  return { ok: true };
});

resolver.define('triage', async ({ payload, context }: Req<{ findingId?: string; kind?: string; reason?: string }>) => {
  const issueKey = issueKeyOf(context) as string;
  const kind = payload?.kind === 'snooze' ? 'snooze' : 'dismiss';
  const until = kind === 'snooze' ? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() : undefined;
  const triageDeps = { ...makeDeps(), rules: await rulesNow() };
  const out = await triageFinding({ issueKey, findingId: payload?.findingId, kind, reason: payload?.reason, until, by: context?.accountId }, { buildModel: (k) => buildPanelModel(k, triageDeps, { llm: forgeLlm }), store });
  if (out.ok) {
    await clearGate(issueKey); await bump(store, kind === 'snooze' ? 'snoozed' : 'dismissed');
    const meta = out as { ruleId?: string; pageId?: string };
    if (meta.ruleId) await recordHandling(store as KV, { event: kind === 'snooze' ? 'SNOOZED' : 'DISMISSED', ruleId: meta.ruleId, issueKey, pageId: meta.pageId, note: kind === 'dismiss' ? `reason: ${payload?.reason ?? ''}` : 'for 7 days', by: context?.accountId });
  }
  return out;
});

// First-run help: when the summary does not name an API version, the person says which one this work item targets. It is stored as an
// issue property that the engine reads before the summary, so no custom field and no summary editing are needed.
resolver.define('setTargetVersion', async ({ payload, context }: Req<{ version?: string }>) => {
  const issueKey = issueKeyOf(context);
  const m = /^v?(\d{1,3})$/i.exec(String(payload?.version ?? '').trim());
  if (!issueKey || !m || Number(m[1]) === 0) return { ok: false, reason: 'Enter a version such as v2 or 2.' };
  const version = `v${Number(m[1])}`;
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${TARGET_PROPERTY}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ version }),
  });
  if (!res.ok) return { ok: false, reason: res.status === 403 ? 'You do not have permission to edit this work item.' : `Jira did not save it (HTTP ${res.status}).` };
  await clearGate(issueKey);
  return { ok: true, version };
});

// Demo data on demand (and the install path can call the same thing). Progress is saved after every run, so a failed run resumes
// instead of duplicating pages. Everything is created as the person who clicked, so it needs their write permissions.
resolver.define('seedDemo', async ({ context }: Req) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can load the demo data, because it creates work items and pages on the site.' };
  const sd = createSeedDeps(async (kind, path, init) => {
    try {
      const res = await (kind === 'jira' ? api.asUser().requestJira(assumeTrustedRoute(path), init) : api.asUser().requestConfluence(assumeTrustedRoute(path), init));
      if (!res.ok) {
        const text = await res.text();
        console.log(`same-page seed ${kind} ${init?.method ?? 'GET'} ${path} -> HTTP ${res.status} ${text.slice(0, 300)}`);
        return { ok: false, status: res.status, json: async () => ({}), text: async () => text } as unknown as typeof res;
      }
      return res;
    } catch (e) {
      console.log(`same-page seed ${kind} ${init?.method ?? 'GET'} ${path} THREW ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
      throw e;
    }
  }, context?.siteUrl);
  try {
    const existing = ((await store.get('seed:state')) ?? {}) as NonNullable<Parameters<typeof seedDemo>[0]['existing']>;
    const out = await seedDemo({ ...sd.makeDeps(await sd.findPlace(issueKeyOf(context)?.split('-')[0])), existing });
    await store.set('seed:state', out.state);
    if (out.ok && !(await loadCanon(store)).length) await addCanon(store, DEMO_CANON);      // one declared fact, so the site-wide check has something to show
    return out.ok ? { ok: true, epicKey: out.epicKey, linked: out.state.linked === true, linkNote: out.state.linkNote } : { ok: false, reason: `${out.error} (stopped at: ${out.failedAt}). Click again to resume.` };
  } catch (e) {
    if (needsConsent(e)) throw e;
    return { ok: false, reason: (e instanceof Error ? e.message : '') || 'Could not create demo data.' };
  }
});

// Called from the Confluence byline item. One read as the user; a consent error is left uncaught on purpose (see needsConsent above).
resolver.define('confluenceCheck', async () => {
  const r = await api.asUser().requestConfluence(route`/wiki/api/v2/spaces?limit=1`);
  return { ok: r.ok, status: r.status };
});

export const panel = resolver.getDefinitions();

// Workflow validator (jira:workflowValidator, preview). Fail-open: any problem allows the transition.
// There is no viewing user here, so the live check reads as the APP (asApp); the panel's cache, written as a real user, is the primary path.
// Verified on a real site: Jira passes { issue: {id, key}, user: {accountId}, transition: {from, to}, context, contextToken }; { result, errorMessage } blocks.
const appDeps = () => createDeps({
  requestJira: (path) => api.asApp().requestJira(assumeTrustedRoute(path)),
  requestConfluence: (path) => api.asApp().requestConfluence(assumeTrustedRoute(path)),
});

// The check reads as the APP, so the person making the transition must not be shown page text they cannot read: ask Confluence
// whether THAT user may read each page, and withhold the text unless the answer is a clear yes.
const canViewAs = (accountId?: string): CanView => async (pageId: string) => {
  if (!accountId || !PAGE_ID.test(String(pageId))) return false;
  const res = await api.asApp().requestConfluence(route`/wiki/rest/api/content/${pageId}/permission/check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ subject: { type: 'user', identifier: accountId }, operation: 'read' }),
  });
  if (!res.ok) { console.log(`same-page gate permission check failed: HTTP ${res.status}`); return false; }
  return ((await res.json()) as { hasPermission?: boolean }).hasPermission === true;
};

export const validator = async (event: { issue?: { key?: string }; user?: { accountId?: string } }) => {
  const issueKey = event?.issue?.key;
  if (!issueKey) return { result: true };   // cannot tell which issue: allow
  // Emergency off switch, set by the developer per environment: `forge variables set SAME_PAGE_KILL 1 -e <env>`. Everything is then allowed.
  if (process.env.SAME_PAGE_KILL === '1') { console.log(`same-page gate ${issueKey}: allow (disabled by SAME_PAGE_KILL)`); return { result: true }; }
  const started = Date.now();
  const d = await decideTransition({
    issueKey, store, canView: canViewAs(event?.user?.accountId),
    live: async () => snapshotFromModel(filterModelByTriage(withSeverities(await buildPanelModel(issueKey, { ...appDeps(), rules: await rulesNow() }) as never, await overridesNow()) as never, await loadTriage(issueKey, store)) as never),
  });
  console.log(`same-page gate ${issueKey}: ${d.result ? 'allow' : 'BLOCK'} (${d.basis}) ${Date.now() - started}ms${d.note ? ` ${d.note}` : ''}`);
  let final = applyGateMode(d, toGateMode(await store.get(GATE_MODE_KEY).catch(() => null)));
  if (!final.result) {
    // Break glass: a project administrator allowed this one work item through, with a reason, for a limited time. It is recorded each time it is used.
    const ov = await activeOverride(store, issueKey);
    if (ov) {
      await bump(store, 'gateOverrides');
      await recordHandling(store as KV, { event: 'OVERRIDE_USED', ruleId: 'GATE', issueKey, note: 'transition allowed by break-glass override' });
      console.log(`same-page gate ${issueKey}: ALLOWED by break-glass override`);
      final = { result: true, watched: false };
    }
  }
  if (final.watched) { await bump(store, 'gateWouldBlock'); console.log(`same-page gate ${issueKey}: WATCH ONLY, would have refused`); }
  else if (!final.result) await bump(store, 'gateBlocks');
  return final.result ? { result: true } : { result: false, errorMessage: final.errorMessage };
};

// Pin guard: a Confluence page was updated. If a person fixed that page for a work item earlier (Apply), re-check that pair and comment on the
// work item when the old version has come back. Reads and comments as the APP (no viewing user); the comment names no page title or text.
export const pageUpdated = async (event: { page?: { id?: string | number }; content?: { id?: string | number } }) => {
  const pageId = String(event?.page?.id ?? event?.content?.id ?? '');
  if (!PAGE_ID.test(pageId)) { console.log(`same-page pin: event without a usable page id; keys: ${Object.keys(event ?? {}).join(',')}`); return; }
  const deps = appDeps();
  const out = await processPageUpdate(pageId, {
    store,                                              // this (Confluence) installation's storage: only "already reported" markers live here
    readPins: readPinsAs('app'),
    loadIssue: (k) => deps.loadIssue(k),
    loadPageText: async (id) => { const b = await deps.getPageBody(id); return b == null ? null : typeof b === 'string' ? b : (b as { text?: string }).text ?? null; },
    postComment: async (key, text) => {
      const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}/comment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }),
      });
      if (!res.ok) throw new Error(`comment failed (HTTP ${res.status})`);
    },
    onError: (key, e) => console.log(`same-page pin ${key} on page ${pageId}: could not re-check: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`),
  });
  console.log(`same-page pin page ${pageId}: checked ${out.checked}, alerted ${out.alerted}`);
};

// ---- Jira project overview page (jira:projectPage). Read-only: one JQL search and the same checks as the panel, all as the viewer. ----
const overviewResolver = new Resolver();
interface OverviewCtx { extension?: { project?: { key?: string } } }

overviewResolver.define('getOverview', async ({ context, payload }: { context?: OverviewCtx; payload?: { carried?: unknown } }) => {
  const deps = { ...makeDeps(), rules: await rulesNow() };
  try {
    const projectKey = context?.extension?.project?.key;
    const out = await runOverview(projectKey, {
      ...deps,
      searchIssues: async (jql, limit) => {
        const res = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=${limit}`);
        if (!res.ok) { const e = new Error(`HTTP ${res.status}`) as Error & { status?: number }; e.status = res.status; throw e; }
        return (((await res.json()) as { issues?: { key: string; fields?: { summary?: string } }[] }).issues ?? []).map((i) => ({ key: i.key, summary: i.fields?.summary }));
      },
    }, {}, sanitizeCarried(payload?.carried));
    return out.status === 'ready' && projectKey ? { ...out, drift: await loadDrift(store, projectKey), impact: { ...(await loadImpact(store as KV)), canEdit: await isJiraAdmin() } } : out;
  } catch (e) {
    if (needsConsent(e)) throw e;
    const status = (e as { status?: number } | null)?.status;
    return { status: 'error', message: status === 429 ? 'Atlassian is rate limiting this app. Try again in a minute.' : status === 403 || status === 401 ? 'You may not have permission to search this project.' : 'Something went wrong while loading the overview.' };
  }
});
// The hours figure needs an administrator's own estimate of minutes saved per applied fix. We never supply one.
overviewResolver.define('setMinutesPerFix', async ({ payload }: { payload?: { minutes?: unknown } }) => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can set this.' };
  return setMinutesPerFix(store as KV, payload?.minutes);
});
// Scheduled triggers run once per installation and Forge storage is per installation, so a scheduled scan may save its result in the other product.
// An administrator can run the same scan from Jira, which saves the result where this page reads it.
overviewResolver.define('runScanNow', async () => {
  if (!(await isJiraAdmin())) return { ok: false, reason: 'Only a Jira administrator can run the scan.' };
  try {
    const snap = await runDriftScan({
      ...makeDeps(), rules: await rulesNow(),
      searchIssues: async (jql, limit) => {
        const res = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=${limit}`);
        if (!res.ok) throw new Error(`search failed (HTTP ${res.status})`);
        return (((await res.json()) as { issues?: { key: string; fields?: { summary?: string } }[] }).issues ?? []).map((i) => ({ key: i.key, summary: i.fields?.summary }));
      },
    }, store);
    return { ok: true, scanned: snap.scanned, notChecked: snap.notChecked };
  } catch (e) { if (needsConsent(e)) throw e; return { ok: false, reason: 'The scan could not finish. Try again.' }; }
});
export const overview = overviewResolver.getDefinitions();

// ---- Confluence byline: check the page being viewed against the work items it names. Read-only, as the viewer. ----
const bylineResolver = new Resolver();
const pageIdOf = (x: unknown) => String((x as { extension?: { content?: { id?: string | number } } } | undefined)?.extension?.content?.id ?? '');
const runPageCheck = async (pageId: string): Promise<PageCheck> => {
  const d = makeDeps();
  if (!PAGE_ID.test(pageId)) return { status: 'unchecked', reason: 'this item must be opened from a Confluence page' };
  return checkPage(pageId, { loadPage: (id) => d.getPageBody(id), loadIssue: (k) => d.loadIssue(k), getTransition: (k) => d.getTransition(k) });
};

bylineResolver.define('pageCheck', async ({ context }: { context?: unknown }) => {
  try { return await runPageCheck(pageIdOf(context)); } catch (e) {
    if (needsConsent(e)) throw e;
    const status = (e as { status?: number } | null)?.status;
    return { status: 'error', message: status === 429 ? 'Atlassian is rate limiting this app. Try again in a minute.' : status === 403 ? 'You may not have permission to read something this check needs.' : 'Something went wrong while checking this page.' };
  }
});
bylineResolver.define('confluenceCheck', async () => {
  const r = await api.asUser().requestConfluence(route`/wiki/api/v2/spaces?limit=1`);
  return { ok: r.ok, status: r.status };
});
export const byline = bylineResolver.getDefinitions();

// Sets the byline title shown on the page itself. Any failure (including no consent yet) leaves the plain default title.
export const bylineProps = async (arg: unknown, ctx?: unknown) => {
  const base = { title: 'Same Page', tooltip: 'Checked against the Jira work items this page names' };
  try {
    const pageId = pageIdOf(arg) || pageIdOf((arg as { payload?: unknown } | undefined)?.payload) || pageIdOf(ctx);
    return { ...base, title: bylineTitle(await runPageCheck(pageId)) };
  } catch { return base; }
};

// ---- Soft gate: a status change to Done with an open blocker leaves one notice comment. Works in every project type and never blocks. ----
const postCommentAsApp = async (key: string, text: string) => {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}/comment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }),
  });
  if (!res.ok) throw new Error(`comment failed (HTTP ${res.status})`);
};

export const statusWatch = async (event: SoftGateEvent) => {
  if (process.env.SAME_PAGE_KILL === '1') return;
  try {
    const out = await runSoftGate(event, {
      store,
      postComment: postCommentAsApp,
      blockers: async (issueKey) => {
        const model = filterModelByTriage(withSeverities(await buildPanelModel(issueKey, { ...appDeps(), rules: await rulesNow() }) as never, await overridesNow()) as never, await loadTriage(issueKey, store)) as { status?: string; findings?: { id: string; ruleId: string; severity: string }[] };
        if (model.status === 'unchecked' || model.status === 'error') return null;
        const warm = snapshotFromModel(model as never); if (warm) await store.set(gateKey(issueKey), warm).catch(() => undefined);      // keep the gate's cache warm so the validator answers from it instantly
        return (model.findings ?? []).filter((f) => f.severity === 'block').map((f) => ({ id: f.id, ruleId: f.ruleId }));
      },
    });
    console.log(`same-page soft gate ${event?.issue?.key ?? '?'}: ${out}`);
    const nudge = await runChangeNudge(event, {
      store,
      postComment: postCommentAsApp,
      findings: async (issueKey) => {
        const model = filterModelByTriage(withSeverities(await buildPanelModel(issueKey, { ...appDeps(), rules: await rulesNow() }) as never, await overridesNow()) as never, await loadTriage(issueKey, store)) as { status?: string; findings?: { id: string; ruleId: string }[] };
        if (model.status === 'unchecked' || model.status === 'error') return null;
        return (model.findings ?? []).map((f) => ({ id: f.id, ruleId: f.ruleId }));
      },
    });
    console.log(`same-page change nudge ${event?.issue?.key ?? '?'}: ${nudge}`);
  } catch (e) { console.log(`same-page soft gate: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`); }
};

// ---- Weekly drift scan, as the app. Keeps counts and keys per project; the overview page shows the latest. ----
export const driftScan = async () => {
  if (process.env.SAME_PAGE_KILL === '1') return;
  try {
    const snap = await runDriftScan({
      ...appDeps(),
      rules: await rulesNow(),
      searchIssues: async (jql, limit) => {
        const res = await api.asApp().requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=${limit}`);
        if (!res.ok) throw new Error(`search failed (HTTP ${res.status})`);
        return (((await res.json()) as { issues?: { key: string; fields?: { summary?: string } }[] }).issues ?? []).map((i) => ({ key: i.key, summary: i.fields?.summary }));
      },
    }, store);
    console.log(`same-page drift scan: ${snap.scanned} items, ${snap.notChecked} not checked`);
  } catch (e) { console.log(`same-page drift scan: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`); }
};
