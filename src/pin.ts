import { contentConflict } from './rules.ts';
import { deriveTargetVersion } from './adapters.ts';
import type { Issue } from './types.ts';

// Pin guard: once a person has fixed a page for a work item (Apply), the pair is "pinned". When that page is edited later, we re-check just
// that pair and say so on the work item if the old version came back. This is the continuous half of the idea: a fix that cannot quietly regress.
//
// It checks the page CONTENT against the target version and ignores the "page predates the status change" timing rule, because a regression
// IS an edit after the change. Detection stays deterministic; nothing is edited. The alert names no page text and no page title: anyone who can
// see the work item sees the comment, and not everyone who can see the work item can read the page.

export interface Pin { issues: string[] }
export interface PinStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }

const MAX_ISSUES_PER_PAGE = 20;
/** The Confluence content property that holds a page's pins. */
export const PIN_PROPERTY = 'same-page.pins';
const alertKey = (issueKey: string, pageId: string) => `pin:alerted:${issueKey}:${pageId}`;

/** The pins for a page with `issueKey` added (de-duplicated, capped). */
export function addPin(existing: unknown, issueKey: string): Pin {
  const issues = Array.isArray((existing as Pin | null)?.issues) ? [...(existing as Pin).issues] : [];
  if (!issues.includes(issueKey)) issues.push(issueKey);
  return { issues: issues.slice(-MAX_ISSUES_PER_PAGE) };
}

/** Does this page still (or again) name only a version other than the work item's target? Returns the stale reference, or null. */
export function regressionOn(issue: Issue, pageText: string): { version: string; target: string } | null {
  const target = deriveTargetVersion(issue);
  if (!target) return null;
  const hit = contentConflict(pageText, target);
  return hit && !hit.historical ? { version: hit.version, target } : null;
}

export const alertText = (issueKey: string, v: { version: string; target: string }) =>
  `Same Page: a page you fixed for ${issueKey} was edited and now documents ${v.version} again, but ${issueKey} targets ${v.target}. Open the Same Page panel on this work item for the evidence.`;

export interface PinDeps {
  /** This installation's own storage, used only to remember which regressions were already reported. */
  store: PinStore;
  /** Where the pins live. Forge storage is per installation and the page-updated event runs in the Confluence installation while Apply runs in
   *  Jira's, so pins are kept ON THE PAGE (a content property) where both sides can read them. */
  readPins: (pageId: string) => Promise<Pin | null>;
  loadIssue: (key: string) => Promise<Issue>;
  /** The page text, or null when it cannot be read. */
  loadPageText: (pageId: string) => Promise<string | null>;
  postComment: (issueKey: string, text: string) => Promise<void>;
  /** Called after each re-check so the caller can refresh any cache (the gate's snapshot). */
  onChecked?: (issueKey: string) => Promise<void>;
  /** Told why a pair could not be re-checked. */
  onError?: (issueKey: string, error: unknown) => void;
}

/** A pinned page was edited: re-check each pinned pair, and comment once per new regression. Never throws for one bad pair. */
export async function processPageUpdate(pageId: string, { store, readPins, loadIssue, loadPageText, postComment, onChecked, onError }: PinDeps): Promise<{ checked: number; alerted: number }> {
  const pin = await readPins(pageId);
  const issues = Array.isArray(pin?.issues) ? pin!.issues : [];
  let checked = 0; let alerted = 0;
  for (const issueKey of issues) {
    try {
      const text = await loadPageText(pageId);
      if (text === null) continue;
      checked++;
      const found = regressionOn(await loadIssue(issueKey), text);
      const was = await store.get(alertKey(issueKey, pageId));
      if (!found) { if (was) await store.set(alertKey(issueKey, pageId), null); }           // fixed again: the next regression alerts again
      else if (!was) { await postComment(issueKey, alertText(issueKey, found)); await store.set(alertKey(issueKey, pageId), `${found.version}->${found.target}`); alerted++; }
      if (onChecked) await onChecked(issueKey);
    } catch (e) { onError?.(issueKey, e); }      // one unreadable pair must not stop the others, but the reason must not vanish
  }
  return { checked, alerted };
}
