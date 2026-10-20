import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import type { Nodes, Paragraph, Root, FootnoteDefinition } from 'mdast';

export type Scope = 'paragraph' | 'passage';
export interface Span { from: number; to: number }
export interface Projection { text: string; starts: number[]; ends: number[] }
export interface TextBlock extends Span { raw: string; projection: Projection; node: Paragraph; base: number }
export interface MarginNote {
  id: string; scope: Scope; body: string; block: TextBlock; reference: Span; definition: Span;
  range: Span | null; quote: string; order: number;
}
export interface DocumentModel { markdown: string; bodyStart: number; tree: Root; blocks: TextBlock[]; notes: MarginNote[]; display: string }
export interface Anchor extends Span { scope: Scope; blockFrom: number; blockTo: number; snapshot: string; quote: string }

export function frontmatterEnd(markdown: string): number {
  return /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(markdown)?.[0].length ?? 0;
}
export const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim();
const ownId = (id: string): boolean => /^mn-[ps]-[a-z0-9-]+$/i.test(id);
const span = (node: Nodes, base: number): Span => ({ from: base + node.position!.start.offset!, to: base + node.position!.end.offset! });

function walk(node: Nodes, visit: (node: Nodes) => boolean | void): void {
  if (visit(node) === false) return;
  if ('children' in node) for (const child of node.children) walk(child, visit);
}

