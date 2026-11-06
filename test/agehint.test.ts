import test from 'node:test';
import assert from 'node:assert/strict';
import { ageHint } from '../src/ageHint.ts';
import { contextAround } from '../src/panelModel.ts';

const now = Date.parse('2026-11-07T00:00:00Z');
test('the age hint states dates and points to the older side without ever giving a probability', () => {
  assert.match(ageHint({ pageEditedAt: '2025-08-14T00:00:00Z', itemChangedAt: '2026-11-06T22:00:00Z', now })!, /page was last edited 450 days ago; the work item last changed today\. The page is 449 days older, so it is the more likely side to be out of date\./);
  assert.match(ageHint({ pageEditedAt: '2026-11-06T00:00:00Z', itemChangedAt: '2026-10-01T00:00:00Z', now })!, /Both changed around the same time|work item is 36 days older/);
  assert.match(ageHint({ pageEditedAt: '2026-11-05T00:00:00Z', itemChangedAt: '2026-11-04T00:00:00Z', now })!, /may be a real conflict between two sources/);
  assert.match(ageHint({ pageEditedAt: '2026-11-05T00:00:00Z', now })!, /^The page was last edited 2 days ago\.$/);
  assert.equal(ageHint({ now }), null);
  for (const v of [ageHint({ pageEditedAt: '2025-01-01T00:00:00Z', itemChangedAt: '2026-11-01T00:00:00Z', now })!, ageHint({ pageEditedAt: '2026-11-05T00:00:00Z', itemChangedAt: '2026-11-04T00:00:00Z', now })!]) assert.doesNotMatch(v, /%|probab/i);
});

test('the patch preview shows up to three lines either side of the edited line', () => {
  const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
  assert.deepEqual(contextAround(text, 5), { before: ['line 2', 'line 3', 'line 4'], after: ['line 6', 'line 7', 'line 8'] });
  assert.deepEqual(contextAround(text, 1), { before: [], after: ['line 2', 'line 3', 'line 4'] });
  assert.deepEqual(contextAround(text, 10), { before: ['line 7', 'line 8', 'line 9'], after: [] });
  assert.ok(contextAround('x'.repeat(500), 1).after.length === 0);
});
