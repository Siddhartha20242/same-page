import { checkIssue, buildReport, cached } from './release';
import type { IssueDeps, ItemResult, Report } from './release';
import type { Issue } from './types';

export interface Job { pending: string[]; items: ItemResult[]; batches: number; retryAfterSec: number | null }
export type JobDeps = IssueDeps & { loadIssue: (key: string) => Promise<Issue> };
/** What Atlassian-call failures look like when they carry an HTTP status (see atlassianDeps). */
interface HttpError { status?: number; retryAfter?: number; message?: string }

// Large releases under Forge's limits. Checked against the docs (2026-10-31):
//   async consumers and scheduled triggers can run up to 900 s (default 55 s; set timeoutSeconds), but panel/action
//   invocations are capped at about 55 s, and egress is about 100 requests per runtime-minute (it scales with the timeout).
// So a release is processed in batches, each stopping before it spends its time OR request budget, with progress carried in
// a small serialisable job (issue keys, not issue bodies). A 429 stops the batch to be retried later; it never fails the run.

export const worstCaseRequests = (maxPages = 5): number => 1 /* load issue */ + 3 /* transition, remote links, search */ + 2 * maxPages /* body + labels per page */;

export const createJob = (keys: string[]): Job => ({ pending: [...keys], items: [], batches: 0, retryAfterSec: null });

/** Issues checked at the same time. Small, so the 100-requests-per-minute egress limit is still respected by the budget above. */
export const CONCURRENCY = 3;

const COUNTED: Record<string, number> = { loadIssue: 1, getTransition: 1, getRemoteLinkIds: 1, searchPages: 1, getPageBody: 2 };   // weight = HTTP requests per call

export async function runBatch(job: Job, deps: JobDeps, { maxMs = 45000, maxRequests = 90, now = Date.now, concurrency = CONCURRENCY }: { maxMs?: number; maxRequests?: number; now?: () => number; concurrency?: number } = {}): Promise<{ job: Job; done: boolean; requests: number }> {
  const start = now();
  let requests = 0;
  // Wrapping arbitrary dependency functions by name is dynamic, so this one record is `any` at the wrapper boundary.
  const source = deps as unknown as Record<string, (...a: unknown[]) => unknown>;
  const counted: Record<string, any> = { ...deps }; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const [name, weight] of Object.entries(COUNTED)) {
    if (typeof source[name] === 'function') counted[name] = (...a: unknown[]) => { requests += weight; return (source[name] as (...a: unknown[]) => unknown)(...a); };
  }
  counted.getPageBody = counted.getPageBody && cached(counted.getPageBody); // cache sits above the counter: hits are free

  const next: Job = { ...job, pending: [...job.pending], items: [...job.items], batches: job.batches + 1, retryAfterSec: null };
  const worst = worstCaseRequests(deps.maxPages ?? 5);
  // Issues are checked a few at a time. Each one in a wave is admitted only if the request budget still covers its worst case, so a wave
  // can never spend more than the limit. A 429 keeps the rate-limited issue and every issue after it in the wave pending for the next
  // batch, and results are stored in the original order.
  while (next.pending.length) {
    if (now() - start >= maxMs) break;
    const room = Math.floor((maxRequests - requests) / worst);
    const size = Math.min(Math.max(1, concurrency), room, next.pending.length);
    if (size < 1) break;
    const wave = next.pending.slice(0, size);
    const settled = await Promise.allSettled(wave.map(async (key) => checkIssue(await counted.loadIssue(key), counted as JobDeps)));
    let done = 0, limited = false;
    for (let i = 0; i < wave.length; i++) {
      const r = settled[i] as PromiseSettledResult<ItemResult>;
      if (r.status === 'fulfilled') { next.items.push(r.value); done++; continue; }
      const e = r.reason as HttpError | null;
      if (e?.status === 429) { next.retryAfterSec = e.retryAfter ?? 60; limited = true; break; }
      next.items.push({ key: wave[i] as string, status: 'unchecked', reason: `could not be checked (${e?.message ?? 'error'})` });
      done++;
    }
    next.pending.splice(0, done);
    if (limited) break;
  }
  return { job: next, done: next.pending.length === 0, requests };
}

// `abandon: true` reports whatever was never reached as unchecked instead of silently dropping it.
export function finalizeJob(job: Job, { abandon = false }: { abandon?: boolean } = {}): Report {
  const items = [...job.items];
  if (abandon) for (const key of job.pending) items.push({ key, status: 'unchecked', reason: 'not reached before the time budget ran out' });
  return buildReport(items);
}

// Retry on HTTP 429, honouring Retry-After (seconds); everything else is rethrown immediately.
export interface BackoffOptions { retries?: number; sleep?: (ms: number) => Promise<unknown>; maxWaitMs?: number }

export async function withBackoff<T>(fn: () => Promise<T>, { retries = 3, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), maxWaitMs = 20000 }: BackoffOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (err) {
      const e = err as HttpError | null;
      if (e?.status !== 429 || attempt >= retries) throw err;
      await sleep(Math.min(maxWaitMs, e.retryAfter ? e.retryAfter * 1000 : 1000 * 2 ** attempt));
    }
  }
}
export const rateLimited = <D extends Record<string, unknown>>(deps: D, opts?: BackoffOptions): D =>
  Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, typeof v === 'function' ? (...a: unknown[]) => withBackoff(() => (v as (...a: unknown[]) => Promise<unknown>)(...a), opts) : v])) as D;
