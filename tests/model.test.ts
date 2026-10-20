import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMarginNote, editMarginNote, makeAnchor, packMarginNotes, parseDocument, removeMarginNote } from '../src/model';

const fixture = '---\ntitle: Swarm intelligence\nsource: https://example.com/article\n---\n\nAI is like a gas, composed of tiny interacting minds.\n\n- Protocols will enable unlike minds to negotiate.\n- Trust has a cost.\n';

test('a passage is anchored by readable highlights and a standard footnote; source text stays intact', () => {
  const model = parseDocument(fixture), block = model.blocks[0]!;
  const from = block.projection.text.indexOf('like a gas');
  const anchor = makeAnchor(model, block, from, from + 'like a gas'.length);
  const result = addMarginNote(fixture, anchor, 'A medium, rather than a single actor.', 'mn-s-air');
  assert.ok(result.markdown.includes('AI is ==like a gas==[^mn-s-air], composed'));
  assert.ok(result.markdown.endsWith('[^mn-s-air]: A medium, rather than a single actor.\n'));
  assert.ok(result.markdown.startsWith(fixture.slice(0, fixture.indexOf('AI'))));
  const parsed = parseDocument(result.markdown);
  assert.equal(parsed.notes[0]?.scope, 'passage');
  assert.equal(parsed.notes[0]?.quote, 'like a gas');
  assert.ok(parsed.display.includes('==like a gas=='));
  assert.ok(!parsed.display.includes('mn-s-air'));
  assert.equal(parsed.blocks[0]?.projection.text, block.projection.text);
});

test('a whole-paragraph note is visually distinguishable by its scope without highlighting the prose', () => {
  const model = parseDocument(fixture), block = model.blocks[0]!;
  const result = addMarginNote(fixture, makeAnchor(model, block), 'What governs the atmosphere?', 'mn-p-whole');
  assert.ok(result.markdown.includes('interacting minds.[^mn-p-whole]'));
  assert.ok(!result.markdown.includes('=='));
  const note = parseDocument(result.markdown).notes[0]!;
  assert.equal(note.scope, 'paragraph');
  assert.equal(note.quote, block.projection.text);
  assert.equal(note.range, null);
});

test('list paragraphs and multiline paragraphs use the same portable format', () => {
  const model = parseDocument(fixture);
  const list = model.blocks[1]!;
  const result = addMarginNote(fixture, makeAnchor(model, list), 'Standards as social infrastructure.', 'mn-p-protocols');
  assert.ok(result.markdown.includes('- Protocols will enable unlike minds to negotiate.[^mn-p-protocols]'));
  assert.equal(parseDocument(result.markdown).notes[0]?.quote, 'Protocols will enable unlike minds to negotiate.');
  const wrapped = 'A paragraph wraps\nonto another line.\n';
  const parsed = parseDocument(wrapped), block = parsed.blocks[0]!;
  const start = block.projection.text.indexOf('wraps');
  const saved = addMarginNote(wrapped, makeAnchor(parsed, block, start, block.projection.text.length), 'Across lines.', 'mn-s-lines');
  assert.ok(saved.markdown.includes('==wraps\nonto another line.==[^mn-s-lines]'));
});

test('existing block IDs, ordinary footnotes, fences and unrelated highlights survive', () => {
  const source = 'Original ==highlight==, plus a source.[^citation] ^block-id\n\n```md\nFake[^mn-p-fake]\n\n[^mn-p-fake]: An example, not a real note.\n```\n\n[^citation]: Source reference.\n';
  const model = parseDocument(source);
  assert.equal(model.notes.length, 0);
  const result = addMarginNote(source, makeAnchor(model, model.blocks[0]!), 'My thought.', 'mn-p-real');
  assert.ok(result.markdown.includes('[^citation][^mn-p-real] ^block-id'));
  assert.ok(parseDocument(result.markdown).display.includes('[^citation]'));
  assert.ok(parseDocument(result.markdown).display.includes('[^citation]: Source reference.'));
  assert.ok(parseDocument(result.markdown).display.includes('Fake[^mn-p-fake]'));
});

test('comment bodies support Markdown and multiple paragraphs, including CRLF notes', () => {
  const source = fixture.replace(/\n/g, '\r\n'), model = parseDocument(source);
  const result = addMarginNote(source, makeAnchor(model, model.blocks[0]!), '**Question:** why?\n\nA second thought with [[A link]].', 'mn-p-rich');
  const parsed = parseDocument(result.markdown);
  assert.equal(parsed.notes[0]?.body, '**Question:** why?\n\nA second thought with [[A link]].');
  assert.equal(result.markdown.replace(/\r\n/g, '').includes('\n'), false);
  assert.ok(result.markdown.includes('\r\n    \r\n    A second thought'));
});

