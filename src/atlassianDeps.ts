import { lastStatusTransition, storageToText } from './adapters.ts';
import { confluencePageIdsFromRemoteLinks } from './links.ts';
import type { Issue } from './types.ts';

/** A fetch-style response: Forge's api.asUser().requestJira() returns this shape. */
export interface HttpResponse { ok: boolean; status: number; headers?: { get(name: string): string | null | undefined }; json(): Promise<any> }
export type RequestFn = (path: string) => Promise<HttpResponse>;
/** An error carrying the HTTP status (and Retry-After seconds on a 429). */
export type HttpError = Error & { status?: number; retryAfter?: number };

// Forge throws this when the user has not allowed the app to act for them in that product. It must reach the platform, which then shows its allow-access prompt.
const needsConsent = (e: unknown) => (e as { name?: string } | null)?.name === 'NEEDS_AUTHENTICATION_ERR';
const statusOf = (e: unknown): number | undefined => (e as HttpError | undefined)?.status;

// The real Jira and Confluence calls, behind the same small interface the engine already uses.
// `requestJira(path)` and `requestConfluence(path)` take a plain path string and return a fetch-style Response, so this
// runs against fakes in tests and against Forge's api.asUser() in the app (see same-page-app/src/index.js).
// Everything runs AS THE VIEWER, so Atlassian's own permissions decide what is visible.
// Response SHAPES follow the documented REST formats and are UNVERIFIED until real payloads are captured (see scripts/capture-payloads.mjs).

/** Light metadata from a Confluence search: the excerpt stands in for the body until the page is fetched. */
export interface SearchHit { id: string; title: string; text: string; modifiedAt?: string; labels: string[] }
export interface PageSource { id: string; title: string; html: string; version: number | null }
export interface PageBody { title: string; text: string; modifiedAt: string; lastEditorId: string | null; labels: string[] }
export type AtlassianDeps = ReturnType<typeof createDeps>;

const KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;
const ID_RE = /^\d+$/;
const STOP = new Set(['with', 'from', 'that', 'this', 'into', 'over', 'upgrade', 'update', 'task', 'epic', 'story', 'migrate', 'move']);

export function keywords(summary = ''): string[] {
  const words = (summary.toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((w) => !STOP.has(w) && !/^v\d+$/.test(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 3);
}

// CQL for candidate pages: the issue key as a phrase, or any of its strongest words in the title or body.
export function buildCql(issue: { key: string; summary?: string }): string {
  const parts = [`text ~ "\\"${issue.key}\\""`];
  for (const w of keywords(issue.summary)) parts.push(`title ~ "${w}"`, `text ~ "${w}"`);
  return `type = page AND (${parts.join(' OR ')}) ORDER BY lastmodified DESC`;
}

async function readJson(res: HttpResponse): Promise<any> {
  if (res.status === 429) {
    const e: HttpError = Object.assign(new Error('rate limited'), { status: 429 });
    const ra = Number(res.headers?.get?.('retry-after'));
    if (Number.isFinite(ra) && ra > 0) e.retryAfter = ra;
    throw e;
  }
  if (!res.ok) { const e: HttpError = Object.assign(new Error(`HTTP ${res.status}`), { status: res.status }); throw e; }
  return res.json();
}

const names = (list?: { name?: string }[] | null): string[] => (list || []).map((x) => x?.name).filter((n): n is string => Boolean(n));

/** Jira issue property holding the target API version a person set from the panel, as { version: "v2" }. */
export const TARGET_PROPERTY = 'same-page.targetVersion';

export function createDeps({ requestJira, requestConfluence }: { requestJira: RequestFn; requestConfluence: RequestFn }) {
  const jira = async (path: string) => readJson(await requestJira(path));
  const wiki = async (path: string) => readJson(await requestConfluence(path));

  return {
    async loadIssue(key: string): Promise<Issue> {
      if (!KEY_RE.test(key)) throw new Error('not a valid issue key');
      // The target version a person set from the panel is stored as an issue property and read here in the same request.
      const j = await jira(`/rest/api/3/issue/${key}?fields=summary,status,components,fixVersions,labels&properties=${TARGET_PROPERTY}`);
      const f = j.fields ?? {};
      const set = j.properties?.[TARGET_PROPERTY]?.version ?? j.properties?.[TARGET_PROPERTY]?.value?.version;
      return { key: j.key ?? key, summary: f.summary ?? '', status: f.status?.name ?? '', components: names(f.components), fixVersions: names(f.fixVersions), labels: f.labels ?? [], requiredFields: [], fields: {}, ...(typeof set === 'string' ? { apiVersionField: set } : {}) };
    },

    // Changelog is oldest-first and paged, so read the LAST page to find the most recent status change.
    async getTransition(key: string) {
      const first = await jira(`/rest/api/3/issue/${key}/changelog?startAt=0&maxResults=100`);
      let entries = first.values ?? [];
      const total = first.total ?? entries.length;
      if (total > entries.length) {
        const last = await jira(`/rest/api/3/issue/${key}/changelog?startAt=${Math.max(0, total - 100)}&maxResults=100`);
        entries = last.values ?? entries;
      }
      return lastStatusTransition(entries);
    },

    async getRemoteLinkIds(key: string): Promise<string[]> {
      try { return confluencePageIdsFromRemoteLinks(await jira(`/rest/api/3/issue/${key}/remotelink`)); } catch (e) { if (statusOf(e) === 429 || needsConsent(e)) throw e; return []; }
    },

    async searchPages(issue: { key: string; summary?: string }): Promise<SearchHit[]> {
      const j = await wiki(`/wiki/rest/api/search?cql=${encodeURIComponent(buildCql(issue))}&limit=10`);
      return (j.results ?? [])
        .filter((r: any) => r.content?.type === 'page' && ID_RE.test(String(r.content?.id)))
        .map((r: any): SearchHit => ({ id: String(r.content.id), title: r.title ?? r.content.title ?? '', text: String(r.excerpt ?? '').replace(/@@@(?:end)?hl@@@/g, ''), modifiedAt: r.lastModified, labels: [] }));
    },

    // Raw storage HTML plus the current version number, for the human-approved Apply step. Null when unreadable.
    async getPageSource(id: string | number): Promise<PageSource | null> {
      if (!ID_RE.test(String(id))) return null;
      try {
        const page = await wiki(`/wiki/api/v2/pages/${id}?body-format=storage`);
        return { id: String(page.id ?? id), title: page.title ?? '', html: page.body?.storage?.value ?? '', version: page.version?.number ?? null };
      } catch (e) { if (statusOf(e) === 403 || statusOf(e) === 404) return null; throw e; }
    },

    // Full text, real last-edit time and labels, or null when the viewer cannot read the page.
    async getPageBody(id: string | number): Promise<PageBody | null> {
      if (!ID_RE.test(String(id))) return null;
      let page;
      try { page = await wiki(`/wiki/api/v2/pages/${id}?body-format=storage`); } catch (e) { if (statusOf(e) === 403 || statusOf(e) === 404) return null; throw e; }
      let labels: string[] = [];
      try { labels = ((await wiki(`/wiki/api/v2/pages/${id}/labels`)).results ?? []).map((l: { name?: string }) => l.name).filter((n: string | undefined): n is string => Boolean(n)); } catch (e) { if (statusOf(e) === 429 || needsConsent(e)) throw e; }
      return { title: page.title, text: storageToText(page.body?.storage?.value ?? ''), modifiedAt: page.version?.createdAt ?? page.createdAt, lastEditorId: page.version?.authorId ?? null, labels };
    },
  };
}