/** Map rendered prose back to exact source characters, leaving formatting and references intact. */
function project(markdown: string, node: Paragraph, base: number): Projection {
  const chars: { char: string; from: number; to: number }[] = [];
  walk(node, child => {
    if (child.type === 'footnoteReference' || child.type === 'image' || child.type === 'html') return false;
    if (child.type !== 'text' && child.type !== 'inlineCode' && child.type !== 'break') return;
    const location = span(child, base);
    if (child.type === 'break') { chars.push({ char: ' ', ...location }); return; }
    let from = location.from, to = location.to;
    if (child.type === 'inlineCode') {
      const raw = markdown.slice(from, to);
      const ticks = /^`+/.exec(raw)?.[0].length ?? 0;
      from += ticks; to -= ticks;
    }
    for (let i = from; i < to;) {
      const raw = markdown.slice(i, to);
      let value = markdown[i]!, length = 1;
      if (/^\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(raw)) { value = raw[1]!; length = 2; }
      else if (raw[0] === '&') {
        const entity = /^&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/i.exec(raw);
        if (entity) {
          const decoded = decodeNamedCharacterReference(entity[1]!);
          if (decoded) { value = decoded; length = entity[0].length; }
        }
      }
      for (const char of value.split('')) chars.push({ char, from: i, to: i + length });
      i += length;
    }
    return false;
  });
  // == is Obsidian's readable highlight syntax, rather than part of the prose.
  const remove = new Set<number>();
  const rawText = chars.map(char => char.char).join('');
  for (const match of rawText.matchAll(/==(?=\S)(?:[^=]|=(?!=))+?==/g)) {
    for (const index of [match.index, match.index + 1, match.index + match[0].length - 2, match.index + match[0].length - 1]) remove.add(index);
  }
  const projection: Projection = { text: '', starts: [], ends: [] };
  chars.forEach((entry, index) => {
    if (remove.has(index)) return;
    const char = /\s/.test(entry.char) ? ' ' : entry.char;
    if (char === ' ' && (!projection.text || projection.text.endsWith(' '))) {
      if (projection.ends.length) projection.ends[projection.ends.length - 1] = entry.to;
      return;
    }
    projection.text += char; projection.starts.push(entry.from); projection.ends.push(entry.to);
  });
  if (projection.text.endsWith(' ')) { projection.text = projection.text.slice(0, -1); projection.starts.pop(); projection.ends.pop(); }
  return projection;
}

function commentBody(markdown: string, definition: Span): string {
  return markdown.slice(definition.from, definition.to).replace(/^\[\^[^\]]+\]:[ \t]?/, '').replace(/\r?\n(?: {4}|\t)/g, '\n').trim();
}

export function parseDocument(markdown: string): DocumentModel {
  const bodyStart = frontmatterEnd(markdown);
  const tree = fromMarkdown(markdown.slice(bodyStart), { extensions: [gfmFootnote()], mdastExtensions: [gfmFootnoteFromMarkdown()] });
  const definitions = new Map<string, FootnoteDefinition>();
  const duplicates = new Set<string>();
  walk(tree, node => { if (node.type === 'footnoteDefinition') {
    const id = node.identifier.toLowerCase();
    if (definitions.has(id)) duplicates.add(id);
    definitions.set(id, node); return false;
  } });
  const blocks: TextBlock[] = [];
  walk(tree, node => {
    if (node.type === 'footnoteDefinition' || node.type === 'code') return false;
    if (node.type === 'paragraph') {
      const location = span(node, bodyStart);
      blocks.push({ ...location, raw: markdown.slice(location.from, location.to), projection: project(markdown, node, bodyStart), node, base: bodyStart });
      return false;
    }
  });
  const notes: MarginNote[] = [];
  const uses = new Map<string, number>();
  for (const block of blocks) walk(block.node, node => { if (node.type === 'footnoteReference') { const id = node.identifier.toLowerCase(); uses.set(id, (uses.get(id) ?? 0) + 1); } });
  for (const block of blocks) walk(block.node, node => {
    if (node.type !== 'footnoteReference' || !ownId(node.identifier)) return;
    const id = node.identifier.toLowerCase();
    const definitionNode = definitions.get(id);
    // Ambiguous or reused identifiers retain ordinary footnote rendering instead of guessing an anchor.
    if (!definitionNode || duplicates.has(id) || uses.get(id) !== 1) return;
    const reference = span(node, bodyStart);
    const definition = span(definitionNode, bodyStart);
    const scope: Scope = id.startsWith('mn-p-') ? 'paragraph' : 'passage';
    let range: Span | null = null;
    if (scope === 'passage') {
      const prefix = markdown.slice(block.from, reference.from).replace(/(?:\[\^mn-s-[a-z0-9-]+\])+[ \t]*$/i, '').trimEnd();
      if (prefix.endsWith('==')) {
        const opening = prefix.lastIndexOf('==', prefix.length - 3);
        if (opening >= 0) range = { from: block.from + opening + 2, to: block.from + prefix.length - 2 };
      }
      if (!range) return;
    }
    const quote = range ? normalizeText(projectRange(block.projection, range)) : block.projection.text;
    notes.push({ id, scope, body: commentBody(markdown, definition), block, reference, definition, range, quote, order: notes.length + 1 });
  });
  const edits: { from: number; to: number; text: string }[] = [];
  for (const note of notes) edits.push({ ...note.reference, text: '' }, { ...note.definition, text: '' });
  const display = applyEdits(markdown, edits).slice(bodyStart).trim();
  return { markdown, bodyStart, tree, blocks, notes, display };
}

function projectRange(projection: Projection, range: Span): string {
  return projection.text.split('').filter((_char, index) => projection.starts[index]! >= range.from && projection.ends[index]! <= range.to).join('');
}

function applyEdits(markdown: string, edits: (Span & { text: string })[]): string {
  let result = markdown;
  const unique = [...new Map(edits.map(edit => [`${edit.from}:${edit.to}`, edit])).values()];
  for (const edit of unique.sort((a, b) => b.from - a.from)) result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
  return result;
}

export function makeAnchor(model: DocumentModel, block: TextBlock, start?: number, end?: number): Anchor {
  const passage = start !== undefined && end !== undefined && end > start;
  let from = passage ? block.projection.starts[start] : block.from;
  let to = passage ? block.projection.ends[end - 1] : block.to;
  if (from === undefined || to === undefined) throw new Error('Select text within a single paragraph.');
  if (passage) {
    // A whole formatting span may be wrapped; crossing half of it would produce invalid Markdown.
    walk(block.node, node => {
      if (!['emphasis', 'strong', 'link', 'inlineCode', 'delete'].includes(node.type)) return;
      const outer = span(node, block.base);
      const indices = block.projection.starts.map((position, index) => position >= outer.from && position < outer.to ? index : -1).filter(index => index >= 0);
      const first = indices[0], last = indices[indices.length - 1];
      if (first === undefined || last === undefined || end <= first || start > last) return;
      if (start <= first && end > last) { from = Math.min(from!, outer.from); to = Math.max(to!, outer.to); }
      else if (node.type === 'inlineCode') throw new Error('Select the complete inline-code span to annotate it.');
      else if (start <= first || end > last) throw new Error('Keep the selection within one formatted span, or include that span in full.');
    });
    const fragment = model.markdown.slice(from, to);
    if (fragment.includes('==')) throw new Error('Select a passage within one highlight, or a separate unmarked passage.');
  }
  return { scope: passage ? 'passage' : 'paragraph', from, to, blockFrom: block.from, blockTo: block.to, snapshot: model.markdown, quote: passage ? block.projection.text.slice(start, end) : block.projection.text };
}

function definitionText(id: string, body: string, newline: string): string {
  const lines = body.trim().replace(/\r\n/g, '\n').split('\n');
  return `[^${id}]: ${lines[0]}${lines.slice(1).map(line => `${newline}    ${line}`).join('')}`;
}

function rebase(markdown: string, anchor: Anchor): Anchor {
  if (markdown === anchor.snapshot) return anchor;
  const old = anchor.snapshot.slice(anchor.blockFrom, anchor.blockTo);
  const matches = parseDocument(markdown).blocks.filter(block => block.raw === old);
  if (matches.length !== 1) throw new Error('The paragraph changed while you were writing. Your draft is safe; reselect the passage before saving.');
  const shift = matches[0]!.from - anchor.blockFrom;
  return { ...anchor, from: anchor.from + shift, to: anchor.to + shift, blockFrom: anchor.blockFrom + shift, blockTo: anchor.blockTo + shift };
}

export function addMarginNote(markdown: string, original: Anchor, body: string, id = `mn-${original.scope === 'paragraph' ? 'p' : 's'}-${Math.random().toString(36).slice(2, 10)}`): { markdown: string; id: string } {
  if (!body.trim()) throw new Error('Write a thought before saving.');
  if (!ownId(id) || !id.startsWith(`mn-${original.scope === 'paragraph' ? 'p' : 's'}-`) || markdown.includes(`[^${id}]`)) throw new Error('That margin-note identifier is invalid or already in use.');
  const anchor = rebase(markdown, original);
  const model = parseDocument(markdown);
  if (anchor.scope === 'passage' && model.notes.some(note => note.range && note.range.from < anchor.to && note.range.to > anchor.from)) throw new Error('This passage already has a margin note. Edit that note or choose a separate passage.');
  if (anchor.scope === 'passage') {
    const block = markdown.slice(anchor.blockFrom, anchor.blockTo);
    for (const match of block.matchAll(/==(?=\S)(?:[^=]|=(?!=))+?==/g)) {
      const from = anchor.blockFrom + match.index + 2, to = anchor.blockFrom + match.index + match[0].length - 2;
      if (from < anchor.to && to > anchor.from && (from !== anchor.from || to !== anchor.to)) throw new Error('Select the entire existing highlight, or choose an unmarked passage.');
    }
  }
  const reference = `[^${id}]`;
  let edited: string;
  if (anchor.scope === 'paragraph') {
    const raw = markdown.slice(anchor.blockFrom, anchor.blockTo);
    const blockId = /[ \t]+\^[a-z0-9-]+[ \t]*$/i.exec(raw);
    const insertion = blockId ? anchor.blockFrom + blockId.index : anchor.blockTo;
    edited = applyEdits(markdown, [{ from: insertion, to: insertion, text: reference }]);
  } else {
    const existingHighlight = markdown.slice(anchor.from - 2, anchor.from) === '==' && markdown.slice(anchor.to, anchor.to + 2) === '==';
    edited = applyEdits(markdown, existingHighlight
      ? [{ from: anchor.to + 2, to: anchor.to + 2, text: reference }]
      : [{ from: anchor.to, to: anchor.to, text: `==${reference}` }, { from: anchor.from, to: anchor.from, text: '==' }]);
  }
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  return { markdown: `${edited.trimEnd()}${newline}${newline}${definitionText(id, body, newline)}${newline}`, id };
}

export function editMarginNote(markdown: string, id: string, body: string, expectedBody: string): string {
  if (!body.trim()) throw new Error('Write a thought before saving.');
  const note = parseDocument(markdown).notes.find(note => note.id === id);
  if (!note) throw new Error('This margin note has been removed. Your draft is still here.');
  if (note.body !== expectedBody) throw new Error('This margin note changed elsewhere. Copy your draft before reopening it.');
  return applyEdits(markdown, [{ ...note.definition, text: definitionText(id, body, markdown.includes('\r\n') ? '\r\n' : '\n') }]);
}

export function removeMarginNote(markdown: string, id: string, expectedBody: string): string {
  const note = parseDocument(markdown).notes.find(note => note.id === id);
  if (!note || note.body !== expectedBody) throw new Error('This margin note changed elsewhere. Reopen it before removing it.');
  // Keep the independent highlight, like erasing a pencil note beside an inked passage.
  return applyEdits(markdown, [{ ...note.reference, text: '' }, { ...note.definition, text: '' }]);
}

export interface PackedNote { id: string; preferred: number; height: number; top: number }
export function packMarginNotes(notes: { id: string; preferred: number; height: number }[], gap = 20): PackedNote[] {
  let bottom = -gap;
  return [...notes].sort((a, b) => a.preferred - b.preferred).map(note => {
    const top = Math.max(note.preferred, bottom + gap);
    bottom = top + note.height;
    return { ...note, top };
  });
}
