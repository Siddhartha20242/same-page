import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/engine.ts';
import { BUILT_IN_RULES } from '../src/rules.ts';
import type { Pair } from '../src/types.ts';

// A seeded generator, so a failure here is repeatable: the same seed always builds the same 3000 cases.
function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const BITS = [
  'API v1', 'API v2', 'v3.1', '/api/v1/charge', '/api/v2/refund', 'deprecated', 'do not use', 'superseded', 'was v1', 'in 2019',
  'timeout 30 minutes', 'timeout 15 minutes', 'timeout of 1 hour', 'limit 100 requests', 'limit 200 requests', 'port 8080', 'port 9090',
  'freeze on 2026-12-01', 'freeze on 2026-12-15', 'freeze on 1 Dec 2026', 'waiting on ABC-12', 'blocked by ABC-99', 'status: Done', 'status: In Progress',
  '', ' ', '\n', '\n\n', '\t', '.*', '(unclosed', '[bracket', '\\d+', '$1', '`tick`', '<script>x</script>', '\u0000', '‮', 'ünïcödé', '日本語 v2', '😀',
  'a'.repeat(500), '1'.repeat(300), 'v' + '9'.repeat(40), '0.0.0', '-1', '1e309', 'NaN', 'null', 'undefined', '__proto__', 'constructor',
];
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
const text = (r: () => number) => Array.from({ length: Math.floor(r() * 9) }, () => pick(r, BITS)).join(pick(r, [' ', '\n', '. ', ' - ']));

function makePair(r: () => number): Pair {
  const page = (i: number) => ({ id: `p${i}`, title: text(r).slice(0, 80) || 'T', text: text(r), modifiedAt: pick(r, ['2026-01-01T00:00:00Z', '2026-11-01T00:00:00Z', 'not a date', '']), labels: r() < 0.3 ? ['runbook'] : undefined });
  const main = page(0);
  return {
    workItem: {
      key: 'FZ-1', status: pick(r, ['To Do', 'In Progress', 'Done', '']), text: text(r), statusChangedAt: pick(r, ['2026-06-01T00:00:00Z', 'garbage', '']),
      apiVersion: r() < 0.5 ? pick(r, ['v1', 'v2', '3', 'V2', 'v9.9.9', '', 'vNaN']) : undefined, requiredFields: r() < 0.3 ? ['Owner', 'Rollback'] : undefined,
      fields: r() < 0.3 ? { Owner: pick(r, ['', 'me', null, 0]) } : undefined,
    },
    page: main,
    siblings: r() < 0.5 ? [main, page(1), page(2)] : undefined,
    cited: r() < 0.3 ? { 'ABC-12': { status: pick(r, ['Done', 'Open', '']), changedAt: pick(r, ['2026-05-01T00:00:00Z', 'x']) } } : undefined,
  };
}

const IDS = new Set(BUILT_IN_RULES.map((x) => x.id));
const r = rng(20261119);
const cases = Array.from({ length: 3000 }, () => makePair(r));

test('fuzz: no input makes the engine throw, and every result is well formed', () => {
  for (const p of cases) {
    const res = check(p);
    const real = res.findings.filter((f) => f.severity !== 'info');
    assert.equal(res.verdict, real.some((f) => f.severity === 'block') ? 'BLOCKED' : real.length ? 'WARN' : 'PASS');
    for (const f of res.findings) {
      assert.ok(IDS.has(f.ruleId), `unknown rule ${f.ruleId}`);
      assert.ok(f.summary.trim() && f.why.trim(), `${f.ruleId} has an empty summary or reason`);
      assert.ok(['block', 'warn', 'info'].includes(f.severity));
    }
  }
});

test('fuzz: the same input always gives the same result (rules are deterministic)', () => {
  for (const p of cases) assert.equal(JSON.stringify(check(p)), JSON.stringify(check(structuredClone(p))));
});

test('fuzz: a check never changes its input', () => {
  for (const p of cases.slice(0, 500)) {
    const before = JSON.stringify(p);
    check(p);
    assert.equal(JSON.stringify(p), before);
  }
});

test('regression: ordinary words that are also JavaScript property names never crash a fact rule', () => {
  for (const w of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'prototype']) {
    const p: Pair = {
      workItem: { key: 'A-1', status: 'To Do', text: `The ${w} timeout is 30 minutes.` },
      page: { id: 'p', title: 'Runbook', text: `The ${w} timeout is 15 minutes. Rate limit 200 requests.`, modifiedAt: '2026-01-01T00:00:00Z' },
    };
    assert.doesNotThrow(() => check(p), w);
  }
});
