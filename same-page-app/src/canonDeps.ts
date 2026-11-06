import api, { assumeTrustedRoute } from '@forge/api';
import { createDeps } from './core/atlassianDeps';
import type { CanonDeps } from './core/canon';

// Confluence access for the fact registry, as the person asking: they only see pages they are allowed to read.
// The search words are letters and digits only (core/canon.ts), so nothing a person typed can change the query.
export const canonDeps = (): CanonDeps => {
  const deps = createDeps({
    requestJira: (p) => api.asUser().requestJira(assumeTrustedRoute(p)),
    requestConfluence: (p) => api.asUser().requestConfluence(assumeTrustedRoute(p)),
  });
  return {
    search: async (words) => {
      if (!words.length) return [];
      const cql = `type = page and ${words.map((w) => `text ~ "${w}"`).join(' and ')}`;
      const res = await api.asUser().requestConfluence(assumeTrustedRoute(`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=10`));
      if (!res.ok) throw new Error(`search failed (HTTP ${res.status})`);
      const j = (await res.json()) as { results?: { content?: { id?: string; type?: string }; title?: string }[] };
      return (j.results ?? []).filter((r) => r.content?.type === 'page' && /^\d+$/.test(String(r.content?.id))).map((r) => ({ id: String(r.content!.id), title: String(r.title ?? '') }));
    },
    getPage: async (id) => {
      const b = await deps.getPageBody(id);
      if (b == null) return null;
      return typeof b === 'string' ? { title: '', text: b } : { title: String((b as { title?: string }).title ?? ''), text: (b as { text: string }).text };
    },
  };
};
