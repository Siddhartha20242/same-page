import api, { assumeTrustedRoute, route } from '@forge/api';
import { createDeps } from './core/atlassianDeps';
import { checkIssueDocs as check, scanIssues as scan, projectBrief as brief, listRules as rules } from './core/tools';

// Action functions behind the Rovo agent and rovo:mcp (see ../../manifest.mcp.draft.yml). NOT referenced by manifest.yml yet.
// UNVERIFIED: the exact handler signature Forge passes to action functions, and that asUser resolves to the invoking user here.
const deps = () => createDeps({
  requestJira: (p) => api.asUser().requestJira(assumeTrustedRoute(p)),
  requestConfluence: (p) => api.asUser().requestConfluence(assumeTrustedRoute(p)),
});

// Logging only names the tool and the keys asked about, never page text.
export const checkIssueDocs = async (payload?: { issueKey?: string }) => {
  console.log(`same-page tool check-issue-docs ${String(payload?.issueKey ?? '').slice(0, 40)}`);
  return check({ issueKey: payload?.issueKey }, deps());
};
export const scanIssues = async (payload?: { issueKeys?: unknown }) => {
  console.log(`same-page tool scan-issues ${JSON.stringify(payload?.issueKeys ?? null).slice(0, 120)}`);
  return scan({ issueKeys: payload?.issueKeys }, deps());
};

export const projectBrief = async (payload?: { projectKey?: string }) => {
  console.log(`same-page tool project-brief ${String(payload?.projectKey ?? '').slice(0, 40)}`);
  return brief({ projectKey: payload?.projectKey }, {
    ...deps(),
    searchIssues: async (jql, limit) => {
      const res = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=summary&maxResults=${limit}`);
      if (!res.ok) throw new Error(`search failed (HTTP ${res.status})`);
      return (((await res.json()) as { issues?: { key: string; fields?: { summary?: string } }[] }).issues ?? []).map((i) => ({ key: i.key, summary: i.fields?.summary }));
    },
  });
};
export const listRules = async () => rules();
