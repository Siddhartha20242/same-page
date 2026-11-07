import { check } from './engine.ts';
import { deriveTargetVersion } from './adapters.ts';
import { rankCandidates } from './candidates.ts';
import { verifyChain } from './ledger.ts';
import type { LedgerEntry } from './ledger.ts';
import type { CandidatePage } from './candidates.ts';
import { isClosedStatus } from './rules.ts';
import type { Finding, Issue, Page, Rule, VersionSource, WorkItem } from './types.ts';

/** What getPageBody may return: plain text, or text plus real metadata. Null when the viewer cannot read the page. */
export type PageBody = string | { text: string; modifiedAt?: string; labels?: string[]; title?: string; lastEditorId?: string | null };

/** The Atlassian access the release flow needs. Injected, so it runs against fakes in tests. */
export interface IssueDeps {
  loadIssue?: (key: string) => Promise<Issue>;
  getTransition: (key: string) => Promise<{ at: string; by: string | null } | null>;
  getRemoteLinkIds: (key: string) => Promise<string[]>;
  searchPages: (issue: Issue) => Promise<CandidatePage[]>;
  getPageBody?: (id: string | number) => Promise<PageBody | null>;
  rules?: Rule[];
  maxPages?: number;
  versionSources?: VersionSource[];
  pinnedIds?: (string | number)[];
}

export interface ItemResult {
  key: string;
  summary?: string;
  status: 'unchecked' | 'findings' | 'notes' | 'clean';
  reason?: string;
  findings?: Finding[];
  pagesChecked?: number;
  workItem?: WorkItem;
  pages?: Page[];
  /** Rules that could not run on this work item, with the reason. A result is never presented as a full check when some rules were skipped. */
  skippedRules?: string[];
}

export interface Report {
  verdict: 'ATTENTION' | 'REVIEW' | 'NO CONTRADICTIONS FOUND';
  coverage: { checked: number; total: number };
  complete: boolean;
  counts: { findings: number; blockers: number; notes: number };
  items: ItemResult[];
}

export interface ReleaseRecord { version: string; at: string; verdict: Report['verdict']; coverage: Report['coverage']; findings: number; ledgerLength: number; ledgerHead: string }

// Release readiness: every issue in a version, checked against its related docs.
// The report states what it could NOT check. A clean list that hides unchecked issues would be a false comfort.
// Trigger: avi:jira:released:version fires AFTER release, so this produces a report; it cannot block a release.
// A pre-release "Run release check" button calls the same function.

// Memoise by argument so a runbook linked from 20 issues is fetched once.
export function cached<A, R>(fn: (arg: A) => R): (arg: A) => R {
  const memo = new Map<A, R>();
  return (arg: A) => { if (!memo.has(arg)) memo.set(arg, fn(arg)); return memo.get(arg) as R; };
}

// Statuses of the other tickets the loaded pages mention (rule R6). At most 5 extra reads, and any failure just leaves that ticket out.
// R6 only looks at closed tickets, so a ticket's closing time (a changelog read) is fetched only for those, and the tickets are read in parallel.
const TICKET_KEY = /(?<![A-Za-z0-9-])[A-Z][A-Z0-9_]+-\d+(?![0-9])/g;
export async function loadCited(own: string, pages: Page[], loadIssue?: (key: string) => Promise<Issue>, getTransition?: IssueDeps['getTransition']): Promise<Record<string, { status: string; changedAt?: string }> | undefined> {
  if (!loadIssue) return undefined;
  const keys = [...new Set(pages.flatMap((p) => p.text.match(TICKET_KEY) ?? []))].filter((k) => k !== own).slice(0, 5);
  const rows = await Promise.all(keys.map(async (k): Promise<[string, { status: string; changedAt?: string }] | null> => {
    try {
      const i = await loadIssue(k);
      if (!i?.status) return null;
      const changedAt = isClosedStatus(i.status) ? await getTransition?.(k).then((t) => t?.at, () => undefined) : undefined;   // unknown just means R6 cannot use the edit-time test
      return [k, { status: i.status, ...(changedAt ? { changedAt } : {}) }];
    } catch { return null; /* unreadable or missing: skip */ }
  }));
  return Object.fromEntries(rows.filter((r): r is [string, { status: string; changedAt?: string }] => r !== null));
}

