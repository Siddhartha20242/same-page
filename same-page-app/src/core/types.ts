// Shared domain types. The engine works on these plain shapes; adapters turn Atlassian payloads into them.

export type Severity = 'block' | 'warn' | 'info';
export type Verdict = 'BLOCKED' | 'WARN' | 'PASS';

/** A Jira work item as the engine sees it. */
export interface WorkItem {
  key: string;
  status: string;
  apiVersion?: string;
  statusChangedAt?: string;
  statusChangedBy?: string | null;
  requiredFields?: string[];
  fields?: Record<string, unknown>;
  /** The summary and description as plain text. The fact rules (R8 to R10) read their numbers and dates from it. */
  text?: string;
}

/** A Confluence page as the engine sees it. */
export interface Page {
  id: string;
  title: string;
  text: string;
  modifiedAt: string;
  lastEditorId?: string | null;
  labels?: string[];
}

/** `siblings` are all the pages loaded for the same work item (including `page`), so a rule can compare a doc with another artifact, such as an API spec. */
export interface Pair { workItem: WorkItem; page: Page; siblings?: Page[]; cited?: Record<string, { status: string; changedAt?: string }> }

export interface VersionRef { version: string; index: number; text: string; kind: 'token' | 'phrase' }
export interface VersionHit { version: string; line: number; snippet: string; historical: boolean }

/** Evidence attached to a finding. Which parts are present depends on the rule. */
export interface Evidence {
  page?: { id?: string; modifiedAt?: string; line?: number; snippet?: string; labels?: string[]; moreStale?: number };
  /** The other artifact the page was compared with (rule R6): what the API spec says, and the exact text in the page that disagrees. */
  spec?: { title?: string; detail: string; opText: string };
  /** The other page that states a different version of the same endpoint or API (rule R7): its title and the exact line. */
  other?: { pageId?: string; pageTitle?: string; line?: number; snippet: string };
  /** A number or date that the work item text and the page state differently (rules R8 to R10). */
  fact?: { label: string; ticketLine: string; ticketValue: string; pageValue: string };
  /** A ticket the page mentions (rule R6) and the status Jira reports for it. */
  cited?: { key: string; status: string };
  workItem: { key?: string; apiVersion?: string; statusChangedAt?: string; statusChangedBy?: string | null; status?: string; missingField?: string };
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  why: string;
  summary: string;
  evidence: Evidence;
  /** Filled in when a finding is attached to a page (release and panel flows). */
  pageId?: string;
  pageTitle?: string;
  foundBecause?: string[];
}

export interface Rule {
  id: string;
  severity: Severity;
  why: string;
  run(pair: Pair): Finding[];
}

export interface CheckResult { verdict: Verdict; findings: Finding[] }

/** Jira issue as loaded by the Atlassian adapter (before the target version is derived). */
export interface Issue {
  key: string;
  summary: string;
  status: string;
  components: string[];
  fixVersions: string[];
  labels: string[];
  requiredFields: string[];
  fields: Record<string, unknown>;
  description?: string;
  apiVersionField?: string;
}

export type VersionSource = 'field' | 'component' | 'summary' | 'description' | 'fixVersion';
