import type { PanelModel } from './panelModel.ts';
import type { Severity } from './types.ts';
import { ruleLabel } from './ruleCatalog.ts';

// The pre-ship gate behind a Jira workflow validator. Same rules, new entry point.
// Principles, in order:
//   1. FAIL OPEN. If we time out, error, cannot read a page or have nothing to say, the transition is allowed. A bug in this app must never stop someone's work.
//   2. Block only on proven findings (severity 'block' by default). Notes, warnings, unchecked items and dismissed or snoozed findings never block.
//   3. Never block on stale evidence: a cached block is re-checked live when a live check is available, and the live answer wins.
//   4. The error message is the evidence packet, in plain text, so the person sees WHY at the moment they click.
// Validator time limits are unverified (community reports ~10 s), so the live check runs under a strict budget.

export interface GateBlocker { id: string; ruleId: string; summary: string; pageId?: string; pageTitle?: string; docLine?: string; ticket?: string; /** Set when the person making the transition cannot read the page: its text is never put in the message. */ hidden?: boolean }
/** Can the person making the transition read this page? Must be answered by the platform, not guessed. */
export type CanView = (pageId: string) => Promise<boolean>;
export interface GateSnapshot { at: string; blockers: GateBlocker[] }
export interface GateStore { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }

export interface GateDecision {
  result: boolean;
  errorMessage?: string;
  /** Where the decision came from. 'fail-open' means we could not tell, so we allowed it. */
  basis: 'cache' | 'live' | 'fail-open';
  note?: string;
}

export const gateKey = (issueKey: string) => `gate:${issueKey}`;

/** Reduce a panel model (AFTER triage filtering) to what the gate needs. Null when the issue could not be checked. */
export function snapshotFromModel(model: PanelModel, now: () => number = Date.now, blockOn: Severity[] = ['block']): GateSnapshot | null {
  if (model.status === 'unchecked' || model.status === 'error') return null;
  const at = new Date(now()).toISOString();
  if (model.status === 'clean') return { at, blockers: [] };
  const blockers = model.findings
    .filter((f) => blockOn.includes(f.severity as Severity))
    .map((f) => ({ id: f.id, ruleId: f.ruleId, summary: f.summary, pageId: f.pageId, pageTitle: f.pageTitle, docLine: f.evidence?.docLine, ticket: f.evidence?.ticket }));
  return { at, blockers };
}

const flat = (s: string | undefined, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Plain-text evidence packet for the validator's error message. Page text is untrusted, so it is flattened and capped.
 *  It names the rule, the page and what to do next, and withholds page text from anyone who cannot read the page. */
export function formatBlockMessage(issueKey: string, blockers: GateBlocker[]): string {
  const first = blockers.find((b) => !b.hidden) ?? blockers[0];
  const head = `Same Page blocked this transition: ${issueKey} has ${blockers.length} provable contradiction${blockers.length === 1 ? '' : 's'} with its docs.`;
  const detail = !first ? ''
    : first.hidden
      ? ` Rule: ${ruleLabel(first.ruleId)}. A linked page you cannot view contradicts this issue; its details are withheld. Ask someone who can read that page to fix it.`
      : ` Rule: ${ruleLabel(first.ruleId)}. ${flat(first.summary, 160)}.${first.pageTitle ? ` Update the page "${flat(first.pageTitle, 80)}"` : ''}${first.docLine ? `, which says: "${flat(first.docLine, 120)}"` : ''}.`;
  const more = blockers.length > 1 ? ` (+${blockers.length - 1} more)` : '';
  return `${head}${detail}${more} Next: open Same Page from this work item's apps menu to see the evidence, then fix the page, create a review task for its owner, or dismiss the finding with a reason.`;
}

/** Page text may only reach the person who is allowed to read the page. Anything unproven (no page id, no checker, a failed check) is withheld. */
export async function redactFor(blockers: GateBlocker[], canView?: CanView): Promise<GateBlocker[]> {
  return Promise.all(blockers.map(async (b) => {
    let ok = false;
    try { ok = Boolean(canView && b.pageId && (await canView(b.pageId))); } catch { ok = false; }
    return ok ? b : { ...b, hidden: true };
  }));
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('gate check timed out')), ms))]);

export interface DecideOptions {
  issueKey: string;
  store: GateStore;
  /** Runs the full check (triage already applied) and returns a snapshot, or null if the issue is not checkable. Omit to use the cache only. */
  live?: () => Promise<GateSnapshot | null>;
  now?: () => number;
  /** A cached snapshot older than this is not trusted to block. */
  maxAgeMs?: number;
  /** Time allowed for a live check. */
  budgetMs?: number;
  /** Permission check for the person making the transition; without it the message withholds all page text. */
  canView?: CanView;
}

const readSnapshot = async (store: GateStore, issueKey: string): Promise<GateSnapshot | null> => {
  try {
    const v = (await store.get(gateKey(issueKey))) as Partial<GateSnapshot> | null | undefined;
    return v && typeof v.at === 'string' && Array.isArray(v.blockers) ? (v as GateSnapshot) : null;
  } catch { return null; }
};

const verdict = async (issueKey: string, s: GateSnapshot, basis: 'cache' | 'live', canView?: CanView): Promise<GateDecision> =>
  s.blockers.length ? { result: false, errorMessage: formatBlockMessage(issueKey, await redactFor(s.blockers, canView)), basis } : { result: true, basis };

export async function decideTransition({ issueKey, store, live, now = Date.now, maxAgeMs = 5 * 60_000, budgetMs = 6000, canView }: DecideOptions): Promise<GateDecision> {
  const cached = await readSnapshot(store, issueKey);
  const fresh = cached !== null && now() - Date.parse(cached.at) <= maxAgeMs;

  // A fresh "all clear" is trusted as is: it can only be wrong by being slightly late, and late means allowed, which is the safe side.
  if (cached && fresh && cached.blockers.length === 0) return await verdict(issueKey, cached, 'cache', canView);

  if (live) {
    try {
      const snap = await withTimeout(live(), budgetMs);
      if (snap) {
        try { await store.set(gateKey(issueKey), snap); } catch { /* caching is best effort */ }
        return await verdict(issueKey, snap, 'live', canView);
      }
      return { result: true, basis: 'fail-open', note: 'not checkable (no target version found), so nothing to enforce' };
    } catch (e) {
      // Live failed. Only a FRESH cached block may still stop the transition; anything staler is not evidence.
      if (cached && fresh) return await verdict(issueKey, cached, 'cache', canView);
      return { result: true, basis: 'fail-open', note: `check failed (${e instanceof Error ? e.message : 'unknown'}); allowed` };
    }
  }

  if (cached && fresh) return await verdict(issueKey, cached, 'cache', canView);
  return { result: true, basis: 'fail-open', note: 'no recent check available; allowed' };
}
