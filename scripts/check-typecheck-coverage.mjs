import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const missing = [];
let checked = 0;

function hasTypedSource(directory) {
  if (!existsSync(directory)) return false;
  return readdirSync(directory, { withFileTypes: true }).some((entry) => (
    entry.isDirectory()
      ? hasTypedSource(join(directory, entry.name))
      : /\.(?:ts|tsx|mts|cts|vue)$/u.test(entry.name)
  ));
}

for (const group of ['apps', 'packages']) {
  for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, group, entry.name);
    if (!hasTypedSource(join(directory, 'src'))) continue;
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (!manifest.scripts?.typecheck) missing.push(`${group}/${entry.name}`);
    checked++;
  }
}

if (missing.length) throw new Error(`Production workspaces missing typecheck: ${missing.join(', ')}`);
console.log(`Typecheck coverage check passed (${checked} production workspaces).`);
