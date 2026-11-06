import { check } from './engine';
import { deriveTargetVersion } from './adapters';
import { canonFromSentence, disagreements } from './factRules';
import { ruleLabel } from './ruleCatalog';
import type { Rule, Pair } from './types';
import type { CanonDef } from './canon';

// Rule playground: an administrator pastes sample work item text and sample page text and sees which rules (built-in, team and declared facts) would
// fire, with the line that triggered each. It reads nothing from the site and saves nothing, so a rule can be tried before it touches a real work item.
// To let every rule be tried, the sample work item is treated as having changed status just now and the sample page as last edited long ago.

export interface PlaygroundInput { ticketText?: unknown; pageText?: unknown; status?: unknown; labels?: unknown }
export interface PlaygroundHit { kind: 'rule' | 'fact'; label: string; severity: string; summary: string; line?: number; snippet?: string }

const cap = (v: unknown, n: number) => String(v ?? '').slice(0, n);

export function runPlayground(input: PlaygroundInput, rules: Rule[], canon: CanonDef[] = []): { ok: true; hits: PlaygroundHit[]; note: string } | { ok: false; reason: string } {
  const ticket = cap(input.ticketText, 4000).trim();
  const page = cap(input.pageText, 8000);
  if (!ticket && !page.trim()) return { ok: false, reason: 'Paste some work item text, some page text, or both.' };
  const status = cap(input.status, 40).trim() || 'In Progress';
  const labels = cap(input.labels, 200).split(',').map((l) => l.trim()).filter(Boolean).slice(0, 10);
  const firstLine = ticket.split('\n')[0] ?? '';
  const workItem = { key: 'SAMPLE-1', status, labels, components: [] as string[], summary: firstLine, text: ticket, apiVersion: deriveTargetVersion({ summary: firstLine }), statusChangedAt: new Date().toISOString(), statusChangedBy: null } as unknown as Pair['workItem'];
  const pair: Pair = { workItem, page: { id: 'sample', title: 'Sample page', text: page, modifiedAt: '2000-01-01T00:00:00Z' }, siblings: [] };
  const hits: PlaygroundHit[] = check(pair, rules).findings.map((f) => ({ kind: 'rule' as const, label: ruleLabel(f.ruleId), severity: f.severity, summary: f.summary, line: f.evidence.page?.line, snippet: f.evidence.page?.snippet?.slice(0, 200) }));
  for (const c of canon.slice(0, 10)) {
    const fact = canonFromSentence(c.subject, c.value);
    if (!fact) continue;
    for (const d of disagreements(fact, page).disagree) hits.push({ kind: 'fact', label: `Fact: ${c.subject} = ${c.value}`, severity: 'finding', summary: `The sample page says ${d.pageValue}`, line: d.line, snippet: d.snippet });
  }
  return { ok: true, hits, note: 'Nothing was read from your site or saved. The sample work item counts as changed just now and the sample page as last edited long ago, so version and status rules can fire.' };
}
