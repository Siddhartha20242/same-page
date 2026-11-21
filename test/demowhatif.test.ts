import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('the what-if demo script names the page that would start contradicting, changes nothing, and says its data is generated', () => {
  const out = execFileSync('node', ['scripts/demo-whatif.mjs'], { encoding: 'utf8' });
  assert.match(out, /not from a real site/);
  assert.match(out, /Would START contradicting \(1\)/);
  assert.match(out, /Payment runbook/);
  assert.match(out, /Nothing was changed/);
});
