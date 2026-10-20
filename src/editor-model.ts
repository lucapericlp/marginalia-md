import { makeAnchor, type Anchor, type DocumentModel, type Span } from './model';
import { diffChars } from 'diff';

export function anchorFromSelection(model: DocumentModel, from: number, to: number): Anchor {
  const block = model.blocks.find(block => from >= block.from && from <= block.to && to <= block.to);
  if (!block) throw new Error('Select text within one paragraph, or put the cursor in that paragraph.');
  if (from === to) return makeAnchor(model, block);
  const start = block.projection.starts.findIndex(position => position >= from);
  const last = block.projection.ends.findLastIndex(position => position <= to);
  if (start < 0 || last < start) throw new Error('Select the words you want to annotate.');
  return makeAnchor(model, block, start, last + 1);
}

/** Preserve untouched source ranges so saving a footnote at EOF does not move the Vim cursor there. */
export function textChanges(before: string, after: string): (Span & { insert: string })[] {
  const parts = diffChars(before, after, { timeout: 300 });
  if (!parts) throw new Error('This change is too large to apply safely in the editor. Your draft is still here.');
  const changes: (Span & { insert: string })[] = [];
  let offset = 0, pending: (Span & { insert: string }) | null = null;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      if (pending) changes.push(pending);
      pending = null; offset += part.value.length;
    } else {
      pending ??= { from: offset, to: offset, insert: '' };
      if (part.removed) { pending.to += part.value.length; offset += part.value.length; }
      else pending.insert += part.value;
    }
  }
  if (pending) changes.push(pending);
  return changes;
}
