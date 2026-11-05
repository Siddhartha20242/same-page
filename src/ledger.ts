import { createHash } from 'node:crypto';

// Tamper-evident evidence log. Each entry commits to its evidence and to the previous entry,
// so editing, reordering or deleting a past finding breaks verification.
// Scope of the claim: this detects tampering with stored history; it does not stop someone with
// write access to storage from rewriting the whole chain. Anchoring the head hash elsewhere
// (e.g. posting it to the Jira issue) narrows that gap. Pure functions: storage is the caller's job.

const GENESIS = '0'.repeat(64);
const MAX_SNIPPET = 200;

import type { Evidence, Finding } from './types.ts';

/** Evidence as stored in the ledger: the page may carry a `text` field that minimizeEvidence strips. */
export type LedgerEvidence = Evidence & { page?: Evidence['page'] & { text?: string } };
export interface EntryCore { seq: number; prevHash: string; at: string; ruleId: string; issueKey: string | null; evidenceHash: string }
export interface LedgerEntry extends EntryCore { evidence?: LedgerEvidence; entryHash: string }
export type VerifyResult = { ok: true; head: string; length: number } | { ok: false; brokenAt: number; reason: string };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Stable JSON: keys sorted at every level, so equal evidence always hashes equally.
export function canonicalize(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// Data minimisation: keep short snippets and identifiers, never whole page bodies.
export function minimizeEvidence(evidence: LedgerEvidence): LedgerEvidence {
  const out = structuredClone(evidence);
  if (out.page?.snippet) out.page.snippet = out.page.snippet.slice(0, MAX_SNIPPET);
  delete out.page?.text;
  return out;
}

// An entry commits to its evidence by HASH. The evidence itself can later be dropped (compactEntry) to save storage
// without breaking the chain, because the chain links are computed over the hash, not the text.
export function nextEntry({ seq, prevHash }: { seq: number; prevHash: string }, finding: Pick<Finding, 'ruleId' | 'evidence'>, now: () => string = () => new Date().toISOString()): LedgerEntry {
  const evidence = minimizeEvidence(finding.evidence);
  const core: EntryCore = {
    seq,
    prevHash,
    at: now(),
    ruleId: finding.ruleId,
    issueKey: evidence.workItem?.key ?? null,
    evidenceHash: sha256(canonicalize(evidence)),
  };
  return { ...core, evidence, entryHash: sha256(canonicalize(core)) };
}

export function appendFinding(chain: LedgerEntry[], finding: Pick<Finding, 'ruleId' | 'evidence'>, now?: () => string): LedgerEntry[] {
  const prev = chain[chain.length - 1];
  return [...chain, nextEntry({ seq: chain.length, prevHash: prev ? prev.entryHash : GENESIS }, finding, now)];
}

export const compactEntry = ({ evidence, ...rest }: LedgerEntry): LedgerEntry => rest;
export const compactChain = (chain: LedgerEntry[], { keepLast = 0 }: { keepLast?: number } = {}) =>
  chain.map((e, i) => (i >= chain.length - keepLast ? e : compactEntry(e)));
export const entryBytes = (e: unknown) => Buffer.byteLength(JSON.stringify(e));
export { GENESIS };

// Verifies a whole chain, or a page of it when given where it starts. Evidence is checked when present.
export function verifyChain(chain: LedgerEntry[], { startSeq = 0, startPrevHash = GENESIS }: { startSeq?: number; startPrevHash?: string } = {}): VerifyResult {
  let prevHash = startPrevHash;
  for (let i = 0; i < chain.length; i++) {
    const { entryHash, evidence, ...core } = chain[i];
    if (core.seq !== startSeq + i) return { ok: false, brokenAt: startSeq + i, reason: 'sequence gap or reorder' };
    if (core.prevHash !== prevHash) return { ok: false, brokenAt: startSeq + i, reason: 'previous-hash mismatch' };
    if (evidence !== undefined && sha256(canonicalize(evidence)) !== core.evidenceHash) return { ok: false, brokenAt: startSeq + i, reason: 'evidence was altered' };
    if (sha256(canonicalize(core)) !== entryHash) return { ok: false, brokenAt: startSeq + i, reason: 'entry was altered' };
    prevHash = entryHash;
  }
  return { ok: true, head: prevHash, length: startSeq + chain.length };
}

// What the panel shows, so the chain is visible and a judge can see what it proves.
export function summarizeChain(chain: LedgerEntry[], recent = 3) {
  const v = verifyChain(chain);
  return {
    status: v.ok ? 'verified' : 'broken',
    length: chain.length,
    head: v.ok ? v.head.slice(0, 12) : null,
    reason: v.ok ? null : `${v.reason} at entry ${v.brokenAt}`,
    recent: chain.slice(-recent).map((e) => ({ seq: e.seq, at: e.at, ruleId: e.ruleId, issueKey: e.issueKey, evidenceHash: e.evidenceHash.slice(0, 12) })),
  };
}
