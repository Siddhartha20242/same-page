import { checkIssue, cached } from './release';
import { ticketFactsOf } from './factRules';
import { proposeFix } from './propose';
import { refsInLine } from './rules';
import { fingerprint } from './triage';
import type { Finding, Issue, Page, Rule, Severity, Verdict, WorkItem } from './types';
import type { Llm } from './propose';
import type { AtlassianDeps } from './atlassianDeps';
import type { PanelFinding } from './reviewTask';
import type { NoisyRule } from './triage';

export type { PanelFinding, NoisyRule };

/** A character range inside a line the panel shows, so it can draw the stale (or fixed) token highlighted. */
export interface Span { start: number; end: number }

/** The fix shown under a finding: either a verified edit or the reason there is none. */
export interface Suggestion {
  before?: string; after?: string; method?: 'deterministic' | 'llm'; note?: string;
  pageId?: string; line?: number; target?: string;
  /** Up to three lines of the page above and below the line, so the approver can see where the edit lands without opening the page. */
  context?: { before: string[]; after: string[] };
  beforeHighlight?: Span; afterHighlight?: Span;
  unavailable?: string;
}

/** The first version reference in `line` for which `want(version)` holds, as a span. */
const spanOf = (line: string | undefined, want: (version: string) => boolean): Span | undefined => {
  const r = line ? refsInLine(line).find((x) => want(x.version)) : undefined;
  return r ? { start: r.index, end: r.index + r.text.length } : undefined;
};

export type PanelModel =
  | { issueKey: string; status: 'unchecked'; reason: string; message?: undefined }
  | { issueKey: string; status: 'clean'; pagesChecked: number; pageTitles?: string[]; readFromTicket?: string[]; hidden?: number; skippedRules?: string[] }
  | { issueKey: string; status: 'findings' | 'notes'; verdict: Verdict; pagesChecked: number; pageTitles?: string[]; readFromTicket?: string[]; findings: PanelFinding[]; notes: PanelFinding[]; hidden?: number; noisyRules?: NoisyRule[]; skippedRules?: string[]; override?: { until: string; reason: string } }
  | { issueKey?: string; status: 'error'; message: string };

/** What buildPanelModel needs from Atlassian (and from fakes in tests). */
export type PanelDeps = Pick<AtlassianDeps, 'loadIssue' | 'getTransition' | 'getRemoteLinkIds' | 'searchPages' | 'getPageBody'> & { /** The rules to run. Defaults to the built-in rules; the app passes them plus the site's custom rules. */ rules?: Rule[] };

// The slice of an issue check this module reads. checkIssue (release.ts) returns a superset.
interface IssueCheck {
  status: 'unchecked' | 'clean' | 'notes' | 'findings';
  reason?: string; pagesChecked?: number;
  findings: Finding[]; pages: Page[]; workItem: WorkItem; skippedRules?: string[];
}

// What the issue panel shows for one issue. Pure data in, plain view model out, so the UI stays thin and this stays testable.
// Status: unchecked (with the reason), clean, notes (possible intentional history only), or findings.
// What the ticket side of the evidence says. Rules differ: R1 is about a target version, R2 about an active status, R3 about a missing field.
const ticketLine = (key: string, w?: { apiVersion?: string; status?: string; missingField?: string }) =>
  w?.apiVersion ? `${key} targets ${w.apiVersion}` : w?.missingField ? `${key} has no ${w.missingField}` : w?.status ? `${key} is ${w.status}` : `${key}`;

/** Up to three lines either side of line `line` (1-based), each cut to 200 characters. */
export function contextAround(text: string, line: number): { before: string[]; after: string[] } {
  const lines = text.split('\n').map((l) => l.slice(0, 200));
  return { before: lines.slice(Math.max(0, line - 4), Math.max(0, line - 1)), after: lines.slice(line, line + 3) };
}

