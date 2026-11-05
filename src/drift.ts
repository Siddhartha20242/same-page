import { createJob, runBatch } from './job.ts';
import { buildOverview } from './overview.ts';
import type { OverviewRow } from './overview.ts';
import type { JobDeps } from './job.ts';

// Scheduled drift scan. Once a week the app checks the site's open epics the same way the overview does, and keeps a small summary
// per project: how many items have contradictions now, and how many are new since the previous scan. Counts and work item keys only,
// no page text or titles. It reads as the app, so it sees what the app can see; the overview page still checks as the viewer.

export const DRIFT_KEY = 'drift:last';
export const DRIFT_JQL = 'statusCategory != Done AND issuetype = Epic ORDER BY updated DESC';
const MAX_ITEMS = 20;

export interface ProjectDrift { withContradictions: number; checked: number; newSincePrevious: number; resolvedSincePrevious?: number; keys: string[] }
export interface DriftSnapshot { at: string; projects: Record<string, ProjectDrift>; scanned: number; notChecked: number }
export interface DriftStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
export interface DriftDeps extends JobDeps { searchIssues: (jql: string, limit: number) => Promise<{ key: string; summary?: string }[]> }

const projectOf = (key: string) => key.split('-')[0] ?? key;

export async function runDriftScan(deps: DriftDeps, store: DriftStore, now: () => number = Date.now): Promise<DriftSnapshot> {
  const issues = (await deps.searchIssues(DRIFT_JQL, MAX_ITEMS)).slice(0, MAX_ITEMS);
  const out = await runBatch(createJob(issues.map((i) => i.key)), deps, { maxMs: 40000, maxRequests: 80 });
  const rows: OverviewRow[] = buildOverview({ issues, job: out.job }).rows;
  const previous = (await store.get(DRIFT_KEY).catch(() => null)) as DriftSnapshot | null;
  const projects: Record<string, ProjectDrift> = {};
  for (const r of rows) {
    const p = (projects[projectOf(r.key)] ??= { withContradictions: 0, checked: 0, newSincePrevious: 0, resolvedSincePrevious: 0, keys: [] });
    if (r.verdict === 'Not checked') continue;
    p.checked++;
    if (r.verdict === 'Blocked' || r.verdict === 'Warning') {
      p.withContradictions++;
      p.keys.push(r.key);
      if (!previous?.projects[projectOf(r.key)]?.keys.includes(r.key)) p.newSincePrevious++;
    }
  }
  // Resolved: contradicting at the last scan, and now checked without one. An item that could not be checked this time is not counted as resolved.
  const checkedNow = new Set(rows.filter((r) => r.verdict !== 'Not checked').map((r) => r.key));
  for (const [proj, prev] of Object.entries(previous?.projects ?? {})) {
    const p = projects[proj];
    if (p) p.resolvedSincePrevious = prev.keys.filter((k) => checkedNow.has(k) && !p.keys.includes(k)).length;
  }
  const snap: DriftSnapshot = { at: new Date(now()).toISOString(), projects, scanned: rows.length, notChecked: rows.filter((r) => r.verdict === 'Not checked').length };
  await store.set(DRIFT_KEY, snap);
  return snap;
}

export async function loadDrift(store: DriftStore, projectKey: string): Promise<{ at: string; project: ProjectDrift | null } | null> {
  try {
    const s = (await store.get(DRIFT_KEY)) as DriftSnapshot | null;
    return s?.at ? { at: s.at, project: s.projects?.[projectKey] ?? null } : null;
  } catch { return null; }
}
