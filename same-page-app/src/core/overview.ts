import { createJob, runBatch } from './job';
import type { RowVerdict } from './verdictOrder';
import type { Job, JobDeps } from './job';
import type { ItemResult } from './release';

// Project overview: the open epics and in-progress work items of one project, each checked with the same logic as the issue panel,
// under the same time and request budgets as job.ts. Read-only. It says what it could not check and why; it never calls an unchecked item clean.

export const MAX_ITEMS = 20;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]*$/;

/** Fix version names that may go into a query. Strict on purpose: the name is placed inside double quotes in JQL, so no quote, backslash or operator can get in. */
export const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/;
const cleanVersion = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

/** JQL for the items to check, newest activity first. Null when the project key (or the fix version, when one is given) is not plain: both go into a query, so they are validated.
 *  With a fix version it is every open work item in that release; without one it is the project's open epics and in-progress items. */
export function overviewJql(projectKey: unknown, fixVersion?: unknown): string | null {
  const k = String(projectKey ?? '');
  if (!PROJECT_KEY.test(k)) return null;
  const v = cleanVersion(fixVersion);
  if (v !== null) return VERSION_RE.test(v) ? `project = "${k}" AND fixVersion = "${v}" AND statusCategory != Done ORDER BY updated DESC` : null;
  return `project = "${k}" AND statusCategory != Done AND (issuetype = Epic OR statusCategory = "In Progress") ORDER BY updated DESC`;
}

export type { RowVerdict } from './verdictOrder';
export { bySeverity } from './verdictOrder';
export interface OverviewRow { key: string; summary: string; verdict: RowVerdict; findings: number; reason?: string; notes?: number; /** The most serious finding in one short line, so the table says what is wrong without opening the item. */ headline?: string }
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
  /** The fix version this run was limited to, when the caller named one. */
  fixVersion?: string;
  /** Items the run did not get to; Check the rest continues with them. */
  remaining: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One short plain line: no control characters, no backticks, no line breaks, capped. */
