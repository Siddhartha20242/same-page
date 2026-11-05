import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/engine.ts';
import { proposeFix } from '../src/propose.ts';
import { storageToText } from '../src/adapters.ts';
import { applyToStorage, applyProposal, buildPageUpdate } from '../src/apply.ts';
import type { ApplicableProposal } from '../src/apply.ts';
import type { Page, WorkItem } from '../src/types.ts';

const workItem: WorkItem = { key: 'PAY-1', status: 'In Progress', apiVersion: 'v2', statusChangedAt: '2026-10-01T00:00:00Z', requiredFields: [], fields: {} };
// Proposal is a union; the tests below only pass it on when it is the ok:true member (or check the refusal).
const proposalFor = async (html: string) => {
  const page: Page = { id: 'p1', title: 'Runbook', text: storageToText(html), modifiedAt: '2026-08-01T00:00:00Z', labels: [] };
  return (await proposeFix({ finding: check({ workItem, page }).findings[0]!, page, workItem })) as ApplicableProposal;
};

test('applying a proposal edits the page source and the visible text changes on that line only', async () => {
  const html = '<h2>Charging</h2><p>Call POST /api/v1/charge to charge.</p><p>Escalate on 5xx.</p>';
  const out = applyProposal({ html, proposal: await proposalFor(html), target: 'v2' });
  assert.equal(out.ok, true);
  assert.equal((out as { html: string }).html, '<h2>Charging</h2><p>Call POST /api/v2/charge to charge.</p><p>Escalate on 5xx.</p>');
});

test('lines with entities round-trip safely', async () => {
  const html = '<p>Use R&amp;D gateway at /api/v1/pay.</p>';
  const out = applyProposal({ html, proposal: await proposalFor(html), target: 'v2' });
  assert.equal(out.ok, true);
  assert.equal((out as { html: string }).html, '<p>Use R&amp;D gateway at /api/v2/pay.</p>');
});

test('inline formatting that splits the line is fixed token by token, only where the match is unambiguous', async () => {
  const html = '<p>Call POST <strong>/api/v1</strong>/charge now.</p>';
  const out = applyProposal({ html, proposal: await proposalFor(html), target: 'v2' });
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.html, '<p>Call POST <strong>/api/v2</strong>/charge now.</p>');
});

test('...and refuses, telling the person to copy the edit, when the token could be in two places', async () => {
  const html = '<p>Call POST <strong>/api/v1</strong>/charge now. Also <em>/api/v1</em>/charge later.</p>';
  const out = applyToStorage(html, 'Call POST /api/v1/charge now. Also /api/v1/charge later.', 'Call POST /api/v2/charge now. Also /api/v1/charge later.');
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /copy the suggestion manually/);
});

test('refuses when the line appears twice', () => {
  const out = applyToStorage('<p>Use v1.</p><p>Use v1.</p>', 'Use v1.', 'Use v2.');
  assert.equal(out.ok, false);
  assert.match((out as { reason: string }).reason, /more than once/);
});

test('refuses without a verified proposal', () => {
  assert.equal(applyProposal({ html: '<p>x</p>', proposal: { ok: false } as unknown as ApplicableProposal, target: 'v2' }).ok, false);
});

test('the page update is a new version with a traceable, revertible message', () => {
  const u = buildPageUpdate({ page: { id: 7, title: 'Runbook' }, newHtml: '<p>x</p>', currentVersion: 4, issueKey: 'PAY-1', approver: 'dana' });
  assert.equal(u.version.number, 5);
  assert.equal(u.version.message, 'Same Page: version fix for PAY-1, approved by dana');
  assert.equal(u.body.representation, 'storage');
});

test('findings carry a plain-language reason they matter', () => {
  const page: Page = { id: 'p', title: 't', text: 'Use v1.', modifiedAt: '2026-08-01T00:00:00Z', labels: [] };
  assert.match(check({ workItem, page }).findings[0]!.why, /moved away from/);
});
