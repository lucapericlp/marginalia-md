import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import doiuse from 'doiuse';

const path = new URL('../styles.css', import.meta.url);
const source = await readFile(path, 'utf8');
const root = postcss.parse(source, { from: path.pathname });
root.walkDecls(declaration => {
  if (declaration.important) throw declaration.error('Use scoped selectors or layout structure instead of !important.');
});
root.walkRules(rule => {
  const properties = new Set();
  rule.each(node => {
    if (node.type !== 'decl') return;
    const property = node.prop.startsWith('--') ? node.prop : node.prop.toLowerCase();
    if (properties.has(property)) throw node.error(`Duplicate CSS property: ${property}.`);
    properties.add(property);
  });
});
const result = await postcss([doiuse({ browsers: ['electron >= 39'] })]).process(root, { from: path.pathname });
const warnings = result.warnings();
if (warnings.length) throw new Error(warnings.map(warning => warning.toString()).join('\n'));
console.log('CSS passes: no !important declarations, duplicate properties, or unsupported browser features.');
