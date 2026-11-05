import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/engine.ts';
import { proposeFix, verifyFix, formatSuggestion } from '../src/propose.ts';
import { pairs } from '../fixtures/pairs.ts';
import type { Llm } from '../src/propose.ts';
import type { Finding, Page, WorkItem } from '../src/types.ts';

// Narrowing helper: a missing value fails the test with a clear message instead of a TypeError later.
function must<T>(v: T | undefined | null, what = 'value'): T { assert.ok(v != null, `expected ${what} to be present`); return v; }

const OLD = '2026-08-01T10:00:00Z';
const NEW = '2026-10-01T10:00:00Z';
const wi = (o: Partial<WorkItem> = {}): WorkItem => ({ key: 'PAY-9', status: 'In Progress', apiVersion: 'v2', statusChangedAt: NEW, requiredFields: [], fields: {}, ...o });
const pg = (text: string): Page => ({ id: 'p1', title: 'Runbook', text, modifiedAt: OLD, labels: [] });
const r1 = (workItem: WorkItem, page: Page): Finding => must(check({ workItem, page }).findings.find((f) => f.ruleId === 'R1_VERSION_MISMATCH'), 'an R1 finding');

test('deterministic fix rewrites only the flagged line and verifies', async () => {
  const page = pg('Intro line.\nCall POST /api/v1/charge to charge.\nEscalate on 5xx.');
  const workItem = wi();
  const out = await proposeFix({ finding: r1(workItem, page), page, workItem });
  assert.equal(out.ok, true);
  assert.ok(out.ok);
  assert.equal(out.method, 'deterministic');
  assert.equal(out.line, 2);
  assert.equal(out.after, 'Call POST /api/v2/charge to charge.');
  assert.match(formatSuggestion(out, { issueKey: 'PAY-9', pageTitle: 'Runbook' }), /\+ Call POST \/api\/v2\/charge/);
});

test('minor-version token is ambiguous: no invented version, no model means no fix', async () => {
  const page = pg('Service speaks v1.4 only.');
  const workItem = wi();
  const out = await proposeFix({ finding: r1(workItem, page), page, workItem });
  assert.equal(out.ok, false);
  assert.ok(!out.ok);
  assert.match(out.reason, /ambiguous/);
});

test('LLM suggestion is accepted only when it passes verification', async () => {
  const page = pg('Service speaks v1.4 only.');
  const workItem = wi();
  const finding = r1(workItem, page);
  const good = await proposeFix({ finding, page, workItem, llm: async () => 'Service speaks v2 only.' });
  assert.equal(good.ok, true);
  assert.equal(good.method, 'llm');

  const unchanged = await proposeFix({ finding, page, workItem, llm: async () => 'Service speaks v1.4 only.' });
  assert.equal(unchanged.ok, false);

  const stillStale = await proposeFix({ finding, page, workItem, llm: async () => 'Service speaks v3 only.' });
  assert.equal(stillStale.ok, false);
  assert.ok(!stillStale.ok);
  assert.match(stillStale.reason, /does not mention v2/);

  const garbage = await proposeFix({ finding, page, workItem, llm: (async () => undefined) as unknown as Llm });   // deliberately malformed: a model that returns nothing
  assert.equal(garbage.ok, false);
});

test('guard rejects edits that touch other lines or change line count', () => {
  const a = 'one\nCall v1\nthree';
  assert.equal(verifyFix(a, 'ONE\nCall v2\nthree', 2, 'v2').ok, false);
  assert.equal(verifyFix(a, 'one\nCall v2\nextra\nthree', 2, 'v2').ok, false);
  assert.equal(verifyFix(a, 'one\nCall v2\nthree', 2, 'v2').ok, true);
});

test('non-text rules get an honest refusal, not a made-up fix', async () => {
  const out = await proposeFix({ finding: { ruleId: 'R3_MISSING_REQUIRED_FIELD', evidence: {} } as unknown as Finding,   // minimal finding: only the rule id matters here
    page: pg('x'), workItem: wi() });
  assert.equal(out.ok, false);
  assert.ok(!out.ok);
  assert.match(out.reason, /needs a human decision/);
});

test('every R1 contradiction fixture that is mechanically fixable gets a verified fix', async () => {
  let fixed = 0, refused = 0;
  for (const p of pairs.filter((x) => x.expect.includes('R1_VERSION_MISMATCH'))) {
    const finding = r1(p.workItem, p.page);
    const out = await proposeFix({ finding, page: p.page, workItem: p.workItem });
    if (out.ok) { fixed++; assert.equal(out.verified, true); } else refused++;
  }
  console.log(`# R1 fixture fixes: ${fixed} verified, ${refused} refused (ambiguous, no model)`);
  assert.ok(fixed > 0);
});
