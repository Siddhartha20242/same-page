import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('the incident demo finds the stale version, timeout and freeze date, says what it does not find, and says its data is generated', () => {
  const out = execFileSync('node', ['scripts/demo-incident.mjs'], { encoding: 'utf8' });
  assert.match(out, /not from a real site/);
  assert.match(out, /found 3 contradiction/);
  assert.match(out, /R1 {2}Page documents v1/);
  assert.match(out, /R8 {2}Page says timeout is 30 seconds/);
  assert.match(out, /R10 {2}Page says the code freeze/);
  assert.match(out, /Not found: the retired namespace/);
});
