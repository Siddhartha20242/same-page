import { canonFromSentence, disagreements } from './factRules';
import type { Disagreement } from './factRules';

// Fact registry. A Jira administrator declares a few facts the whole site should agree on ("access token expiry" is "1 hour"), and Same Page
// searches Confluence for pages that state the same thing with a different value. It needs no Jira link, so it reaches pages nobody connected
// to a work item. Detection is the same fixed matching as rules R8 to R10: the same kind of value, the same unit and at least two shared
// subject words, skipping history, dated log lines, examples and defaults. No model. It reports; it never edits.

export interface CanonDef { id: string; subject: string; value: string }
export interface CanonStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
export const MAX_CANON = 10;
const KEY = 'canon:facts';

const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f`<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function validateCanon(input: { subject?: unknown; value?: unknown }): { ok: true; subject: string; value: string } | { ok: false; reason: string } {
  const subject = clean(input.subject, 80);
  const value = clean(input.value, 40);
  if (subject.length < 5) return { ok: false, reason: 'Describe what the fact is about in a few words, for example "access token expiry".' };
  if (!value) return { ok: false, reason: 'Enter the value, for example "1 hour", "100 requests per minute", "port 8080" or "release 2026-03-15".' };
  if (!canonFromSentence(subject, value)) return { ok: false, reason: 'Same Page could not read that as one time, limit or date about a clear subject. Use at least two words for the subject and one value such as "1 hour".' };
  return { ok: true, subject, value };
}

async function read(store: CanonStore): Promise<{ facts: CanonDef[]; next: number }> {
  try {
    const raw = (await store.get(KEY)) as { facts?: CanonDef[]; next?: number } | null | undefined;
    const facts = (Array.isArray(raw?.facts) ? raw!.facts : []).filter((f) => f && /^F\d+$/.test(String(f.id)) && validateCanon(f).ok).slice(0, MAX_CANON);
    return { facts, next: Number.isFinite(raw?.next) ? Number(raw!.next) : facts.length + 1 };
  } catch { return { facts: [], next: 1 }; }
}
export const loadCanon = async (store: CanonStore) => (await read(store)).facts;

export async function addCanon(store: CanonStore, input: { subject?: unknown; value?: unknown }): Promise<{ ok: true; fact: CanonDef } | { ok: false; reason: string }> {
  const v = validateCanon(input);
  if (!v.ok) return v;
  const cur = await read(store);
  if (cur.facts.length >= MAX_CANON) return { ok: false, reason: `A site can have at most ${MAX_CANON} facts. Delete one first.` };
  const fact = { id: `F${cur.next}`, subject: v.subject, value: v.value };
  await store.set(KEY, { facts: [...cur.facts, fact], next: cur.next + 1 });
  return { ok: true, fact };
}

export async function deleteCanon(store: CanonStore, id: string): Promise<{ ok: boolean }> {
  const cur = await read(store);
  const facts = cur.facts.filter((f) => f.id !== id);
  if (facts.length === cur.facts.length) return { ok: false };
  await store.set(KEY, { facts, next: cur.next });
  return { ok: true };
}

export interface CanonDeps {
  /** Page ids and titles whose text matches every word, readable by the person running the check. */
  search: (words: string[]) => Promise<{ id: string; title: string }[]>;
  getPage: (id: string) => Promise<{ title: string; text: string } | null>;
}
export interface PageDisagreement { pageId: string; title: string; found: Disagreement[] }
export interface CanonResult { id: string; subject: string; value: string; pagesRead: number; agreeing: number; pages: PageDisagreement[]; note?: string }

// Words the matcher treats as one idea ("expiry", "expires", "lasts", "timeout"...) are left out of the search, so a page that says "lasts" is still found.
// The search narrows by the nouns; the matching itself (same value kind, same unit, two shared subject words) decides.
const SAME_IDEA = /^(expir\w*|ttl|timeouts?|lifetime|valid\w*|lasts?)$/;
export const searchWords = (subject: string): string[] => {
  const all = [...new Set(subject.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])];
  const nouns = all.filter((w) => !SAME_IDEA.test(w));
  return (nouns.length ? nouns : all).slice(0, 3);
};

/** Checks each declared fact against the pages Confluence returns for its words. At most 8 pages per fact, 5 facts per run, and a time limit. */
export async function checkCanon(facts: CanonDef[], deps: CanonDeps, { maxMs = 20000, now = Date.now }: { maxMs?: number; now?: () => number } = {}): Promise<{ results: CanonResult[]; stoppedEarly: boolean }> {
  const started = now();
  const results: CanonResult[] = [];
  let stoppedEarly = false;
  for (const f of facts.slice(0, 5)) {
    if (now() - started > maxMs) { stoppedEarly = true; break; }
    const canon = canonFromSentence(f.subject, f.value);
    if (!canon) { results.push({ id: f.id, subject: f.subject, value: f.value, pagesRead: 0, agreeing: 0, pages: [], note: 'This fact could not be read.' }); continue; }
    const hits = (await deps.search(searchWords(f.subject)).catch(() => [])).slice(0, 8);
    const pages: PageDisagreement[] = [];
    let agreeing = 0; let read = 0;
    for (const h of hits) {
      if (now() - started > maxMs) { stoppedEarly = true; break; }
      const p = await deps.getPage(h.id).catch(() => null);
      if (!p) continue;
      read++;
      const d = disagreements(canon, p.text);
      agreeing += d.agree;
      if (d.disagree.length) pages.push({ pageId: h.id, title: p.title || h.title, found: d.disagree });
    }
    results.push({ id: f.id, subject: f.subject, value: f.value, pagesRead: read, agreeing, pages });
  }
  return { results, stoppedEarly };
}
