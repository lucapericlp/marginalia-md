import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { placeCompactNotes, projectDom, rangeForSource, selectedOffsets } from '../src/dom';
import { addMarginNote, makeAnchor, parseDocument } from '../src/model';

test('a browser selection across text nodes maps to exactly the selected prose', () => {
  const doc = new JSDOM('<p>Some <strong>important</strong> words about R&amp;D.</p>').window.document;
  const p = doc.querySelector('p')!;
  const projection = projectDom(p);
  assert.equal(projection.text, 'Some important words about R&D.');
  const range = doc.createRange();
  range.setStart(p.querySelector('strong')!.firstChild!, 0);
  range.setEnd(p.lastChild!, 6);
  const offsets = selectedOffsets(range, projection)!;
  assert.equal(projection.text.slice(offsets.start, offsets.end), 'important words');
});

test('selection end points do not capture the next character or a neighbouring footnote number', () => {
  const doc = new JSDOM('<p>AI is like air.<sup class="footnote-ref">1</sup> Always there.</p>').window.document;
  const p = doc.querySelector('p')!, range = doc.createRange();
  range.setStart(p.firstChild!, 6); range.setEnd(p.firstChild!, 10);
  const projection = projectDom(p), offsets = selectedOffsets(range, projection)!;
  assert.equal(projection.text.slice(offsets.start, offsets.end), 'like');
  assert.equal(projection.text, 'AI is like air. Always there.');
});

test('a visible selection saves an exact footnote anchor despite soft wraps, emphasis and entities', () => {
  const source = 'AI is **everywhere**, like R&amp;D.\nAlways there.\n';
  const model = parseDocument(source), block = model.blocks[0]!;
  const doc = new JSDOM('<p>AI is <strong>everywhere</strong>, like R&amp;D.\nAlways there.</p>').window.document;
  const p = doc.querySelector('p')!, projection = projectDom(p);
  assert.equal(projection.text, block.projection.text);
  const range = doc.createRange(); range.setStart(p.lastChild!, 7); range.setEnd(p.lastChild!, 10);
  const offsets = selectedOffsets(range, projection)!;
  assert.equal(projection.text.slice(offsets.start, offsets.end), 'R&D');
  const saved = addMarginNote(source, makeAnchor(model, block, offsets.start, offsets.end), 'A thought.', 'mn-s-dom');
  assert.ok(saved.markdown.includes('==R&amp;D==[^mn-s-dom]'));
});

test('the note-to-highlight range stays attached to its exact occurrence in a repeated phrase', () => {
  const source = 'AI is here; ==AI is here==[^mn-s-second].\n\n[^mn-s-second]: The second occurrence.\n';
  const model = parseDocument(source), note = model.notes[0]!;
  const doc = new JSDOM('<p>AI is here; <mark>AI is here</mark>.</p>').window.document;
  const p = doc.querySelector('p')!;
  const range = rangeForSource(p, note.block.projection, note.range!)!;
  assert.equal(range.toString(), 'AI is here');
  assert.equal(range.startContainer.parentElement?.tagName, 'MARK');
});

test('compact notes keep source order and stay inside tight list items', () => {
  const doc = new JSDOM('<article><p id="p">A paragraph.</p><ul><li id="li">A list item.</li></ul></article><aside><section class="mg-note" id="a">A</section><section class="mg-note" id="b">B</section><section class="mg-note" id="c">C</section><section class="mg-note" id="d">D</section></aside>').window.document;
  const p = doc.querySelector<HTMLElement>('#p')!, li = doc.querySelector<HTMLElement>('#li')!;
  const a = doc.querySelector<HTMLElement>('#a')!, b = doc.querySelector<HTMLElement>('#b')!, c = doc.querySelector<HTMLElement>('#c')!, d = doc.querySelector<HTMLElement>('#d')!;
  const items = [{ host: p, element: a }, { host: p, element: b }, { host: li, element: c }, { host: li, element: d }];
  placeCompactNotes(items); placeCompactNotes(items);
  assert.equal(p.nextElementSibling, a);
  assert.equal(a.nextElementSibling, b);
  assert.equal(c.parentElement, li);
  assert.equal(d.parentElement, li);
  assert.deepEqual(Array.from(li.children).map(element => element.id), ['c', 'd']);
  assert.equal(projectDom(li).text, 'A list item.');
});
