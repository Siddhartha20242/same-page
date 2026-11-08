import api, { assumeTrustedRoute, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { BUILT_IN_RULES } from './core/rules';
import { loadCustomRules } from './core/customRules';
import { loadDrift } from './core/drift';
import { canonDeps } from './canonDeps';
import { createDeps } from './core/atlassianDeps';
import { checkIssueDocs as check, scanIssues as scan, projectBrief as brief, listRules as rules, canonCheckTool as canonCheck, findingHistory as history, ruleHealth as health, impactSummary as impact } from './core/tools';

// Action functions behind the Rovo agent and rovo:mcp (see ../../manifest.mcp.draft.yml). NOT referenced by manifest.yml yet.
// UNVERIFIED: the exact handler signature Forge passes to action functions, and that asUser resolves to the invoking user here.
const rulesNow = async () => [...BUILT_IN_RULES, ...(await loadCustomRules({ get: (k) => kvs.get(k), set: (k, v) => kvs.set(k, v) }))];
const baseDeps = () => createDeps({
  requestJira: (p) => api.asUser().requestJira(assumeTrustedRoute(p)),
  requestConfluence: (p) => api.asUser().requestConfluence(assumeTrustedRoute(p)),
});
const deps = async () => ({ ...baseDeps(), rules: await rulesNow() });

// Logging only names the tool and the keys asked about, never page text.
export const checkIssueDocs = async (payload?: { issueKey?: string }) => {
  console.log(`same-page tool check-issue-docs ${String(payload?.issueKey ?? '').slice(0, 40)}`);
  return check({ issueKey: payload?.issueKey }, await deps());
};
export const scanIssues = async (payload?: { issueKeys?: unknown }) => {
  console.log(`same-page tool scan-issues ${JSON.stringify(payload?.issueKeys ?? null).slice(0, 120)}`);
  return scan({ issueKeys: payload?.issueKeys }, await deps());
};

export const projectBrief = async (payload?: { projectKey?: string; fixVersion?: string }) => {
  console.log(`same-page tool project-brief ${String(payload?.projectKey ?? '').slice(0, 40)}${payload?.fixVersion ? ` version ${String(payload.fixVersion).slice(0, 60)}` : ''}`);
  return brief({ projectKey: payload?.projectKey, fixVersion: payload?.fixVersion }, {
    ...(await deps()),
    searchIssues: async (jql, limit) => {
      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=${limit}`);
      if (!res.ok) { const e = new Error(`search failed (HTTP ${res.status})`) as Error & { status?: number }; e.status = res.status; throw e; }
      return (((await res.json()) as { issues?: { key: string; fields?: { summary?: string } }[] }).issues ?? []).map((i) => ({ key: i.key, summary: i.fields?.summary }));
    },
  }, /^[A-Z][A-Z0-9_]*$/.test(String(payload?.projectKey ?? '')) ? await loadDrift({ get: (k) => kvs.get(k), set: (k, v) => kvs.set(k, v) }, String(payload?.projectKey)) : null);
};
export const listRules = async () => rules();

const kv = { get: (k: string) => kvs.get(k), set: (k: string, v: unknown) => kvs.set(k, v) };
// Reads the work item as the caller: Jira's own permissions decide whether the caller may see its history.
const canSee = async (issueKey: string): Promise<boolean> => {
  try { await baseDeps().loadIssue(issueKey); return true; } catch (e) {
    const status = (e as { status?: number } | null)?.status;
    if (status === 401 || status === 403 || status === 404) return false;
    throw e;
  }
};
export const findingHistory = async (payload?: { issueKey?: string }) => {
  console.log(`same-page tool finding-history ${String(payload?.issueKey ?? '').slice(0, 40)}`);
  return history({ issueKey: payload?.issueKey }, kv, canSee);
};
export const ruleHealth = async () => { console.log('same-page tool rule-health'); return health(kv); };
export const impactSummary = async () => { console.log('same-page tool impact-summary'); return impact(kv); };
export const canonCheckAction = async () => { console.log('same-page tool canon-check'); return canonCheck(kv, canonDeps()); };
