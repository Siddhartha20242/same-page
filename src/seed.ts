// Demo seeding. No backdating: the runbook page is created FIRST, the epic second, and the transition last,
// so the page's last edit is genuinely older than the transition.
// It seeds two findings the judge sees at once: R1 (stale runbook) and R2 (deprecated decision, active epic).
// Every step retries, and a failed run returns its partial state so a re-run (or the "Create demo data"
// button) resumes instead of duplicating. Seeding can fail partway on a real site; callers must show
// the failure, never an empty panel with no explanation.

export const DEMO_EPIC_SUMMARY = 'Migrate Payment API to v2';
export const DEMO_PAGE_TITLE = 'Payment API Runbook (Same Page demo)';
export const DEMO_PAGE_HTML =
  '<h2>Charging a card</h2><p>Call POST /api/v1/charge with the order id.</p>' +
  '<p>Escalate to on-call if the call returns 5xx.</p>';
export const DECISION_PAGE_TITLE = 'ADR-12: Route payment events through the legacy queue (Same Page demo)';
export const DECISION_PAGE_HTML = '<p>Decision: payment events use the legacy queue.</p>';

export interface SeedState { runbookId?: string; epicKey?: string; transitioned?: boolean; decisionId?: string; linked?: boolean; linkNote?: string }
export type SeedResult =
  | { ok: true; state: SeedState; pageId: string | undefined; epicKey: string | undefined }
  | { ok: false; failedAt: keyof SeedState; error: string; state: SeedState };

export interface SeedDeps {
  createPage(a: { title: string; html: string; labels: string[] }): Promise<{ id: string }>;
  createIssue(a: { projectKey: string; type: string; summary: string }): Promise<{ key: string }>;
  transitionIssue(key: string, toName: string): Promise<void>;
  linkPageToIssue?(issueKey: string, pageId: string): Promise<void>;
  projectKey: string;
  existing?: SeedState;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, retries: number, sleep: (ms: number) => Promise<void>): Promise<T> {
  let err: unknown;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (e) { err = e; if (i < retries) await sleep(500 * (i + 1)); }
  }
  throw err;
}

export async function seedDemo({ createPage, createIssue, transitionIssue, linkPageToIssue, projectKey, existing = {}, retries = 2, sleep = pause }: SeedDeps): Promise<SeedResult> {
  const state: SeedState = { ...existing };
  const steps: [keyof SeedState, () => Promise<string | boolean>][] = [
    ['runbookId', async () => (await createPage({ title: DEMO_PAGE_TITLE, html: DEMO_PAGE_HTML, labels: [] })).id],
    ['epicKey', async () => { await sleep(1500); return (await createIssue({ projectKey, type: 'Epic', summary: DEMO_EPIC_SUMMARY })).key; }],
    ['transitioned', async () => { await transitionIssue(state.epicKey as string, 'In Progress'); return true; }],
    ['decisionId', async () => (await createPage({ title: DECISION_PAGE_TITLE, html: DECISION_PAGE_HTML, labels: ['deprecated'] })).id],
  ];
  for (const [key, run] of steps) {
    if (state[key] !== undefined) continue;
    try { (state as Record<string, string | boolean>)[key] = await withRetry(run, retries, sleep); }
    catch (e) { return { ok: false, failedAt: key, error: e instanceof Error ? e.message : String(e), state }; }
  }
  // Linking is best effort: discovery also finds pages by search, so a link failure is not fatal. It is retried on every run until it works.
  if (linkPageToIssue && state.linked !== true) {
    delete state.linkNote;
    try {
      await linkPageToIssue(state.epicKey as string, state.runbookId as string);
      await linkPageToIssue(state.epicKey as string, state.decisionId as string);
      state.linked = true;
    } catch (e) { state.linked = false; state.linkNote = e instanceof Error ? e.message : String(e); }
  }
  return { ok: true, state, pageId: state.runbookId, epicKey: state.epicKey };
}
