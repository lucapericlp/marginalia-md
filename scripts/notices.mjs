import { dirname, join, resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

/** Include the licenses of precisely the packages that esbuild bundles. */
export async function bundledNotices(inputs) {
  const packages = new Map();
  for (const input of inputs) {
    if (!input.startsWith('node_modules/')) continue;
    let directory = dirname(resolve(input));
    while (directory !== dirname(directory)) {
      try {
        const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (pkg.name) { packages.set(`${pkg.name}@${pkg.version}`, { directory, pkg }); break; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      directory = dirname(directory);
    }
  }
  const sections = [];
  for (const [name, { directory, pkg }] of [...packages].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const file = (await readdir(directory)).find(file => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(file));
    if (!file) throw new Error(`Missing license for bundled dependency ${name}.`);
    const license = (await readFile(join(directory, file), 'utf8')).trim();
    sections.push(`## ${name}\n\nLicense: ${pkg.license ?? 'See below'}\n\n${license}`);
  }
  if (!sections.length) throw new Error('No bundled dependency licenses found.');
  return '# Third-party notices\n\nGenerated from the dependencies included in main.js. These notices are also embedded in the distributed JavaScript so they travel with Community Plugins installations.\n\n' + sections.join('\n\n---\n\n') + '\n';
}
