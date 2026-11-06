import { headOf } from './ledgerStore.ts';
import type { KV } from './ledgerStore.ts';
import type { LedgerEntry } from './ledger.ts';

// An export of the audit chain an auditor can verify without trusting the app: entries with their hashes, the hash that precedes the first one,
// and the head. It holds no page text (evidence is represented by its hash). It is hash-chained, not signed: it proves the listed entries are intact
// and in order, and a release's head hash can be compared with the copy anchored on the Jira work item. Verify it with scripts/verify-export.mjs.

export interface AuditExport {
  samePageAudit: 1; exportedAt: string; totalEntries: number; from: number; startPrevHash: string; head: string;
  entries: Pick<LedgerEntry, 'seq' | 'prevHash' | 'at' | 'ruleId' | 'issueKey' | 'evidenceHash' | 'entryHash'>[];
}

export async function buildAuditExport(kv: KV, { max = 200, now = () => new Date().toISOString() }: { max?: number; now?: () => string } = {}): Promise<AuditExport> {
  const { length, head } = await headOf(kv);
  const from = Math.max(0, length - Math.min(Math.max(1, max), 2000));
  const entries: AuditExport['entries'] = [];
  for (let i = from; i < length; i++) {
    const e = (await kv.get(`ledger:e:${i}`)) as LedgerEntry | undefined;
    if (e) entries.push({ seq: e.seq, prevHash: e.prevHash, at: e.at, ruleId: e.ruleId, issueKey: e.issueKey, evidenceHash: e.evidenceHash, entryHash: e.entryHash });
  }
  return { samePageAudit: 1, exportedAt: now(), totalEntries: length, from, startPrevHash: entries[0]?.prevHash ?? '0'.repeat(64), head, entries };
}
