// Wording that marks a line as history, not a live claim. Shared by every rule that must not flag the past.
export const HISTORICAL_RE = /deprecat|migrat|rollback|roll back|legacy|sunset|retire|obsolete|no longer|end[- ]of[- ]life|\beol\b|formerly|previously|superseded|replaced/i;
// A line that carries a date before the fact is a log entry, true when it was written ("2017-10-31: waiting on HDFS-1").
export const DATED_BEFORE = /(\d{4}-\d{2}-\d{2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)/i;

// "The lock timeout was 60s before the rewrite": a past state that a later change replaced.
export const PAST_STATE = /\b(?:was|were|used to)\b[^.;]*\b(?:before|until|prior to)\b/i;
// A milestone written in the past tense is a record, not a plan.
export const PAST_EVENT = /\b(?:started|began|ended|took place|happened|completed|finished)\b/i;
/** "in 2024" on a page last edited in 2026 is about the past. Without a modified date nothing is decided. */
export function pastYear(line: string, modifiedAt?: string): boolean {
  const now = Number(String(modifiedAt ?? '').slice(0, 4));
  if (!Number.isFinite(now) || now < 2000) return false;
  return [...line.matchAll(/\b(?:in|during)\s+(20\d\d)\b/gi)].some((m) => Number(m[1]) < now);
}
// For dates, a "migration deadline" or "rollback window" is a plan, not history; the past-tense verbs are guarded separately.
export const HISTORICAL_DATE_RE = new RegExp(HISTORICAL_RE.source.replace('migrat|', '').replace('rollback|roll back|', ''), 'i');