export const oneLine = (v: unknown, max = 160): string => String(v ?? '').replace(/[\u0000-\u001f\u007f`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The reason shown when the run stopped before reaching an item. */
const NOT_REACHED = 'not reached before the time or request budget ran out; use Check the rest';
const RATE_LIMITED = 'Atlassian rate limited the app';
/** A row that was decided, as opposed to one the run never got to. Only decided rows are carried into a continued run. */
const isUndecided = (r: OverviewRow) => r.verdict === 'Not checked' && (r.reason === NOT_REACHED || (r.reason ?? '').startsWith(RATE_LIMITED));

/** Turns the finished (possibly partial) job into rows and honest summary lines. `issues` are the fetched items, in order. */
export function buildOverview({ issues, job, moreExist = false, carried = [], fixVersion }: { issues: { key: string; summary?: string }[]; job: Job; moreExist?: boolean; carried?: OverviewRow[]; fixVersion?: string }): Overview {
  const carriedByKey = new Map(carried.map((r) => [r.key, r]));
  const byKey = new Map<string, ItemResult>(job.items.map((i) => [i.key, i]));
  const rows: OverviewRow[] = issues.map((issue) => {
    const kept = carriedByKey.get(issue.key);
    if (kept) return kept;
    const r = byKey.get(issue.key);
    const summary = r?.summary ?? issue.summary ?? '';
    if (!r) return { key: issue.key, summary, verdict: 'Not checked', findings: 0, reason: job.retryAfterSec ? `${RATE_LIMITED}; try again in about ${job.retryAfterSec} seconds` : NOT_REACHED };
    if (r.status === 'unchecked') return { key: issue.key, summary, verdict: 'Not checked', findings: 0, reason: r.reason ?? 'could not be checked' };
    const real = (r.findings ?? []).filter((f) => f.severity !== 'info');
    const notes = (r.findings ?? []).length - real.length;
    const verdict: RowVerdict = real.some((f) => f.severity === 'block') ? 'Blocked' : real.length ? 'Warning' : 'Clean';
    const top = real.find((f) => f.severity === 'block') ?? real[0];
    const headline = top ? oneLine(top.summary) : '';
    return { key: issue.key, summary, verdict, findings: real.length, ...(notes ? { notes } : {}), ...(headline ? { headline } : {}) };
  });
  const unchecked = rows.filter((r) => r.verdict === 'Not checked');
  const checked = rows.length - unchecked.length;
  const withContradictions = rows.filter((r) => r.verdict === 'Blocked' || r.verdict === 'Warning').length;
  const counts = new Map<string, number>();
  for (const r of unchecked) counts.set(r.reason as string, (counts.get(r.reason as string) ?? 0) + 1);
  const reasons = [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  const attempted = job.items.length + rows.filter((r) => carriedByKey.has(r.key)).length;

  let summaryLine: string;
  if (!rows.length) summaryLine = fixVersion ? `No open work items found in fix version "${fixVersion}" of this project (or none you can see).` : 'No open epics or in-progress work items found in this project (or none you can see).';
  else {
    summaryLine = `${withContradictions} of ${plural(checked, 'checked item')} ${withContradictions === 1 ? 'has' : 'have'} contradictions`;
    summaryLine += unchecked.length ? `; ${unchecked.length} could not be checked: ${reasons.map((r) => (r.count > 1 ? `${r.reason} (${r.count})` : r.reason)).join('; ')}.` : '.';
  }
  const budgetCut = job.pending.length > 0;
  const coverageLine = budgetCut
    ? `Checked the first ${attempted} of ${rows.length} items before the budget ran out.${moreExist ? ` The project has more than ${MAX_ITEMS} open items; only the ${MAX_ITEMS} most recently updated are listed.` : ''}`
    : moreExist ? `The project has more than ${MAX_ITEMS} open items; only the ${MAX_ITEMS} most recently updated are listed and checked.` : null;
  return { status: 'ready', rows, total: rows.length, moreExist, attempted, checked, withContradictions, unchecked: unchecked.length, reasons, summaryLine, coverageLine, remaining: job.pending.length };
}

export interface OverviewDeps extends JobDeps {
  /** Runs the JQL as the viewer; returns at most `limit` items. */
  searchIssues: (jql: string, limit: number) => Promise<{ key: string; summary?: string }[]>;
}

const ROW_KEY = /^[A-Z][A-Z0-9_]*-\d{1,9}$/;
const VERDICTS = new Set<RowVerdict>(['Blocked', 'Warning', 'Clean', 'Not checked']);
const clip = (v: unknown, n: number) => String(v ?? '').slice(0, n);
/** Rows sent back by the page to continue a run. The page is the viewer's own, so these only shape what the viewer sees, but they are still checked
 *  for shape and size, and only rows that were really decided (not "not reached") are kept. */
export function sanitizeCarried(input: unknown): OverviewRow[] {
  if (!Array.isArray(input)) return [];
  const out: OverviewRow[] = [];
  for (const raw of input.slice(0, MAX_ITEMS)) {
    const r = raw as Partial<OverviewRow> | null;
    if (!r || typeof r.key !== 'string' || !ROW_KEY.test(r.key) || !VERDICTS.has(r.verdict as RowVerdict)) continue;
    const row: OverviewRow = { key: r.key, summary: clip(r.summary, 300), verdict: r.verdict as RowVerdict, findings: Math.max(0, Math.min(99, Number(r.findings) || 0)) };
    if (r.reason) row.reason = clip(r.reason, 300);
    if (r.notes) row.notes = Math.max(0, Math.min(99, Number(r.notes) || 0));
    if (r.headline) row.headline = oneLine(r.headline);
    if (!isUndecided(row)) out.push(row);
  }
  return out;
}

/** The whole overview for one project, or for one fix version of it when `fixVersion` is given. Throws if the search itself fails (except a version Jira does not accept,
 *  which comes back as an error result); per-item failures become "Not checked" rows.
 *  `carried` are rows already decided in an earlier run: they are kept as they are and only the other items are checked, so Check the rest can finish a project one budget at a time. */
export async function runOverview(projectKey: unknown, deps: OverviewDeps, budget: { maxMs?: number; maxRequests?: number; now?: () => number } = {}, carried: OverviewRow[] = [], fixVersion?: string): Promise<Overview | { status: 'error'; message: string }> {
  const version = cleanVersion(fixVersion);
  if (version !== null && !VERSION_RE.test(version)) return { status: 'error', message: 'A fix version name may contain only letters, digits, spaces, dots, hyphens and underscores (up to 60 characters).' };
  const jql = overviewJql(projectKey, version);
  if (!jql) return { status: 'error', message: 'This page must be opened from a Jira project.' };
  let found: { key: string; summary?: string }[];
  try { found = await deps.searchIssues(jql, MAX_ITEMS + 1); }      // one extra row tells us the project has more than the cap
  catch (e) {
    // Jira answers 400 when a fix version does not exist in the project (or the caller cannot see it); say that instead of failing the whole call.
    if (version !== null && (e as { status?: number } | null)?.status === 400) return { status: 'error', message: `Jira has no fix version "${version}" in project ${String(projectKey)} that you can see. Check the exact version name.` };
    throw e;
  }
  const issues = found.slice(0, MAX_ITEMS);
  const done = new Set(carried.map((r) => r.key));
  const keep = carried.filter((r) => issues.some((i) => i.key === r.key));
  const todo = issues.filter((i) => !done.has(i.key)).map((i) => i.key);
  const out = await runBatch(createJob(todo), deps, { maxMs: 20000, maxRequests: 60, ...budget });
  const ov = buildOverview({ issues, job: out.job, moreExist: found.length > MAX_ITEMS, carried: keep, ...(version !== null ? { fixVersion: version } : {}) });
  return version !== null ? { ...ov, fixVersion: version } : ov;
}

