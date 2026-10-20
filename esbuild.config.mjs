import { build } from 'esbuild';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { bundledNotices } from './scripts/notices.mjs';

const production = !process.argv.includes('--development');
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  outfile: 'main.js',
  minify: production,
  sourcemap: production ? false : 'external',
  legalComments: 'inline',
};
const analysis = await build({ ...options, write: false, metafile: true });
const notices = await bundledNotices(Object.keys(analysis.metafile.inputs));
await writeFile('THIRD_PARTY_NOTICES.md', notices);
const license = await readFile('LICENSE', 'utf8');
const banner = '/*!\nMarginalia MD\n\n' + license.trim() + '\n\n' + notices.replaceAll('*/', '* /').trim() + '\n*/';
await build({ ...options, banner: { js: banner } });
if (production) await rm('main.js.map', { force: true });
