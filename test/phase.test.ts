import test from 'node:test';
import assert from 'node:assert/strict';
import { refsInLine, versionMismatch } from '../src/rules.ts';

test('"v1" as a delivery phase is not read as an API version (the Cassandra and Flink public-wiki cases)', () => {
  assert.equal(refsInLine('Any feedback about the interface or v1 implementation features').length, 0);
  assert.equal(refsInLine('| V1 is done, and spilling logic will be optimized later | 100%').length, 0);
  assert.equal(refsInLine('Phase v2 starts next quarter').length, 0);
});

test('real API version references still count, including when phase wording is nearby', () => {
  assert.equal(refsInLine('POST /api/v1/charge').length, 1);
  assert.equal(refsInLine('Payments API v1 implementation notes').length, 1);        // API wording wins over phase wording
  assert.equal(refsInLine('Migrate clients to v2 by Friday').length, 1);              // migration wording
  assert.equal(refsInLine('Call the v1 endpoint').length, 1);
  assert.equal(refsInLine('Use v1.4 of the iteration planner').length, 1);            // dotted versions are never skipped
  assert.equal(refsInLine('Use v1').length, 1);                                       // no phase wording at all
});

test('the guard keeps the rule honest end to end', () => {
  const run = (text: string) => versionMismatch.run({ workItem: { key: 'PAY-1', status: 'In Progress', apiVersion: 'v2', statusChangedAt: '2026-11-02T00:00:00Z' } as never, page: { id: 'p', title: 'T', text, modifiedAt: '2026-10-01T00:00:00Z', labels: [] } });
  assert.equal(run('| V1 is done, and spilling logic will be optimized later | 100%').length, 0);
  assert.equal(run('Send requests to POST /api/v1/charge').length >= 1, true);
});

test('a package name or another product\'s three-part release is not an API version (the Solr public-wiki cases)', () => {
  assert.equal(refsInLine('| `swagger3` | `io.swagger.core.v3:swagger-annotations-jakarta` | 2.2.22 | 2.2.31 |').length, 0);
  assert.equal(refsInLine('Apache Solr Operator v0.8.0 released').length, 0);
  assert.equal(refsInLine('Released v1.2.3 of the tool').length, 0);
  // what must still count
  assert.equal(refsInLine('POST /api/v1/charge').length, 1);
  assert.equal(refsInLine('Payments API v2').length, 1);
  assert.equal(refsInLine('Use v1.4 here').length, 1);              // two-part stays
  assert.equal(refsInLine('see https://x.example/api/v2/charge').length, 1);
});
