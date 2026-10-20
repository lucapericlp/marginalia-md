import type { Nodes } from 'mdast';
import { projectDom } from './dom';
import type { DocumentModel, TextBlock } from './model';

export interface SectionLines { lineStart: number; lineEnd: number }

/** Section source positions disambiguate repeated paragraphs without rewriting Obsidian's rendered prose. */
export function readingBlocks(element: HTMLElement, model: DocumentModel, section?: SectionLines | null): Map<HTMLElement, TextBlock> {
  const lines = [0];
  for (const match of model.markdown.matchAll(/\n/g)) lines.push(match.index + 1);
  const from = section ? lines[section.lineStart] ?? model.markdown.length : 0;
  const to = section ? lines[section.lineEnd + 1] ?? model.markdown.length : model.markdown.length;
  const available = model.blocks.filter(block => block.from >= from && block.from < to);
  const result = new Map<HTMLElement, TextBlock>();
  const candidates = [element, ...element.querySelectorAll<HTMLElement>('p, li')].filter(el => el.matches('p, li') && !el.closest('.footnotes, .footnote-definition, .mg-note, .mg-composer, .internal-embed') && !(el.tagName === 'LI' && el.querySelector('p, li')));
  for (const candidate of candidates) {
    const text = projectDom(candidate).text;
    if (!text) continue;
    const matches = available.filter(block => block.projection.text === text);
    if (!matches.length || (!section && matches.length !== 1)) continue;
    const block = matches[0]!;
    result.set(candidate, block); available.splice(available.indexOf(block), 1);
  }
  return result;
}

function references(node: Nodes): string[] {
  if (node.type === 'footnoteReference') return [node.identifier.toLowerCase()];
  if (node.type === 'footnoteDefinition') return [];
  return 'children' in node ? node.children.flatMap(references) : [];
}

/** Hide only validated Marginalia references and definitions; ordinary and damaged footnotes stay native. */
export function managedFootnoteElements(root: HTMLElement, model: DocumentModel, blocks: Map<HTMLElement, TextBlock>): HTMLElement[] {
  const placed = new Set([...blocks.values()].map(block => block.from));
  const managed = new Set(model.notes.filter(note => placed.has(note.block.from)).map(note => note.id)), result = new Set<HTMLElement>();
  for (const [element, block] of blocks) {
    const ids = references(block.node);
    const refs = Array.from(element.querySelectorAll<HTMLElement>('sup')).filter(sup => sup.querySelector('a') || sup.classList.contains('footnote-ref'));
    if (refs.length === ids.length) refs.forEach((ref, index) => { if (managed.has(ids[index]!)) result.add(ref); });
  }
  const ordered = [...new Set(references(model.tree))];
  const definitions = Array.from(root.querySelectorAll<HTMLElement>('.footnotes > ol > li, .footnotes ol > li.footnote-item, li.footnote-item, .footnote-definition'));
  const ids = [...managed].sort((a, b) => b.length - a.length);
  for (const [index, element] of definitions.entries()) {
    let attributes = [element.id, element.dataset.footnoteId, element.dataset.footnoteLabel].filter(Boolean).join(' ').toLowerCase();
    try { attributes = decodeURIComponent(attributes); } catch { /* Match the ordinary attributes if an ID was not encoded. */ }
    const id = ids.find(id => new RegExp(`(?:^|[^a-z0-9])${id}(?:$|[^a-z0-9])`).test(attributes));
    if (id || (definitions.length === ordered.length && managed.has(ordered[index]!))) result.add(element);
  }
  return [...result];
}
