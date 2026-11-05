// The tested engine lives in ./src (TypeScript). The Forge bundler only follows files inside the app folder, so copy it in.
// Copies keep .ts, with relative import specifiers rewritten from './x.ts' to './x' (extensionless, as Forge's bundler expects).
// Run after any change to ./src:  node scripts/sync-core.mjs   (npm run sync)
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
const dest = 'same-page-app/src/core';
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const f of readdirSync('src').filter((f) => f.endsWith('.ts'))) {
  const code = readFileSync(`src/${f}`, 'utf8').replace(/(from\s+'\.{1,2}\/[^']*?)\.ts'/g, "$1'").replace(/(import\('\.{1,2}\/[^']*?)\.ts'\)/g, "$1')");
  writeFileSync(`${dest}/${f}`, code);
}
console.log(`copied ${readdirSync(dest).length} files into ${dest}`);