export async function buildPanelModel(issueKey: string, deps: PanelDeps, { llm }: { llm?: Llm | null } = {}): Promise<PanelModel> {
  const run = { ...deps, getPageBody: deps.getPageBody && cached(deps.getPageBody) };
  const issue: Issue = await deps.loadIssue(issueKey);
  const item = (await checkIssue(issue, run as never)) as unknown as IssueCheck;
  if (item.status === 'unchecked') return { issueKey, status: 'unchecked', reason: item.reason ?? '' };
  const pageTitles = (item.pages ?? []).map((p) => String(p.title ?? '')).filter(Boolean).slice(0, 8);
  const readFromTicket = [...(item.workItem?.apiVersion ? [`target API version ${item.workItem.apiVersion}`] : []), ...ticketFactsOf(item.workItem?.text ?? '')].slice(0, 8);   // what was understood from the work item, shown so a person can see the checks' inputs
  if (item.status === 'clean') return { issueKey, status: 'clean', pagesChecked: item.pagesChecked ?? 0, pageTitles, ...(readFromTicket.length ? { readFromTicket } : {}), ...(item.skippedRules?.length ? { skippedRules: item.skippedRules } : {}) };

  const pageById: Record<string, Page> = Object.fromEntries(item.pages.map((p) => [String(p.id), p]));
  const view: PanelFinding[] = [];
  for (const f of item.findings) {
    const page = pageById[String(f.pageId)] as Page;
    let suggestion: Suggestion | null = null;
    const target = item.workItem.apiVersion;
    if (f.ruleId === 'R1_VERSION_MISMATCH' && f.severity !== 'info') {
      const p = await proposeFix({ finding: f, page, workItem: item.workItem, llm });
      suggestion = p.ok
        ? { before: p.before, after: p.after, method: p.method, note: p.note, pageId: p.pageId, line: p.line, target, context: contextAround(page.text, p.line), beforeHighlight: spanOf(p.before, (v) => v !== target), afterHighlight: spanOf(p.after, (v) => v === target) }
        : { unavailable: p.reason };
    }
    if (f.evidence.fact) {
      // For a number or a date Same Page cannot tell which side is right, so it never offers Apply: it names both ways to resolve it.
      const fact = f.evidence.fact;
      suggestion = { unavailable: `Same Page cannot tell which side is right. If the work item is right, change the page to say ${fact.ticketValue} instead of ${fact.pageValue}. If the page is right, update the work item.` };
    }
    const snippet = f.evidence.page?.snippet;
    const op = f.evidence.spec?.opText;
    const docHighlight = f.ruleId === 'R1_VERSION_MISMATCH' ? spanOf(snippet, (v) => v !== target)
      : op && snippet?.includes(op) ? { start: snippet.indexOf(op), end: snippet.indexOf(op) + op.length } : undefined;
    const spec = f.evidence.spec;
    const other = f.evidence.other;
    view.push({
      id: fingerprint(f), ruleId: f.ruleId, severity: f.severity, summary: f.summary, why: f.why, foundBecause: f.foundBecause,
      pageId: f.pageId, pageTitle: f.pageTitle, ...(other?.pageId ? { otherPageId: String(other.pageId) } : {}),
      evidence: { docLine: f.evidence.page?.snippet, docHighlight, moreStale: f.evidence.page?.moreStale, sourceLabel: other ? 'Other page says' : spec ? 'Spec says' : 'Jira says', docModifiedAt: f.evidence.page?.modifiedAt, ticket: f.evidence.fact ? `${issueKey} says: ${f.evidence.fact.ticketLine.slice(0, 200)}` : other ? `"${other.pageTitle ?? 'another page'}" says: ${other.snippet}` : f.evidence.cited ? `${f.evidence.cited.key} is ${f.evidence.cited.status} in Jira` : spec ? `The API spec "${spec.title ?? 'spec'}" ${spec.detail}` : ticketLine(issueKey, f.evidence.workItem), ticketChangedAt: f.evidence.workItem?.statusChangedAt, ticketChangedBy: f.evidence.workItem?.statusChangedBy ?? null },
      suggestion,
    });
  }
  const real = view.filter((v) => v.severity !== 'info');
  return {
    issueKey,
    status: real.length ? 'findings' : 'notes',
    verdict: real.some((v) => v.severity === 'block') ? 'BLOCKED' : real.length ? 'WARN' : 'PASS',
    pagesChecked: item.pages.length,
    pageTitles,
    ...(readFromTicket.length ? { readFromTicket } : {}),
    ...(item.skippedRules?.length ? { skippedRules: item.skippedRules } : {}),
    findings: real,
    notes: view.filter((v) => v.severity === 'info'),
  };
}
