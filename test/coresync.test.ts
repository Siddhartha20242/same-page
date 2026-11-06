import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// The app bundles a copy of ./src in same-page-app/src/core (see scripts/sync-core.mjs). If src changes and the copy is not refreshed,
// the deployed app silently runs old rules. This fails until `npm run sync` has been run.
const root = new URL('../', import.meta.url);
const expected = (code: string) => code.replace(/(from\s+'\.{1,2}\/[^']*?)\.ts'/g, "$1'").replace(/(import\('\.{1,2}\/[^']*?)\.ts'\)/g, "$1')");

test('the bundled copy of the engine matches src', () => {
  const files = readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.ts'));
  const bundled = new Set(readdirSync(new URL('same-page-app/src/core/', root)));
  for (const f of files) {
    assert.ok(bundled.has(f), `${f} is missing from same-page-app/src/core; run npm run sync`);
    assert.equal(readFileSync(new URL(`same-page-app/src/core/${f}`, root), 'utf8'), expected(readFileSync(new URL(`src/${f}`, root), 'utf8')), `${f} is stale in same-page-app/src/core; run npm run sync`);
  }
  for (const f of bundled) assert.ok(files.includes(f), `${f} is in same-page-app/src/core but no longer in src; run npm run sync`);
});
