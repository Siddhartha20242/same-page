import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, approvedChanges, previewLines, buildJournal, undoPlan, seal, journalHash, burst, DEFAULT_POLICY, type ProposedChange } from '../src/firewall.ts';
import { verifyChain } from '../src/ledger.ts';

const closeAll = (n: number, project = 'OPS', from = 'In Progress'): ProposedChange[] =>
  Array.from({ length: n }, (_, i) => ({ issueKey: `${project}-${i + 1}`, field: 'status', from, to: 'Done' }));

test('a small batch is allowed and a no-op change is dropped, not counted', () => {
  const d = evaluate([...closeAll(3), { issueKey: 'OPS-9', field: 'priority', from: 'High', to: 'High' }]);
  assert.equal(d.verdict, 'allow');
  assert.equal(d.changes.length, 3);
  assert.equal(d.ignoredNoops, 1);
});

test('the demo: an agent closing 180 tickets is stopped and needs approval, with a readable preview', () => {
  const d = evaluate(closeAll(180));
  assert.equal(d.verdict, 'approve');
  assert.equal(d.reasons[0]!.rule, 'FW1_BULK');
  assert.equal(d.needsApproval.length, 180);
  const lines = previewLines(d);
  assert.match(lines[0]!, /180 changes on 180 issues\. Verdict: approve/);
  assert.equal(lines.length, 1 + 1 + 5 + 1);          // summary, reason, 5 examples, "and N more"
  assert.match(lines.at(-1)!, /and 175 more/);
});

test('far above the limit is refused, and so is a denied field, whatever the count', () => {
  assert.equal(evaluate(closeAll(201)).verdict, 'deny');
  const d = evaluate([{ issueKey: 'OPS-1', field: 'reporter', from: 'a', to: 'b' }]);
  assert.equal(d.verdict, 'deny');
  assert.equal(d.reasons[0]!.rule, 'FW2_DENIED_FIELD');
  assert.deepEqual(approvedChanges(d, 'all'), []);                 // approval cannot override a deny
});

test('reopening finished work and touching a protected project need approval, for just those changes', () => {
  const changes: ProposedChange[] = [
    { issueKey: 'PAY-1', field: 'status', from: 'Done', to: 'In Progress' },
    { issueKey: 'OPS-2', field: 'summary', from: 'a', to: 'b' },
    { issueKey: 'SEC-3', field: 'assignee', from: 'x', to: 'y' },
  ];
  const d = evaluate(changes, { ...DEFAULT_POLICY, protectedProjects: ['SEC'] });
  assert.equal(d.verdict, 'approve');
  assert.deepEqual(d.reasons.map((r) => r.rule).sort(), ['FW3_PROTECTED_PROJECT', 'FW4_REOPEN']);
  assert.deepEqual(d.needsApproval.map((c) => c.issueKey).sort(), ['PAY-1', 'SEC-3']);
  // The approver says yes to PAY-1 only: SEC-3 is held back, the unflagged OPS-2 goes through.
  const go = approvedChanges(d, [{ issueKey: 'PAY-1', field: 'status' }]);
  assert.deepEqual(go.map((c) => c.issueKey).sort(), ['OPS-2', 'PAY-1']);
});

test('the same batch and policy always give the same decision', () => {
  assert.deepEqual(evaluate(closeAll(50)), evaluate(closeAll(50)));
});

test('undo puts values back, but never overwrites a later human edit, and says so', () => {
  const j = buildJournal('b1', 'cleanup-agent', closeAll(3), () => '2026-11-27T10:00:00Z');
  const now: Record<string, string> = { 'OPS-1': 'Done', 'OPS-2': 'Reopened by Sam', 'OPS-3': 'Done' };
  const plan = undoPlan(j, (k) => now[k]);
  assert.deepEqual(plan.revert.map((c) => `${c.issueKey}:${c.from}->${c.to}`).sort(), ['OPS-1:Done->In Progress', 'OPS-3:Done->In Progress']);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0]!.why, /Someone changed it since/);
  const unreadable = undoPlan(j, () => undefined);
  assert.equal(unreadable.revert.length, 0);
  assert.equal(unreadable.skipped.length, 3);
});

test('every batch is sealed in the hash chain, and editing the record breaks verification', () => {
  const j = buildJournal('b1', 'cleanup-agent', closeAll(150), () => '2026-11-27T10:00:00Z');
  let chain = seal([], 'FW_APPLIED', j, { verdict: 'approve' }, 'dana', () => '2026-11-27T10:01:00Z');
  chain = seal(chain, 'FW_UNDONE', j, { verdict: 'approve' }, 'dana', () => '2026-11-27T10:05:00Z');
  assert.equal(verifyChain(chain).ok, true);
  assert.equal(chain[0]!.evidence?.fact?.pageValue, journalHash(j));
  assert.match(chain[0]!.evidence?.fact?.ticketLine ?? '', /approved by dana/);
  const tampered = structuredClone(chain);
  tampered[0]!.evidence!.fact!.ticketValue = '1 changes';
  assert.equal(verifyChain(tampered).ok, false);
  assert.ok(!JSON.stringify(chain).includes('In Progress'), 'the record commits to the journal by hash and carries no issue text');
});

test('burst check names an actor who made many changes in a window, whoever it is', () => {
  const t0 = 1_000_000;
  const events = [
    ...Array.from({ length: 45 }, (_, i) => ({ at: t0 + i * 500, actor: 'u-agent' })),
    ...Array.from({ length: 10 }, (_, i) => ({ at: t0 + i * 60_000, actor: 'u-human' })),
  ];
  const b = burst(events);
  assert.deepEqual(b.map((x) => x.actor), ['u-agent']);
  assert.equal(b[0]!.count, 45);
  assert.deepEqual(burst(events.filter((e) => e.actor === 'u-human')), []);
});
