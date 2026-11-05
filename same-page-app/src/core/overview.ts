import { createJob, runBatch } from './job';
import type { Job, JobDeps } from './job';
import type { ItemResult } from './release';

// Project overview: the open epics and in-progress work items of one project, each checked with the same logic as the issue panel,
// under the same time and request budgets as job.ts. Read-only. It says what it could not check and why; it never calls an unchecked item clean.

export const MAX_ITEMS = 20;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]*$/;

/** JQL for the items to check, newest activity first. Null when the project key is not a plain key (it goes into a query, so it is validated). */
export function overviewJql(projectKey: unknown): string | null {
  const k = String(projectKey ?? '');
  return PROJECT_KEY.test(k) ? `project = "${k}" AND statusCategory != Done AND (issuetype = Epic OR statusCategory = "In Progress") ORDER BY updated DESC` : null;
}

export type RowVerdict = 'Blocked' | 'Warning' | 'Clean' | 'Not checked';
export interface OverviewRow { key: string; summary: string; verdict: RowVerdict; findings: number; reason?: string; notes?: number }
export interface Overview {
  status: 'ready';
  rows: OverviewRow[];
  /** Items fetched from Jira (at most MAX_ITEMS), and whether the project has more than that. */
  total: number; moreExist: boolean;
  /** Items the run got to before a budget ran out. */
  attempted: number;
  checked: number; withContradictions: number; unchecked: number;
  reasons: { reason: string; count: number }[];
  summaryLine: string;
  coverageLine: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The reason shown when the run stopped before reaching an item. */
const NOT_REACHED = 'not reached before the time or request budget ran out; use Check again';

/** Turns the finished (possibly partial) job into rows and honest summary lines. `issues` are the fetched items, in order. */
export function buildOverview({ issues, job, moreExist = false }: { issues: { key: string; summary?: string }[]; job: Job; moreExist?: boolean }): Overview {
  const byKey = new Map<string, ItemResult>(job.items.map((i) => [i.key, i]));
  const rows: OverviewRow[] = issues.map((issue) => {
    const r = byKey.get(issue.key);
    const summary = r?.summary ?? issue.summary ?? '';
    if (!r) return { key: issue.key, summary, verdict: 'Not checked', findings: 0, reason: job.retryAfterSec ? `Atlassian rate limited the app; try again in about ${job.retryAfterSec} seconds` : NOT_REACHED };
    if (r.status === 'unchecked') return { key: issue.key, summary, verdict: 'Not checked', findings: 0, reason: r.reason ?? 'could not be checked' };
    const real = (r.findings ?? []).filter((f) => f.severity !== 'info');
    const notes = (r.findings ?? []).length - real.length;
    const verdict: RowVerdict = real.some((f) => f.severity === 'block') ? 'Blocked' : real.length ? 'Warning' : 'Clean';
    return { key: issue.key, summary, verdict, findings: real.length, ...(notes ? { notes } : {}) };
  });
  const unchecked = rows.filter((r) => r.verdict === 'Not checked');
  const checked = rows.length - unchecked.length;
  const withContradictions = rows.filter((r) => r.verdict === 'Blocked' || r.verdict === 'Warning').length;
  const counts = new Map<string, number>();
  for (const r of unchecked) counts.set(r.reason as string, (counts.get(r.reason as string) ?? 0) + 1);
  const reasons = [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  const attempted = job.items.length;

  let summaryLine: string;
  if (!rows.length) summaryLine = 'No open epics or in-progress work items found in this project (or none you can see).';
  else {
    summaryLine = `${withContradictions} of ${plural(checked, 'checked item')} ${withContradictions === 1 ? 'has' : 'have'} contradictions`;
    summaryLine += unchecked.length ? `; ${unchecked.length} could not be checked: ${reasons.map((r) => (r.count > 1 ? `${r.reason} (${r.count})` : r.reason)).join('; ')}.` : '.';
  }
  const budgetCut = job.pending.length > 0;
  const coverageLine = budgetCut
    ? `Checked the first ${attempted} of ${rows.length} items before the budget ran out.${moreExist ? ` The project has more than ${MAX_ITEMS} open items; only the ${MAX_ITEMS} most recently updated are listed.` : ''}`
    : moreExist ? `The project has more than ${MAX_ITEMS} open items; only the ${MAX_ITEMS} most recently updated are listed and checked.` : null;
  return { status: 'ready', rows, total: rows.length, moreExist, attempted, checked, withContradictions, unchecked: unchecked.length, reasons, summaryLine, coverageLine };
}

export interface OverviewDeps extends JobDeps {
  /** Runs the JQL as the viewer; returns at most `limit` items. */
  searchIssues: (jql: string, limit: number) => Promise<{ key: string; summary?: string }[]>;
}

/** The whole overview for one project. Throws if the search itself fails; per-item failures become "Not checked" rows. */
export async function runOverview(projectKey: unknown, deps: OverviewDeps, budget: { maxMs?: number; maxRequests?: number; now?: () => number } = {}): Promise<Overview | { status: 'error'; message: string }> {
  const jql = overviewJql(projectKey);
  if (!jql) return { status: 'error', message: 'This page must be opened from a Jira project.' };
  const found = await deps.searchIssues(jql, MAX_ITEMS + 1);      // one extra row tells us the project has more than the cap
  const issues = found.slice(0, MAX_ITEMS);
  const out = await runBatch(createJob(issues.map((i) => i.key)), deps, { maxMs: 20000, maxRequests: 60, ...budget });
  return buildOverview({ issues, job: out.job, moreExist: found.length > MAX_ITEMS });
}
