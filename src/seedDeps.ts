// The real Jira and Confluence calls behind seedDemo. Takes fetch-style `request(kind, path, init)` so it runs against fakes in tests
// and against api.asUser() in the app (the person who clicks "Create demo data" owns everything created).
// Request and response SHAPES follow the documented REST formats and are UNVERIFIED until run on a real site.

import type { SeedDeps } from './seed.ts';

export interface FetchLikeResponse { ok: boolean; status: number; json(): Promise<any> }
export interface RequestInit2 { method?: string; headers?: Record<string, string>; body?: string }
export type SeedRequest = (kind: 'jira' | 'confluence', path: string, init?: RequestInit2) => Promise<FetchLikeResponse>;

const json = { 'Content-Type': 'application/json', Accept: 'application/json' };

async function ok(res: FetchLikeResponse, what: string): Promise<any> {
  if (!res.ok) { const e = Object.assign(new Error(`${what} failed (HTTP ${res.status})`), { status: res.status }); throw e; }
  return res.json();
}

// `siteUrl` (for example https://acme.atlassian.net) is needed because Jira only accepts absolute URLs in remote links.
export function createSeedDeps(request: SeedRequest, siteUrl?: string) {
  const call = async (kind: 'jira' | 'confluence', path: string, init: RequestInit2 | undefined, what: string): Promise<any> => ok(await request(kind, path, init), what);
  return {
    // Picks the first space the person can use, and a Jira SOFTWARE project (a service desk project cannot hold the demo epic).
    // The project the panel was opened in wins when it qualifies, so demo data does not land in someone else's project.
    async findPlace(preferProjectKey?: string): Promise<{ spaceId: string; projectKey: string }> {
      const spaces = (await call('confluence', '/wiki/api/v2/spaces?limit=1', undefined, 'Finding a Confluence space')).results ?? [];
      if (!spaces[0]?.id) throw new Error('No Confluence space you can write to was found. Create one and try again.');
      let projectKey: string | undefined;
      if (preferProjectKey && /^[A-Z][A-Z0-9_]*$/i.test(preferProjectKey)) {
        try {
          const p = await call('jira', `/rest/api/3/project/${preferProjectKey}`, undefined, 'Reading the current project');
          if (p?.projectTypeKey === 'software' && p?.key) projectKey = String(p.key);
        } catch (e) {
          // Only a missing consent must reach the platform; anything else just means "use the search below".
          if ((e as { name?: string } | null)?.name === 'NEEDS_AUTHENTICATION_ERR') throw e;
        }
      }
      if (!projectKey) {
        const projects = (await call('jira', '/rest/api/3/project/search?typeKey=software&maxResults=1', undefined, 'Finding a Jira software project')).values ?? [];
        projectKey = projects[0]?.key;
      }
      if (!projectKey) throw new Error('No Jira software project you can create epics in was found. Create a Scrum or Kanban project and try again.');
      return { spaceId: String(spaces[0].id), projectKey };
    },
    makeDeps({ spaceId, projectKey }: { spaceId: string; projectKey: string }): Pick<SeedDeps, 'projectKey' | 'createPage' | 'createIssue' | 'transitionIssue' | 'linkPageToIssue'> {
      return {
        projectKey,
        createPage: async ({ title, html, labels = [] }: { title: string; html: string; labels?: string[] }) => {
          const page = await call('confluence', '/wiki/api/v2/pages', { method: 'POST', headers: json, body: JSON.stringify({ spaceId, status: 'current', title, body: { representation: 'storage', value: html } }) }, 'Creating a page');
          for (const name of labels) {
            // Label failures must not abort seeding silently: R2 needs the label, so let it throw and be retried.
            await call('confluence', `/wiki/rest/api/content/${page.id}/label`, { method: 'POST', headers: json, body: JSON.stringify([{ prefix: 'global', name }]) }, 'Labelling a page');
          }
          return { id: String(page.id) };
        },
        createIssue: async ({ projectKey: key, type, summary }: { projectKey: string; type: string; summary: string }) => call('jira', '/rest/api/3/issue', { method: 'POST', headers: json, body: JSON.stringify({ fields: { project: { key }, issuetype: { name: type }, summary } }) }, 'Creating the demo epic'),
        transitionIssue: async (issueKey: string, toName: string) => {
          const { transitions = [] } = await call('jira', `/rest/api/3/issue/${issueKey}/transitions`, undefined, 'Reading transitions');
          const t = transitions.find((x: { to?: { name?: string }; name?: string }) => x.to?.name === toName || x.name === toName);
          if (!t) throw new Error(`No transition to "${toName}" on the demo epic.`);
          const res = await request('jira', `/rest/api/3/issue/${issueKey}/transitions`, { method: 'POST', headers: json, body: JSON.stringify({ transition: { id: t.id } }) });
          if (!res.ok) throw new Error(`Moving the demo epic failed (HTTP ${res.status})`);
        },
        linkPageToIssue: async (issueKey: string, pageId: string) => {
          if (!siteUrl) throw new Error('The site address is not known, so the page could not be linked.');
          const url = `${siteUrl.replace(/\/+$/, '')}/wiki/pages/viewpage.action?pageId=${pageId}`;
          await call('jira', `/rest/api/3/issue/${issueKey}/remotelink`, { method: 'POST', headers: json, body: JSON.stringify({ object: { url, title: 'Confluence page (Same Page demo)' } }) }, 'Linking a page');
        },
      };
    },
  };
}
