import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { readingBlocks, managedFootnoteElements } from '../src/reading-dom';
import { parseDocument } from '../src/model';
import { projectDom, rangeForSource } from '../src/dom';

test('Reading view maps repeated paragraphs by source section without rewriting prose', () => {
  const markdown = 'Repeated paragraph.\n\nRepeated paragraph.[^mn-p-second]\n\n[^mn-p-second]: On the second one.\n';
  const model = parseDocument(markdown);
  const doc = new JSDOM('<section><p>Repeated paragraph.<sup><a href="#fn-1">1</a></sup></p></section>').window.document;
  const section = doc.querySelector<HTMLElement>('section')!, original = section.innerHTML;
  const matches = readingBlocks(section, model, { lineStart: 2, lineEnd: 2 });
  assert.equal(matches.size, 1);
  assert.equal([...matches.values()][0]?.from, markdown.indexOf('Repeated paragraph.', 1));
  assert.equal(section.innerHTML, original);
  assert.equal(readingBlocks(section, model).size, 0);
});

test('managed footnotes are identified alongside ordinary footnotes without hiding the ordinary ones', () => {
  const markdown = 'A ==passage==[^mn-s-a], a normal note[^ordinary], and a paragraph note.[^mn-p-b]\n\n[^ordinary]: Ordinary.\n\n[^mn-s-a]: Passage thought.\n\n[^mn-p-b]: Paragraph thought.\n';
  const model = parseDocument(markdown);
  const doc = new JSDOM('<article><p>A <mark>passage</mark><sup id="a"><a>1</a></sup>, a normal note<sup id="ordinary-ref"><a>2</a></sup>, and a paragraph note.<sup id="b"><a>3</a></sup></p><section class="footnotes"><ol><li id="fn-mn-s-a">Passage thought.</li><li id="fn-ordinary">Ordinary.</li><li id="fn-mn-p-b">Paragraph thought.</li></ol></section></article>').window.document;
  const root = doc.querySelector<HTMLElement>('article')!, mapping = readingBlocks(root, model, { lineStart: 0, lineEnd: 0 });
  const hidden = managedFootnoteElements(root, model, mapping);
  assert.deepEqual(hidden.map(el => el.id), ['a', 'b', 'fn-mn-s-a', 'fn-mn-p-b']);
  assert.ok(!hidden.includes(doc.querySelector('#fn-ordinary')!));
  assert.deepEqual(managedFootnoteElements(root, model, new Map()), [], 'unplaced notes keep their readable standard footnotes');
  const paragraph = root.querySelector('p')!, note = model.notes[0]!;
  assert.equal(rangeForSource(paragraph, note.block.projection, note.range!)?.toString(), 'passage');
  assert.equal(projectDom(paragraph).text, 'A passage, a normal note, and a paragraph note.');
});

test('missing and reused annotation anchors retain their standard footnotes in Reading view', () => {
  const model = parseDocument('Repeated[^mn-p-reused].\n\nRepeated[^mn-p-reused].\n\n[^mn-p-reused]: Ambiguous.');
  const doc = new JSDOM('<article><p>Repeated<sup><a>1</a></sup>.</p><p>Repeated<sup><a>1</a></sup>.</p><section class="footnotes"><ol><li id="fn-mn-p-reused">Ambiguous.</li></ol></section></article>').window.document;
  const root = doc.querySelector<HTMLElement>('article')!;
  assert.deepEqual(managedFootnoteElements(root, model, readingBlocks(root, model)), []);
});

test('plugin styles preserve theme-controlled article fonts, size, line spacing, colour and properties', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const doc = new JSDOM(`<style>.cm-content,.markdown-preview-sizer > p{font-family:VaultFont;font-size:19px;line-height:1.45;color:rgb(12,34,56)}.metadata-container{display:block}</style><style>${css}</style><div class="markdown-source-view mod-cm6 mg-native mg-has-margins"><div class="metadata-container"></div><div class="cm-sizer"><div class="cm-content">Editor text</div></div></div><div class="markdown-preview-view mg-reading mg-has-margins"><div class="markdown-preview-sizer"><p>Reading text</p></div></div>`).window;
  for (const element of doc.document.querySelectorAll('.cm-content,.markdown-preview-sizer > p')) {
    const style = doc.getComputedStyle(element);
    assert.equal(style.fontFamily, 'VaultFont');
    assert.equal(style.fontSize, '19px');
    assert.equal(style.lineHeight, '1.45');
    assert.equal(style.color, 'rgb(12, 34, 56)');
  }
  assert.equal(doc.getComputedStyle(doc.document.querySelector('.metadata-container')!).display, 'block');
});
