import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('the tamper demo script verifies the untouched chain, then fails at the edited entry, and says its data is generated', () => {
  const out = execFileSync('node', ['scripts/demo-tamper.mjs'], { encoding: 'utf8' });
  assert.match(out, /not from a real site/);
  assert.match(out, /OK: 6 entries/);
  assert.match(out, /BROKEN at entry 2: entry was altered/);
});
