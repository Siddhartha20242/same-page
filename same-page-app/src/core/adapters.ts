// Turns Atlassian REST payloads into the plain shapes the rule engine uses.
// Payload shapes follow the Jira v3 changelog and Confluence v2 page docs; exact property
// names MUST be confirmed against a real response in spike 1 (see docs/feasibility.md).

// Latest status transition from GET /rest/api/3/issue/{key}/changelog (`values`) or
// expand=changelog (`histories`). Pass whichever array you have.
import type { Issue, Page, VersionSource } from './types';

interface ChangelogEntry { created: string; author?: { displayName?: string; accountId?: string }; items?: { field?: string; fieldId?: string }[] }

export function lastStatusTransition(entries: ChangelogEntry[] = []): { at: string; by: string | null } | null {
  let latest: ChangelogEntry | null = null;
  for (const e of entries) {
    const changedStatus = (e.items || []).some((i) => i.field === 'status' || i.fieldId === 'status');
    if (!changedStatus) continue;
    if (!latest || new Date(e.created) > new Date(latest.created)) latest = e;
  }
  return latest ? { at: latest.created, by: latest.author?.displayName ?? latest.author?.accountId ?? null } : null;
}

// First vN token in the summary (e.g. "Migrate Payment API to v2" -> "v2").
export function deriveApiVersion({ summary = '' }: { summary?: string } = {}): string | undefined {
  const m = /\bv(\d+)(?:\.\d+)*\b/i.exec(summary);
  return m ? `v${m[1]}` : undefined;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

// Confluence storage-format body -> plain text with line breaks kept.
// Code macros keep their text in a CDATA block (raw, not entity-escaped). It is real documentation (curl lines, request examples), so it is
// kept; table cells are separated so "1" and "POST /api/v1/charge" do not run together into "1POST /api/v1/charge".
export function storageToText(html = ''): string {
  return html
    .replace(/<ac:plain-text-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-body>/gi, (_m, code: string) => `\n${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`)
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .replace(/ \| (?=\n|$)/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// GET /wiki/api/v2/pages/{id}?body-format=storage  ->  engine page.
// modifiedAt is the CURRENT version's createdAt (the last edit), not the page's creation date.
interface ConfluencePage { id: string | number; title: string; createdAt?: string; authorId?: string; body?: { storage?: { value?: string } }; version?: { createdAt?: string; authorId?: string } }

export function normalizePage(p: ConfluencePage, labels: string[] = []): Page {
  return {
    id: String(p.id),
    title: p.title,
    text: storageToText(p.body?.storage?.value ?? ''),
    modifiedAt: p.version?.createdAt ?? p.createdAt ?? '',
    lastEditorId: p.version?.authorId ?? p.authorId ?? null,
    labels,
  };
}

// Reads the target major version from the most trustworthy source available.
// Default order: a dedicated field, then the summary. Fix Version is OPT-IN (sources: ['field','fixVersion','summary']) because in
// most projects it names a product release, not the API version a doc describes (a public-data probe confirmed this). Calendar versions (2026.10),
// "release-47" and "Release 4" are NOT guessed at; conflicting Fix Versions are refused as ambiguous.
function majorFrom(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  const whole = /^v?(\d+)(?:\.\d+)*(?:[-+][0-9a-z.]+)?$/i.exec(s);   // 2, v2, 2.3.1, v2.0-beta
  if (whole) return /^\d{4}/.test(s) || whole[1] === '0' ? undefined : `v${whole[1]}`;   // calendar and pre-1.0 versions are not API majors
  const tagged = /\bv(\d+)(?:\.\d+)*\b/i.exec(s);
  return tagged && tagged[1] !== '0' ? `v${tagged[1]}` : undefined;
}

// Sources: field (dedicated API-version field), component (component names), summary, description (noisy, opt-in), fixVersion (opt-in).
type IssueLike = Partial<Issue>;

export function deriveTargetVersion(issue: IssueLike, { sources = ['field', 'component', 'summary'] as VersionSource[] }: { sources?: VersionSource[] } = {}): string | undefined {
  for (const src of sources) {
    const values = src === 'field' ? [issue.apiVersionField]
      : src === 'component' ? (issue.components || [])
        : src === 'fixVersion' ? (issue.fixVersions || [])
          : src === 'description' ? [issue.description]
            : [issue.summary];
    const found = [...new Set(values.map(majorFrom).filter((v): v is string => Boolean(v)))];
    if (found.length === 1) return found[0];
    if (found.length > 1) return undefined; // conflicting values: ambiguous, so refuse
  }
  return undefined;
}

// Onboarding without a custom field: sample a project's issues and report how many each source can read.
// The settings screen shows this ("summary works for 62% of your issues") instead of demanding configuration.
export function recommendSources(issues: IssueLike[]) {
  const all: VersionSource[] = ['field', 'component', 'summary', 'description', 'fixVersion'];
  const rows = all.map((source) => {
    const count = issues.filter((i) => deriveTargetVersion(i, { sources: [source] })).length;
    return { source, count, pct: issues.length ? Math.round((100 * count) / issues.length) : 0 };
  }).sort((a, b) => b.count - a.count);
  return { rows, suggested: rows.filter((r) => r.pct >= 30 && r.source !== 'fixVersion').map((r) => r.source) };
}

// Jira Cloud returns a description as Atlassian Document Format (a tree). This keeps its text, one paragraph, list item or heading per line,
// and drops everything else (media, mentions keep their visible text). Capped so a huge description cannot slow a check.
interface AdfNode { type?: string; text?: string; content?: AdfNode[]; attrs?: { text?: string } }
const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'tableRow', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'rule']);
export function adfToText(doc: unknown, maxChars = 6000): string {
  if (typeof doc === 'string') return doc.slice(0, maxChars);
  let out = '';
  const walk = (n: AdfNode | undefined) => {
    if (!n || out.length > maxChars) return;
    if (n.type === 'text') out += n.text ?? '';
    else if (n.type === 'hardBreak') out += '\n';
    else if (n.type === 'mention' || n.type === 'emoji') out += n.attrs?.text ?? '';
    for (const c of n.content ?? []) walk(c);
    if (n.type && BLOCKS.has(n.type) && !out.endsWith('\n')) out += '\n';
    else if (n.type === 'tableCell' || n.type === 'tableHeader') out += ' | ';
  };
  walk(doc as AdfNode);
  return out.replace(/\n{2,}/g, '\n').trim().slice(0, maxChars);
}
