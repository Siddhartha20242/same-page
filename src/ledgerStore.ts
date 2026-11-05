import { nextEntry, verifyChain, compactEntry, GENESIS } from './ledger.ts';
import type { LedgerEntry, VerifyResult } from './ledger.ts';
import type { Finding } from './types.ts';

/** Forge KVS get/set. Stored values are dynamic JSON, so they are typed `any` at this boundary only. */
export interface KV { get(key: string): Promise<any>; set(key: string, value: unknown): Promise<unknown> } // eslint-disable-line @typescript-eslint/no-explicit-any
export interface LedgerHead { length: number; head: string }
export interface AnchorRecord { ledgerLength: number; ledgerHead: string }

// The ledger on Forge KVS, one entry per key. Checked against the docs: a single value is limited to 240 KiB
// (so the whole chain in one array breaks after a few hundred entries), keys are limited to 500 characters,
// and there is no hard total-storage cap (storage is billed above a free allowance). `kv` is { get, set }.
// Writes are entry first, then head: a crash between them leaves an orphan entry that the next append overwrites.

const HEAD = 'ledger:head';
const entryKey = (seq: number) => `ledger:e:${seq}`;

export async function appendToStore(kv: KV, finding: Pick<Finding, 'ruleId' | 'evidence'>, now?: () => string): Promise<LedgerEntry> {
  const head: LedgerHead = (await kv.get(HEAD)) ?? { length: 0, head: GENESIS };
  const entry = nextEntry({ seq: head.length, prevHash: head.head }, finding, now);
  await kv.set(entryKey(entry.seq), entry);
  await kv.set(HEAD, { length: entry.seq + 1, head: entry.entryHash });
  return entry;
}

export async function headOf(kv: KV): Promise<LedgerHead> { return (await kv.get(HEAD)) ?? { length: 0, head: GENESIS }; }

// Walks the log in pages so verification never loads it all at once.
export async function verifyStored(kv: KV, { pageSize = 100 }: { pageSize?: number } = {}): Promise<VerifyResult | { ok: false; reason: string } | { ok: true; length: number; head: string }> {
  const { length, head } = await headOf(kv);
  let prevHash = GENESIS;
  for (let from = 0; from < length; from += pageSize) {
    const page: LedgerEntry[] = [];
    for (let seq = from; seq < Math.min(length, from + pageSize); seq++) page.push(await kv.get(entryKey(seq)));
    if (page.some((e) => !e)) return { ok: false, reason: 'an entry is missing' };
    const v = verifyChain(page, { startSeq: from, startPrevHash: prevHash });
    if (!v.ok) return v;
    prevHash = v.head;
  }
  return prevHash === head ? { ok: true, length, head } : { ok: false, reason: 'head pointer does not match the last entry' };
}

// After a release is anchored, drop the stored evidence text for old entries. The chain and anchors still verify.
export async function compactStored(kv: KV, { from = 0, to }: { from?: number; to: number }): Promise<void> {
  for (let seq = from; seq <= to; seq++) {
    const e = await kv.get(entryKey(seq));
    if (e && e.evidence !== undefined) await kv.set(entryKey(seq), compactEntry(e));
  }
}

export async function verifyAnchorStored(kv: KV, record: AnchorRecord): Promise<{ ok: true } | { ok: false; reason: string }> {
  const v = await verifyStored(kv);
  if (!v.ok) return { ok: false, reason: `ledger invalid: ${v.reason}` };
  if (v.length < record.ledgerLength) return { ok: false, reason: 'history was shortened since the anchor' };
  const at = record.ledgerLength === 0 ? GENESIS : (await kv.get(entryKey(record.ledgerLength - 1))).entryHash;
  return at === record.ledgerHead ? { ok: true } : { ok: false, reason: 'history was rewritten since the anchor' };
}
