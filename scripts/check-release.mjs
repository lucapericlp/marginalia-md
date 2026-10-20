import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const manifest = await json('manifest.json');
const pkg = await json('package.json');
const versions = await json('versions.json');
assert.match(manifest.id, /^[a-z]+(?:-[a-z]+)*$/);
assert.ok(!manifest.id.includes('obsidian') && !manifest.id.endsWith('plugin'));
assert.equal(manifest.id, 'marginalia');
assert.equal(manifest.name, 'Marginalia');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.match(manifest.minAppVersion, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, manifest.version, 'Package and manifest versions differ.');
assert.equal(versions[manifest.version], manifest.minAppVersion, 'versions.json needs the current release.');
assert.equal(pkg.license, 'MIT');
assert.ok(manifest.author && manifest.description);
assert.ok(manifest.description.length <= 250 && manifest.description.endsWith('.'));
assert.equal(typeof manifest.isDesktopOnly, 'boolean');
if (process.argv[2]) assert.equal(process.argv[2], manifest.version, 'Use the manifest version as the release tag, without a v prefix.');
const source = await readFile(new URL('../main.js', import.meta.url), 'utf8');
assert.ok(source.length > 1000, 'Build main.js first.');
assert.doesNotMatch(source, /sourceMappingURL=/, 'Use build:release to omit development source maps.');
assert.doesNotMatch(source, /\/Users\/|\/home\/|\.backups\//, 'Release contains a local development path.');
assert.ok(source.includes('Third-party notices') && source.includes('MIT License'));
// Parse without executing plugin code outside Obsidian.
new Function('require', 'module', 'exports', source);
for (const file of ['styles.css', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.ok((await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).trim());
console.log(`Validated Marginalia ${manifest.version} for Obsidian ${manifest.minAppVersion}+. Release tag: ${manifest.version}.`);