// One issue. Two-stage discovery keeps API use low: `searchPages` returns light metadata (an excerpt in `text`),
// ranking runs on that, and `getPageBody` (null when the viewer cannot read it) is called only for the top few.
export async function checkIssue(issue: Issue, { loadIssue, getTransition, getRemoteLinkIds, searchPages, getPageBody, rules, maxPages = 5, versionSources, pinnedIds = [] }: IssueDeps): Promise<ItemResult> {
  const base = { key: issue.key, summary: issue.summary };
  const apiVersion = deriveTargetVersion(issue, versionSources ? { sources: versionSources } : undefined);
  // A missing target version or status change no longer stops the check: only the rules that need them are skipped, and the result says so.
  const transition = await getTransition(issue.key).catch((e: unknown) => { if ((e as { status?: number } | null)?.status === 404) return null; throw e; });   // 429 and consent errors still propagate
  const skippedRules: string[] = [];
  if (!transition) skippedRules.push('R1 stale version and R4 stale status claim (no status change recorded yet)');
  else if (!apiVersion) skippedRules.push('R1 stale version (this work item names no target version)');
  const remoteLinkIds = await getRemoteLinkIds(issue.key);
  const found = await searchPages(issue);
  // A page linked from the issue must be considered even if the search did not return it.
  const stubs = getPageBody ? remoteLinkIds.filter((id) => !found.some((p) => String(p.id) === String(id))).map((id) => ({ id: String(id), title: '(linked page)', text: '', labels: [] })) : [];
  const ranked = rankCandidates(issue, [...found, ...stubs], { remoteLinkIds, pinnedIds, limit: maxPages });
  if (!ranked.length) return { ...base, status: 'unchecked', reason: 'no related Confluence page found' };
  const loaded: { c: (typeof ranked)[number]; page: Page }[] = [];
  for (const c of ranked) {
    if (!getPageBody) { loaded.push({ c, page: c.page as Page }); continue; }
    const body = await getPageBody(c.page.id);              // string, or { text, modifiedAt, labels, title }; null if unreadable
    if (body == null) continue;
    loaded.push({ c, page: { ...c.page, ...(typeof body === 'string' ? { text: body } : body) } as Page });
  }
  if (!loaded.length) return { ...base, status: 'unchecked', reason: 'related page(s) found but not readable with your permissions' };
  const workItem: WorkItem = { ...issue, apiVersion, statusChangedAt: transition?.at, statusChangedBy: transition?.by, text: [issue.summary, issue.description].filter(Boolean).join('\n') };
  const siblings = loaded.map((l) => l.page);
  const cited = await loadCited(issue.key, siblings, loadIssue, getTransition);                  // lets a rule compare a doc with another loaded artifact, such as an API spec
  const findings = loaded.flatMap(({ c, page }) => check({ workItem, page, siblings, cited }, rules).findings
    .map((f) => ({ ...f, pageId: page.id, pageTitle: page.title, foundBecause: c.reasons })));
  const real = findings.filter((f) => f.severity !== 'info');
  const out: ItemResult = real.length
    ? { ...base, status: 'findings', findings }
    : findings.length
      ? { ...base, status: 'notes', findings, pagesChecked: loaded.length }
      : { ...base, status: 'clean', pagesChecked: loaded.length };
  return { ...out, workItem, pages: loaded.map(({ page }) => page), ...(skippedRules.length ? { skippedRules } : {}) };
}

// Everything in one go: fine for small releases and tests. Large releases use job.js (batches under a time and request budget).
export async function checkRelease(deps: IssueDeps & { issues: Issue[] }): Promise<Report> {
  const run = { ...deps, getPageBody: deps.getPageBody && cached(deps.getPageBody) };
  const items: ItemResult[] = [];
  for (const issue of deps.issues) items.push(await checkIssue(issue, run));
  return buildReport(items);
}

