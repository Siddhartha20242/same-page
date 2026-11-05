import api, { assumeTrustedRoute } from '@forge/api';
import { createDeps } from './core/atlassianDeps';
import { checkIssueDocs as check, scanIssues as scan } from './core/tools';

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
