import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { zipSync } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const destination = join(root, 'dist', manifest.version);
await mkdir(destination, { recursive: true });
const releaseFiles = ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
const documentation = [
  'README.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
  'docs/preview-native.png', 'docs/preview-reading.png',
  'docs/community-submission.md',
  `docs/releases/${manifest.version}.md`,
  'examples/The art of paying attention.md',
];
const archive = {}, hashes = [];
for (const file of [...releaseFiles, ...documentation]) {
  const bytes = await readFile(join(root, file));
  await mkdir(dirname(join(destination, file)), { recursive: true });
  await copyFile(join(root, file), join(destination, file));
  archive[`marginalia/${file}`] = [bytes, { mtime: new Date('1980-01-01T00:00:00Z') }];
  if (releaseFiles.includes(file)) hashes.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`);
}
const filename = `marginalia-${manifest.version}.zip`;
const zip = zipSync(archive, { level: 9 });
await writeFile(join(destination, filename), zip);
hashes.push(`${createHash('sha256').update(zip).digest('hex')}  ${filename}`);
await writeFile(join(destination, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
console.log(`Packaged ${filename} and Community Plugins release assets in dist/${manifest.version}/.`);
