import { check } from './engine';
import { deriveTargetVersion } from './adapters';
import type { Issue, Page, WorkItem } from './types';
import type { PageBody } from './release';
import { ruleInfo } from './ruleCatalog';

// Confluence byline: does the page being viewed contradict a work item it names? Pairs the viewed page with up to MAX_KEYS work item keys
// found in its own text, using the same rules as the Jira panel. Read-only. It reports only rule, plain summary and work item key.

const KEY = /(?<![A-Za-z0-9-])[A-Z][A-Z0-9_]+-\d+(?![0-9])/g;
export const MAX_KEYS = 5;

export const ruleName = (id: string) => ruleInfo(id)?.name ?? 'Rule';

export interface PageIssue { ruleId: string; rule: string; severity: 'block' | 'warn'; summary: string; key: string }
export type PageCheck =
  | { status: 'issues'; issues: PageIssue[]; checked: string[]; skipped: { key: string; reason: string }[] }
  | { status: 'clean'; checked: string[]; skipped: { key: string; reason: string }[] }
  | { status: 'unchecked'; reason: string };

export interface PageCheckDeps {
  loadPage: (pageId: string) => Promise<PageBody | null>;
  loadIssue: (key: string) => Promise<Issue>;
  getTransition: (key: string) => Promise<{ at: string; by: string | null } | null>;
}

export async function checkPage(pageId: string, d: PageCheckDeps): Promise<PageCheck> {
  const body = await d.loadPage(pageId);
  if (body == null) return { status: 'unchecked', reason: 'this page could not be read with your permissions' };
  const b = typeof body === 'string' ? { text: body } : body;
  const text = `${(b as { title?: string }).title ?? ''}\n${b.text}`;
  const keys = [...new Set(text.match(KEY) ?? [])].slice(0, MAX_KEYS);
  if (!keys.length) return { status: 'unchecked', reason: 'this page does not name any Jira work item' };
  const page: Page = { id: pageId, title: '', modifiedAt: '', ...(b as object), text: b.text } as Page;

  const loaded = new Map<string, Issue>();
  const skipped: { key: string; reason: string }[] = [];
  for (const k of keys) {
    try { loaded.set(k, await d.loadIssue(k)); } catch (e) {
      const s = (e as { status?: number } | null)?.status;
      if (s === 429 || (e as { name?: string } | null)?.name === 'NEEDS_AUTHENTICATION_ERR') throw e;
      skipped.push({ key: k, reason: s === 404 || s === 403 ? 'not found or not visible to you' : 'could not be read' });
    }
  }
  const issues: PageIssue[] = [];
  const checked: string[] = [];
  for (const [key, issue] of loaded) {
    const apiVersion = deriveTargetVersion(issue);
    const transition = await d.getTransition(key);
    if (!apiVersion) { skipped.push({ key, reason: 'no target version on the work item' }); continue; }
    if (!transition) { skipped.push({ key, reason: 'no status change recorded' }); continue; }
    const workItem: WorkItem = { ...issue, apiVersion, statusChangedAt: transition.at, statusChangedBy: transition.by, text: [issue.summary, issue.description].filter(Boolean).join('\n') };
    const cited = Object.fromEntries([...loaded].filter(([k, i]) => k !== key && i.status).map(([k, i]) => [k, { status: i.status }]));
    checked.push(key);
    for (const f of check({ workItem, page, siblings: [page], cited }).findings) {
      if (f.severity === 'info') continue;
      issues.push({ ruleId: f.ruleId, rule: ruleName(f.ruleId), severity: f.severity, summary: f.summary, key });
    }
  }
  return issues.length ? { status: 'issues', issues, checked, skipped } : checked.length ? { status: 'clean', checked, skipped } : { status: 'unchecked', reason: skipped.map((s) => `${s.key}: ${s.reason}`).join('; ') || 'nothing to compare' };
}

/** The byline title for a result. */
export function bylineTitle(r: PageCheck | { status: 'error' }): string {
  if (r.status === 'issues') return `Same Page: ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'}`;
  if (r.status === 'clean') return 'Same Page: no issues';
  if (r.status === 'unchecked') return 'Same Page: not checked';
  return 'Same Page: could not check';
}
