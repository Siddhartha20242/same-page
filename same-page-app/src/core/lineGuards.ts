// Wording that marks a line as history, not a live claim. Shared by every rule that must not flag the past.
export const HISTORICAL_RE = /deprecat|migrat|rollback|roll back|legacy|sunset|retire|obsolete|no longer|end[- ]of[- ]life|\beol\b|formerly|previously|superseded|replaced/i;
// A line that carries a date before the fact is a log entry, true when it was written ("2017-10-31: waiting on HDFS-1").
export const DATED_BEFORE = /(\d{4}-\d{2}-\d{2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)/i;
