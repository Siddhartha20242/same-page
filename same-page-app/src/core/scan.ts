import { check } from './engine';
import { deriveApiVersion } from './adapters';
import type { Finding, Page, Rule, WorkItem } from './types';

export interface Epic extends Partial<WorkItem> { key: string; summary: string }
export interface ScanDeps {
  listOpenEpics: () => Promise<Epic[]>;
  findCandidatePages: (epic: Epic) => Promise<Page[]>;
  getTransition: (key: string) => Promise<{ at: string; by: string | null } | null>;
  rules?: Rule[];
}
export interface ScanResult { key: string; summary: string; count: number; findings: Finding[] }

const MAX_EPICS = 10;          // keep one agent call inside Forge function limits
const MAX_PAGES_PER_EPIC = 5;

// Backing logic for the Rovo GET action "scan_epics_for_contradictions".
// All Atlassian access is injected so this runs against fakes in tests.
export async function scanEpics({ listOpenEpics, findCandidatePages, getTransition, rules }: ScanDeps): Promise<ScanResult[]> {
  const epics = (await listOpenEpics()).slice(0, MAX_EPICS);
  const results: ScanResult[] = [];
  for (const epic of epics) {
    const transition = await getTransition(epic.key);
    if (!transition) continue; // no recorded transition, so R1's staleness test can't be evidenced
    const workItem: WorkItem = {
      status: '',
      ...epic,
      apiVersion: epic.apiVersion ?? deriveApiVersion(epic),
      statusChangedAt: transition.at,
      statusChangedBy: transition.by,
    };
    const pages = (await findCandidatePages(epic)).slice(0, MAX_PAGES_PER_EPIC);
    const findings = pages.flatMap((page) =>
      check({ workItem, page }, rules).findings.filter((f) => f.severity !== 'info').map((f) => ({ ...f, pageId: page.id })));
    if (findings.length) results.push({ key: epic.key, summary: epic.summary, count: findings.length, findings });
  }
  return results.sort((a, b) => b.count - a.count);
}

// Plain-language reply the agent returns; never invents anything beyond the findings.
export function formatScan(results: ScanResult[]): string {
  if (!results.length) return 'No contradictions found in the epics and pages checked.';
  return results
    .map((r) => `${r.key} (${r.summary}): ${r.count} contradiction${r.count > 1 ? 's' : ''}\n` +
      r.findings.map((f) => `  - ${f.ruleId}: ${f.summary}`).join('\n'))
    .join('\n');
}
