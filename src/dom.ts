import { normalizeText, type Projection, type Span } from './model';

interface Point { node: Text; offset: number }
export interface DomProjection { text: string; starts: Point[]; ends: Point[] }

export function projectDom(element: HTMLElement): DomProjection {
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, 4 /* SHOW_TEXT */);
  const result: DomProjection = { text: '', starts: [], ends: [] };
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const node = current as Text;
    if (node.parentElement?.closest('sup, .footnote-ref, .footnote-backref, .footnote-backlink, .mg-control, .mg-note, .mg-composer, .image-embed')) continue;
    for (let i = 0; i < node.data.length; i++) {
      const char = /\s/.test(node.data[i]!) ? ' ' : node.data[i]!;
      if (char === ' ' && (!result.text || result.text.endsWith(' '))) {
        if (result.ends.length) result.ends[result.ends.length - 1] = { node, offset: i + 1 };
        continue;
      }
      result.text += char; result.starts.push({ node, offset: i }); result.ends.push({ node, offset: i + 1 });
    }
  }
  if (result.text.endsWith(' ')) { result.text = result.text.slice(0, -1); result.starts.pop(); result.ends.pop(); }
  return result;
}

export function selectedOffsets(range: Range, projection: DomProjection): { start: number; end: number } | null {
  const indices = projection.starts.map((start, index) => {
    const end = projection.ends[index]!;
    return range.comparePoint(start.node, start.offset) === 0 && range.comparePoint(end.node, end.offset) === 0 ? index : -1;
  }).filter(index => index >= 0);
  let start = indices[0], last = indices[indices.length - 1];
  if (start === undefined || last === undefined) return null;
  while (start <= last && projection.text[start] === ' ') start++;
  while (last >= start && projection.text[last] === ' ') last--;
  return last >= start ? { start, end: last + 1 } : null;
}

export function rangeForSource(element: HTMLElement, source: Projection, span: Span): Range | null {
  const dom = projectDom(element);
  if (normalizeText(dom.text) !== normalizeText(source.text)) return null;
  const indices = source.starts.map((from, index) => from >= span.from && source.ends[index]! <= span.to ? index : -1).filter(index => index >= 0);
  const first = indices[0], last = indices[indices.length - 1];
  if (first === undefined || last === undefined) return null;
  const start = dom.starts[first], end = dom.ends[last];
  if (!start || !end) return null;
  const range = element.ownerDocument.createRange();
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  return range;
}

/** Keep multiple notes in source order beneath either a paragraph or a tight list item. */
export function placeCompactNotes(items: { host: HTMLElement; element: HTMLElement }[]): void {
  const groups = new Map<HTMLElement, HTMLElement[]>();
  for (const item of items) { const group = groups.get(item.host) ?? []; group.push(item.element); groups.set(item.host, group); }
  for (const [host, elements] of groups) {
    if (host.tagName === 'LI') {
      const tail = Array.from(host.children).slice(-elements.length);
      if (!elements.every((element, index) => tail[index] === element)) for (const element of elements) host.append(element);
    } else {
      let previous = host;
      for (const element of elements) { if (previous.nextElementSibling !== element) previous.after(element); previous = element; }
    }
  }
}
