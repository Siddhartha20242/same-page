import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('the silence demo flags the one real contradiction and stays silent on the other seven, and says its data is generated', () => {
  const out = execFileSync('node', ['scripts/demo-silent.mjs'], { encoding: 'utf8' });
  assert.match(out, /not from a real site/);
  assert.equal((out.match(/^FLAGGED/gm) ?? []).length, 1);
  assert.equal((out.match(/^silent/gm) ?? []).length, 7);
  assert.match(out, /^FLAGGED {2}A real contradiction/m);
});
