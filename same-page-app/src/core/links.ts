// Finding the page without guessing. Two paths: a pasted URL, and the Jira remote-links payload.
// Shapes follow Atlassian's documented URL formats and the remote link object; CONFIRM against a real
// response (see scripts/capture-payloads.mjs). Short links like /wiki/x/AbC123 cannot be resolved offline and return null.

export function pageIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url, 'https://example.invalid');
    const q = u.searchParams.get('pageId');
    if (q && /^\d+$/.test(q)) return q;
    const m = /\/pages\/(\d+)(?:\/|$)/.exec(u.pathname);
    if (m) return m[1];
  } catch { /* fall through */ }
  return null;
}

// Confluence page ids from GET /rest/api/3/issue/{key}/remotelink. Tolerant: checks object.url and globalId.
export interface RemoteLink { object?: { url?: string }; globalId?: string }

export function confluencePageIdsFromRemoteLinks(links: RemoteLink[] | unknown = []): string[] {
  const ids = new Set<string>();
  for (const l of (Array.isArray(links) ? links : []) as RemoteLink[]) {
    for (const candidate of [l?.object?.url, l?.globalId]) {
      if (typeof candidate !== 'string') continue;
      const fromUrl = pageIdFromUrl(candidate);
      const fromGlobal = /(?:^|[&?])pageId=(\d+)/.exec(candidate);
      if (fromUrl) ids.add(fromUrl);
      else if (fromGlobal) ids.add(fromGlobal[1] as string);
    }
  }
  return [...ids];
}
