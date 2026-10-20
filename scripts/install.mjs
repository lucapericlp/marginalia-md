import { access, copyFile, mkdir, readFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const vault = process.argv[2];
if (!vault) throw new Error('Supply an existing vault path.');
const root = resolve(import.meta.dirname, '..');
await access(join(vault, '.obsidian'));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const destination = join(vault, '.obsidian/plugins', manifest.id);
await mkdir(destination, { recursive: true });
for (const file of ['main.js', 'styles.css', 'manifest.json']) {
  await copyFile(join(root, file), join(destination, `.${file}.installing`));
  await rename(join(destination, `.${file}.installing`), join(destination, file));
}
console.log(`Installed ${manifest.name} ${manifest.version} in ${vault}`);
