import type { Severity } from './types';
import type { Suggestion, Span } from './panelModel';
// The "Create review task" body for POST /rest/api/3/issue. A normal Jira task carrying the evidence and the suggested edit.
// The description is Atlassian Document Format (ADF); every piece of page text goes in as a plain text node, never markup.

export interface PanelFinding {
  id: string;
  ruleId: string;
  severity: Severity;
  summary: string;
  why: string;
  foundBecause?: string[];
  pageId?: string;
  pageTitle?: string;
  evidence: { docLine?: string; docHighlight?: Span; moreStale?: number; sourceLabel?: string; docModifiedAt?: string; ticket?: string; ticketChangedAt?: string; ticketChangedBy?: string | null };
  suggestion?: Suggestion | null;
}

const para = (text: unknown) => ({ type: 'paragraph', content: [{ type: 'text', text: String(text) }] });

export function buildReviewTask({ issueKey, finding }: { issueKey: string; finding: PanelFinding }) {
  const project = issueKey.split('-')[0];
  const lines = [
    `Same Page found a contradiction on ${issueKey}.`,
    `${finding.summary}`,
    `Doc: "${finding.pageTitle}" (last edited ${finding.evidence.docModifiedAt ?? 'unknown'})`,
    // Some rules (a deprecated decision page) have no single quoted line; say nothing rather than print "undefined".
    ...(finding.evidence.docLine ? [`Doc says: ${finding.evidence.docLine}`] : []),
    `${finding.evidence.sourceLabel === 'Other page says' ? 'Other page' : 'Ticket'}: ${finding.evidence.ticket}`,
    `Why it matters: ${finding.why}`,
  ];
  if (finding.suggestion?.after) lines.push(`Suggested edit: "${finding.suggestion.before}" -> "${finding.suggestion.after}" (${finding.suggestion.note})`);
  return {
    fields: {
      project: { key: project },
      issuetype: { name: 'Task' },
      summary: `Review doc contradiction for ${issueKey}: ${finding.pageTitle}`.slice(0, 250),
      description: { type: 'doc', version: 1, content: lines.map(para) },
    },
  };
}
