// Deterministic candidate-page ranking. Rovo ranking is an optional extra, never a dependency.
// Signals, strongest first: explicit Jira remote link, issue key mentioned in the page,
// shared labels, title and body keyword overlap with the issue summary.
// Low-signal pages (a lone keyword match) are filtered out so the user never clicks through noise.

export interface CandidatePage { id: string | number; title?: string; text?: string; labels?: string[]; modifiedAt?: string }
export interface CandidateIssue { key?: string; summary?: string; labels?: string[]; components?: string[] }
export interface Candidate { page: CandidatePage; score: number; reasons: string[] }

const STOP = new Set(['with', 'from', 'that', 'this', 'into', 'over', 'upgrade', 'update', 'task', 'epic', 'story']);

function tokens(text = ''): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((t) => !STOP.has(t) && !/^v\d+$/.test(t)))];
}

export function scoreCandidate({ issue, page, remoteLinkIds = [], pinnedIds = [] }: { issue: CandidateIssue; page: CandidatePage; remoteLinkIds?: string[]; pinnedIds?: (string | number)[] }): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (pinnedIds.map(String).includes(String(page.id))) { score += 100; reasons.push('pinned for this project or component'); }
  if (remoteLinkIds.includes(String(page.id))) { score += 100; reasons.push('linked from the Jira issue'); }
  const hay = `${page.title ?? ''}\n${page.text ?? ''}`;
  if (issue.key && new RegExp(`\\b${issue.key}\\b`, 'i').test(hay)) { score += 50; reasons.push(`mentions ${issue.key}`); }
  const shared = (issue.labels || []).filter((l) => (page.labels || []).map((x) => x.toLowerCase()).includes(l.toLowerCase()));
  if (shared.length) { score += 10 * shared.length; reasons.push(`shares label ${shared.join(', ')}`); }
  const comps = (issue.components || []).filter((c) => (page.labels || []).map((x) => x.toLowerCase()).includes(String(c).toLowerCase()));
  if (comps.length) { score += 15 * comps.length; reasons.push(`matches component ${comps.join(', ')}`); }
  const want = tokens(issue.summary);
  const inTitle = want.filter((t) => tokens(page.title).includes(t));
  if (inTitle.length) { score += 8 * inTitle.length; reasons.push(`title matches ${inTitle.join(', ')}`); }
  const inBody = want.filter((t) => !inTitle.includes(t) && tokens(page.text).includes(t));
  if (inBody.length) { score += 3 * inBody.length; reasons.push(`body matches ${inBody.join(', ')}`); }
  return { score, reasons };
}

export function rankCandidates(issue: CandidateIssue, pages: CandidatePage[], { remoteLinkIds = [], pinnedIds = [], min = 10, limit = 5 }: { remoteLinkIds?: string[]; pinnedIds?: (string | number)[]; min?: number; limit?: number } = {}): Candidate[] {
  return pages
    .map((page) => ({ page, ...scoreCandidate({ issue, page, remoteLinkIds, pinnedIds }) }))
    .filter((c) => c.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
