import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
let normalBuild;
for (const args of [[], ['--production']]) {
  execFileSync(process.execPath, ['esbuild.config.mjs', ...args], { cwd: root, stdio: 'inherit' });
  const bytes = await readFile(new URL('../main.js', import.meta.url));
  if (!args.length) normalBuild = bytes;
  else assert.deepEqual(bytes, normalBuild, 'The scanner build must match the release build byte for byte.');
}
console.log('Normal and release builds are byte-identical.');
