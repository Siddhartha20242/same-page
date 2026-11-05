import test from 'node:test';
import assert from 'node:assert/strict';
import { lastStatusTransition, deriveApiVersion, storageToText, normalizePage } from '../src/adapters.ts';
import { scanEpics, formatScan } from '../src/scan.ts';
import type { Page } from '../src/types.ts';

test('lastStatusTransition picks the latest status change, ignoring other fields', () => {
  const entries = [
    { created: '2026-10-01T10:00:00Z', author: { displayName: 'Dana' }, items: [{ field: 'status' }] },
    { created: '2026-10-05T10:00:00Z', author: { displayName: 'Lee' }, items: [{ field: 'assignee' }] },
    { created: '2026-10-03T10:00:00Z', author: { displayName: 'Sam' }, items: [{ field: 'status' }] },
  ];
  assert.deepEqual(lastStatusTransition(entries), { at: '2026-10-03T10:00:00Z', by: 'Sam' });
  assert.equal(lastStatusTransition([]), null);
});

test('deriveApiVersion reads the summary token', () => {
  assert.equal(deriveApiVersion({ summary: 'Migrate Payment API to v2' }), 'v2');
  assert.equal(deriveApiVersion({ summary: 'Improve search' }), undefined);
});

test('storageToText strips markup and keeps line structure', () => {
  assert.equal(storageToText('<p>A &amp; B</p><p>Call /api/v1/x</p>'), 'A & B\nCall /api/v1/x');
});

test('normalizePage uses the latest version timestamp as last edit', () => {
  const p = normalizePage({ id: 7, title: 'T', createdAt: '2026-01-01T00:00:00Z',
    version: { createdAt: '2026-09-01T00:00:00Z', authorId: 'u1' }, body: { storage: { value: '<p>v1</p>' } } });
  assert.equal(p.modifiedAt, '2026-09-01T00:00:00Z');
  assert.equal(p.id, '7');
});

test('scanEpics ranks epics by contradiction count and skips epics with no transition', async () => {
  const mk = (key: string, summary: string) => ({ key, summary, status: 'In Progress', requiredFields: [], fields: {} });
  const old = '2026-08-01T00:00:00Z';
  const out = await scanEpics({
    listOpenEpics: async () => [mk('A-1', 'Move to v2'), mk('B-1', 'Move to v3'), mk('C-1', 'Move to v2')],
    getTransition: async (k: string) => (k === 'C-1' ? null : { at: '2026-10-01T00:00:00Z', by: 'Dana' }),
    findCandidatePages: async (e) => (e.key === 'A-1'
      ? [{ id: 'p1', text: 'Use v1.', modifiedAt: old, labels: [] }] as unknown as Page[]       // no title on purpose
      : [{ id: 'p2', text: 'Use v1.', modifiedAt: old, labels: ['deprecated'] }, { id: 'p3', text: 'Use v1.', modifiedAt: old, labels: [] }] as unknown as Page[]),
  });
  assert.deepEqual(out.map((r) => [r.key, r.count]), [['B-1', 3], ['A-1', 1]]);
  assert.match(formatScan(out), /B-1 .*: 3 contradictions/);
  assert.equal(formatScan([]), 'No contradictions found in the epics and pages checked.');
});
