import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOpenApi, judgeOperation } from '../src/spec.ts';

const yaml = [
  'Our payments API spec:',
  'openapi: 3.0.3',
  'info:',
  '  title: Payments',
  '  version: "2.0"',
  'servers:',
  '  - url: https://api.example.com/api/v2',
  'paths:',
  '  /charge:',
  '    post:',
  '      summary: Charge a card',
  '  /charge/{id}:',
  '    delete:',
  '      deprecated: true',
  '',
  'After the spec, some prose that is not YAML: see the runbook.',
].join('\n');

test('an OpenAPI spec written in YAML is read, with its operations, base path and deprecated flags', () => {
  const spec = extractOpenApi(yaml);
  assert.ok(spec);
  assert.equal(spec!.title, 'Payments');
  assert.deepEqual(spec!.operations.map((o) => `${o.method} ${o.path}${o.deprecated ? ' (deprecated)' : ''}`), ['POST /charge', 'DELETE /charge/{id} (deprecated)']);
  assert.deepEqual(spec!.basePaths, ['/api/v2']);
});

test('a documented line is judged against a YAML spec the same way as against a JSON one', () => {
  const spec = extractOpenApi(yaml)!;
  assert.equal(judgeOperation(spec, { method: 'DELETE', path: '/api/v2/charge/42' })?.kind, 'deprecated');
  assert.equal(judgeOperation(spec, { method: 'POST', path: '/api/v2/charge' }), null);
  assert.equal(judgeOperation(spec, { method: 'POST', path: '/api/v2/refund' })?.kind, 'missing');
});

test('YAML that is not a spec, broken YAML and aliases bombs are ignored, never thrown', () => {
  assert.equal(extractOpenApi('openapi: 3.0.0\npaths: [unclosed'), null);
  assert.equal(extractOpenApi('just some words about openapi: nothing'), null);
  assert.equal(extractOpenApi('title: Payments\nversion: 2'), null);
  const bomb = ['openapi: 3.0.0', 'x: &a [1,2,3]', ...Array.from({ length: 80 }, (_, i) => `y${i}: *a`), 'paths:', '  /a:', '    get: {}'].join('\n');
  assert.doesNotThrow(() => extractOpenApi(bomb));
});

test('JSON specs are still read as before', () => {
  const json = '{"openapi":"3.0.0","paths":{"/charge":{"post":{}}}}';
  assert.equal(extractOpenApi(json)!.operations.length, 1);
});