test('edits and deletions affect the footnote, keeping a passage highlight as independent markup', () => {
  const model = parseDocument(fixture), block = model.blocks[0]!;
  const result = addMarginNote(fixture, makeAnchor(model, block, 0, 2), 'Old thought.', 'mn-s-edit');
  const edited = editMarginNote(result.markdown, 'mn-s-edit', 'New **thought**.\nA continuation.', 'Old thought.');
  assert.equal(parseDocument(edited).notes[0]?.body, 'New **thought**.\nA continuation.');
  const deleted = removeMarginNote(edited, 'mn-s-edit', 'New **thought**.\nA continuation.');
  assert.equal(parseDocument(deleted).notes.length, 0);
  assert.ok(deleted.includes('==AI=='));
  assert.ok(!deleted.includes('mn-s-edit'));
  assert.throws(() => editMarginNote(edited, 'mn-s-edit', 'Conflict.', 'Old thought.'), /changed elsewhere/);
});

test('source offsets survive links, emphasis, escapes and HTML entities', () => {
  const source = 'An **important** [idea](https://example.com) about R&amp;D, a \\*literal star\\*.\n';
  const model = parseDocument(source), block = model.blocks[0]!;
  assert.equal(block.projection.text, 'An important idea about R&D, a *literal star*.');
  const start = block.projection.text.indexOf('R&D');
  const saved = addMarginNote(source, makeAnchor(model, block, start, start + 3), 'What counts as research?', 'mn-s-entity');
  assert.ok(saved.markdown.includes('==R&amp;D==[^mn-s-entity]'));
  const full = addMarginNote(source, makeAnchor(model, block, 3, 12), 'The emphasis matters.', 'mn-s-emphasis');
  assert.ok(full.markdown.includes('==**important**==[^mn-s-emphasis]'));
  assert.throws(() => makeAnchor(model, block, 5, 17), /formatted span/);
});

test('an existing highlight can receive a footnote without doubled delimiters', () => {
  const source = 'An ==existing highlight== in the text.\n';
  const model = parseDocument(source), block = model.blocks[0]!;
  assert.equal(block.projection.text, 'An existing highlight in the text.');
  const saved = addMarginNote(source, makeAnchor(model, block, 3, 21), 'Keep the highlight.', 'mn-s-existing');
  assert.ok(saved.markdown.includes('==existing highlight==[^mn-s-existing]'));
  assert.ok(!saved.markdown.includes('===='));
});

test('unrelated edits rebase anchors; changed or ambiguous paragraphs leave the draft unsaved', () => {
  const model = parseDocument(fixture), anchor = makeAnchor(model, model.blocks[0]!);
  const unrelated = fixture.replace('title: Swarm intelligence', 'title: Edited title');
  assert.ok(addMarginNote(unrelated, anchor, 'Still valid.', 'mn-p-rebase').markdown.includes('title: Edited title'));
  assert.throws(() => addMarginNote(fixture.replace('AI is like a gas', 'AI is like water'), anchor, 'Keep my draft.', 'mn-p-stale'), /paragraph changed/);
  const duplicated = `${fixture}\n${model.blocks[0]!.raw}\n`;
  assert.throws(() => addMarginNote(duplicated, anchor, 'Which paragraph?', 'mn-p-ambiguous'), /paragraph changed/);
});

test('overlapping annotations are rejected rather than corrupting highlight syntax', () => {
  const model = parseDocument(fixture), block = model.blocks[0]!;
  const saved = addMarginNote(fixture, makeAnchor(model, block, 0, 10), 'One thought.', 'mn-s-first');
  const parsed = parseDocument(saved.markdown), updated = parsed.blocks[0]!;
  assert.throws(() => addMarginNote(saved.markdown, makeAnchor(parsed, updated, 2, 8), 'An overlap.', 'mn-s-second'), /already has/);
});

test('nearby notes stack in the margin without overlaps or changes to the article', () => {
  const input = [{ id: 'a', preferred: 100, height: 70 }, { id: 'b', preferred: 110, height: 30 }, { id: 'c', preferred: 400, height: 50 }];
  const packed = packMarginNotes(input, 20);
  assert.deepEqual(packed.map(note => note.top), [100, 190, 400]);
  assert.equal(input[1]?.preferred, 110);
});

test('reused, duplicate, missing and damaged anchors retain standard footnote rendering', () => {
  const cases = [
    'One[^mn-p-x] and two[^mn-p-x].\n\n[^mn-p-x]: A shared footnote.\n',
    'One[^mn-p-x].\n\n[^mn-p-x]: First.\n\n[^mn-p-x]: Duplicate.\n',
    'A missing definition[^mn-p-missing].\n',
    'An unmarked passage[^mn-s-damaged].\n\n[^mn-s-damaged]: Highlight removed.\n',
  ];
  for (const source of cases) {
    const model = parseDocument(source);
    assert.equal(model.notes.length, 0);
    assert.equal(model.display, source.trim());
  }
});

test('partial manual highlights and partial inline code are rejected without altering the note', () => {
  const source = 'An ==existing highlight== and `inline code`.\n';
  const model = parseDocument(source), block = model.blocks[0]!;
  assert.throws(() => addMarginNote(source, makeAnchor(model, block, 5, 12), 'Not nested.', 'mn-s-nested'), /entire existing highlight/);
  const start = block.projection.text.indexOf('inline');
  assert.throws(() => makeAnchor(model, block, start + 1, start + 4), /inline-code/);
});
