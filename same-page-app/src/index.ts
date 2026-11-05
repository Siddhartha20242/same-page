import Resolver from '@forge/resolver';
import api, { route, assumeTrustedRoute } from '@forge/api';
import { kvs } from '@forge/kvs';
import { createDeps, TARGET_PROPERTY } from './core/atlassianDeps';
import { buildPanelModel } from './core/panelModel';
import { buildReviewTask } from './core/reviewTask';
import { applySuggestion, triageFinding, loadTriage } from './core/panelActions';
import type { KeyValueStore } from './core/panelActions';
import { filterModelByTriage, loadNoisyRules, recordOutcome, withNoisyRules } from './core/triage';
import { seedDemo } from './core/seed';
import { createSeedDeps } from './core/seedDeps';
import { forgeLlm } from './llm';
import { appendToStore, headOf, verifyStored } from './core/ledgerStore';
import { bump, markSeen, readCounts } from './core/metrics';
import { addPin, PIN_PROPERTY, processPageUpdate } from './core/pin';
import type { Pin } from './core/pin';
import type { KV } from './core/ledgerStore';
import type { LedgerEntry } from './core/ledger';
import { decideTransition, gateKey, snapshotFromModel } from './core/gate';
import type { CanView } from './core/gate';
import { runOverview } from './core/overview';
import { checkPage, bylineTitle } from './core/pageCheck';
import type { PageCheck } from './core/pageCheck';

// Everything runs AS THE VIEWING USER (asUser), so Jira and Confluence permissions decide what is visible and what can be created.
// The engine under ./core is a synced copy of the tested code in the repo's ./src (scripts/sync-core.mjs).
const resolver = new Resolver();

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
const clearGate = async (issueKey: string) => { try { await store.set(gateKey(issueKey), null); } catch { /* best effort */ } };

const issueKeyOf = (context?: Ctx) => context?.extension?.issue?.key;

resolver.define('getPanel', async ({ context }: Req) => {
  const issueKey = issueKeyOf(context);
  if (!issueKey) return { status: 'error', message: 'This panel must be opened from a Jira issue.' };
  try {
    const model = filterModelByTriage(await buildPanelModel(issueKey, makeDeps(), { llm: forgeLlm }), await loadTriage(issueKey, store));
    const shown = model as { findings?: { id: string }[]; notes?: { id: string }[] };
    await markSeen(store, [...(shown.findings ?? []), ...(shown.notes ?? [])].map((f) => f.id));
    const snap = snapshotFromModel(model);
    if (snap) { try { await store.set(gateKey(issueKey), snap); } catch { /* best effort */ } }
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
  const model = await buildPanelModel(issueKey, makeDeps(), { llm: forgeLlm });
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
  return { key: ((await res.json()) as { key: string }).key };
});

// Apply: a human clicked. The edit is rebuilt and re-verified here; the write runs as that user and becomes a revertible page version.
resolver.define('applyFix', async ({ payload, context }: Req<{ findingId?: string; expectedAfter?: string }>) => {
  const issueKey = issueKeyOf(context) as string;
  const deps = makeDeps();
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
    await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/properties/same-page.lastReceipt`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ seq: entry.seq, entryHash: entry.entryHash, at: entry.at, ruleId: entry.ruleId }),
    });
    try { await writePin(out.pageId, issueKey); }                                                    // pin guard: watch this page for a regression
    catch (e) { console.log(`same-page pin: ${e instanceof Error ? e.message : String(e)}`); }
    return { ...out, receipt: entry };
  } catch (e) {
    console.log(`same-page ledger: could not seal the applied fix: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }
});

// The audit trail the panel shows: chain status, length, and the last three entries. Verifying reads every entry once (paged), so it runs on request.
resolver.define('ledgerView', async () => {
  const { length, head } = await headOf(store as KV);
  const verified = await verifyStored(store as KV);
  const recent = [];
  for (let i = Math.max(0, length - 3); i < length; i++) {
    const e = (await kvs.get(`ledger:e:${i}`)) as LedgerEntry | undefined;
    if (e) recent.push({ seq: e.seq, at: e.at, ruleId: e.ruleId, issueKey: e.issueKey, entryHash: e.entryHash.slice(0, 12), prevHash: e.prevHash.slice(0, 12) });
  }
  const counts = await readCounts(store);
  return verified.ok
    ? { status: 'verified', length, head: head.slice(0, 12), recent, counts }
    : { status: 'broken', length, head: head.slice(0, 12), reason: (verified as { reason?: string }).reason ?? 'chain does not verify', brokenAt: (verified as { brokenAt?: number }).brokenAt ?? null, recent, counts };
});

resolver.define('triage', async ({ payload, context }: Req<{ findingId?: string; kind?: string; reason?: string }>) => {
  const issueKey = issueKeyOf(context) as string;
  const kind = payload?.kind === 'snooze' ? 'snooze' : 'dismiss';
  const until = kind === 'snooze' ? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() : undefined;
  const out = await triageFinding({ issueKey, findingId: payload?.findingId, kind, reason: payload?.reason, until, by: context?.accountId }, { buildModel: (k) => buildPanelModel(k, makeDeps(), { llm: forgeLlm }), store });
  if (out.ok) { await clearGate(issueKey); await bump(store, kind === 'snooze' ? 'snoozed' : 'dismissed'); }
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
    live: async () => snapshotFromModel(filterModelByTriage(await buildPanelModel(issueKey, appDeps()), await loadTriage(issueKey, store))),
  });
  console.log(`same-page gate ${issueKey}: ${d.result ? 'allow' : 'BLOCK'} (${d.basis}) ${Date.now() - started}ms${d.note ? ` ${d.note}` : ''}`);
  if (!d.result) await bump(store, 'gateBlocks');
  return d.result ? { result: true } : { result: false, errorMessage: d.errorMessage };
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

overviewResolver.define('getOverview', async ({ context }: { context?: OverviewCtx }) => {
  const deps = makeDeps();
  try {
    return await runOverview(context?.extension?.project?.key, {
      ...deps,
      searchIssues: async (jql, limit) => {
        const res = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=${limit}`);
        if (!res.ok) { const e = new Error(`HTTP ${res.status}`) as Error & { status?: number }; e.status = res.status; throw e; }
        return (((await res.json()) as { issues?: { key: string; fields?: { summary?: string } }[] }).issues ?? []).map((i) => ({ key: i.key, summary: i.fields?.summary }));
      },
    });
  } catch (e) {
    if (needsConsent(e)) throw e;
    const status = (e as { status?: number } | null)?.status;
    return { status: 'error', message: status === 429 ? 'Atlassian is rate limiting this app. Try again in a minute.' : status === 403 || status === 401 ? 'You may not have permission to search this project.' : 'Something went wrong while loading the overview.' };
  }
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