export function buildReport(items: ItemResult[]): Report {
  const checked = items.filter((i) => i.status !== 'unchecked').length;
  const all = items.flatMap((i) => i.findings || []);
  const findings = all.filter((f) => f.severity !== 'info');
  return {
    verdict: findings.some((f) => f.severity === 'block') ? 'ATTENTION' : findings.length ? 'REVIEW' : 'NO CONTRADICTIONS FOUND',
    coverage: { checked, total: items.length },
    complete: checked === items.length,
    counts: { findings: findings.length, blockers: findings.filter((f) => f.severity === 'block').length, notes: all.length - findings.length },
    items,
  };
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] as string);

// Confluence storage-format body for the single report page. All text is escaped.
export function renderReportHtml(report: Report, { version }: { version: string }): string {
  const rows = report.items.map((i) => {
    if (i.status === 'findings' || i.status === 'notes') return (i.findings ?? []).map((f) => `<tr><td>${esc(i.key)}</td><td>${esc(f.severity === 'info' ? 'NOTE' : f.ruleId)}</td><td>${esc(f.summary)}</td><td>${esc(f.why)}</td><td>${esc(f.pageTitle)}</td></tr>`).join('');
    if (i.status === 'unchecked') return `<tr><td>${esc(i.key)}</td><td>UNCHECKED</td><td>${esc(i.reason)}</td><td></td><td></td></tr>`;
    return `<tr><td>${esc(i.key)}</td><td>clean</td><td>${i.pagesChecked} page(s) checked</td><td></td><td></td></tr>`;
  }).join('');
  return `<h2>Release ${esc(version)}: ${esc(report.verdict)}</h2>` +
    `<p>Coverage: ${report.coverage.checked} of ${report.coverage.total} issues checked${report.complete ? '' : ' (unchecked issues are listed below, not assumed fine)'}.` +
    `${report.counts.notes ? ` ${report.counts.notes} note(s) on wording that may be intentional history.` : ''}</p>` +
    `<table><tr><th>Issue</th><th>Result</th><th>Detail</th><th>Why it matters</th><th>Page</th></tr>${rows}</table>`;
}

// ---- release record, anchored outside app storage ----
export function releaseRecord({ version, report, chain, at = new Date().toISOString() }: { version: string; report: Report; chain: LedgerEntry[]; at?: string }): ReleaseRecord {
  const v = verifyChain(chain);
  if (!v.ok) throw new Error(`ledger does not verify (${v.reason}); refusing to record`);
  return { version, at, verdict: report.verdict, coverage: report.coverage, findings: report.counts.findings, ledgerLength: chain.length, ledgerHead: v.head };
}

// The line to post to the Jira version and the report page: a copy of the head hash that app storage can't alter.
export const anchorLine = (r: ReleaseRecord) =>
  `Same Page record for ${r.version}: ${r.verdict}; ${r.findings} finding(s); coverage ${r.coverage.checked}/${r.coverage.total}; ledger ${r.ledgerLength} entries @ ${r.ledgerHead}`;

// Later, compare stored history against the anchor. Catches a whole-chain rewrite that internal hashes alone cannot.
export function verifyAnchor(chain: LedgerEntry[], record: ReleaseRecord): { ok: true } | { ok: false; reason: string } {
  const v = verifyChain(chain);
  if (!v.ok) return { ok: false, reason: `ledger invalid: ${v.reason} at entry ${v.brokenAt}` };
  if (chain.length < record.ledgerLength) return { ok: false, reason: 'history was shortened since the anchor' };
  const headAtAnchor = record.ledgerLength === 0 ? '0'.repeat(64) : (chain[record.ledgerLength - 1] as LedgerEntry).entryHash;
  return headAtAnchor === record.ledgerHead ? { ok: true } : { ok: false, reason: 'history was rewritten since the anchor' };
}
