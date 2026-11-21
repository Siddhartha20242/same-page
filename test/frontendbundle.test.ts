import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Seen at a real deploy: the panel imported a value from a core module that, further down, used `node:crypto`. Forge bundles the panel for the
// browser and fails with "UnhandledSchemeError". Types are erased, so only value imports count. This walks them offline.
const root = new URL('../same-page-app/src/frontend/', import.meta.url).pathname;
const IMPORT = /^\s*import\s+(type\s+)?([^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

function valueImports(file: string): string[] {
  const out: string[] = [];
  for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
    if (m[1]) continue; // import type
    out.push(m[3]!);
  }
  return out;
}
const resolveLocal = (from: string, spec: string) => [resolve(dirname(from), spec), resolve(dirname(from), spec) + '.ts', resolve(dirname(from), spec) + '.tsx'].find((p) => existsSync(p) && !p.endsWith('/') && /\.tsx?$/.test(p));

test('no file the panel imports by value, however deep, needs a Node-only module', () => {
  const seen = new Set<string>();
  const bad: string[] = [];
  const walk = (file: string, via: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of valueImports(file)) {
      if (spec.startsWith('node:')) { bad.push(`${via} -> ${spec}`); continue; }
      if (!spec.startsWith('.')) continue;
      const next = resolveLocal(file, spec);
      if (next) walk(next, `${via} -> ${spec}`);
    }
  };
  const files = readdirSync(root).filter((f) => /\.tsx?$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) walk(join(root, f), f);
  assert.deepEqual(bad, [], 'a panel bundle would fail to build');
});
