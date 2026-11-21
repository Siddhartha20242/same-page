import { check } from './engine';
import type { Page, Rule, WorkItem } from './types';

// "What if this work item targeted version N?" Runs the same rules twice over the same pages, once with the work item as it is and once
// with the proposed target version, and reports only the difference. Nothing is written anywhere. It is the same deterministic check
// as the panel (no model), pointed at a change that has not been made yet.
//
// Limits, stated so no one reads more into it: only the target version changes (the status and its date are kept as they are), and the
// closed-ticket rule (R6) is not part of the comparison because it needs live status of other tickets.

/** "v3", "V3", "3" and "3.1" all mean the major version "v3", the form the rules use. Anything else is refused. */
export function normalizeVersion(input: unknown): string | null {
  const m = /^\s*v?(\d{1,3})(?:\.\d+)*\s*$/i.exec(String(input ?? ''));
  return m ? `v${Number(m[1])}` : null;
}

export interface WhatIfRow { ruleId: string; pageId: string; pageTitle: string; line?: number; summary: string; snippet?: string }
export interface WhatIfResult {
  currentVersion: string | null; proposedVersion: string;
  wouldStartContradicting: WhatIfRow[]; wouldStopContradicting: WhatIfRow[]; stillContradicting: number; pagesChecked: number;
}

const rowsOf = (workItem: WorkItem, pages: Page[], rules?: Rule[]): Map<string, WhatIfRow> => {
  const out = new Map<string, WhatIfRow>();
  for (const page of pages) {
    for (const f of check({ workItem, page, siblings: pages }, rules).findings) {
      if (f.severity === 'info') continue;
      const key = `${f.ruleId}|${page.id}|${f.evidence.page?.line ?? ''}`;
      out.set(key, { ruleId: f.ruleId, pageId: page.id, pageTitle: page.title, line: f.evidence.page?.line, summary: f.summary, snippet: f.evidence.page?.snippet });
    }
  }
  return out;
};

export function whatIfVersion(item: { workItem: WorkItem; pages: Page[] }, proposed: string, rules?: Rule[]): WhatIfResult {
  const before = rowsOf(item.workItem, item.pages, rules);
  const after = rowsOf({ ...item.workItem, apiVersion: proposed }, item.pages, rules);
  const start = [...after].filter(([k]) => !before.has(k)).map(([, v]) => v);
  const stop = [...before].filter(([k]) => !after.has(k)).map(([, v]) => v);
  return {
    currentVersion: item.workItem.apiVersion ?? null, proposedVersion: proposed,
    wouldStartContradicting: start, wouldStopContradicting: stop,
    stillContradicting: [...after].filter(([k]) => before.has(k)).length, pagesChecked: item.pages.length,
  };
}
