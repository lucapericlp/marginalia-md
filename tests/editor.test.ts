import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EditorState as CMState, Transaction as CMTransaction } from '@codemirror/state';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { anchorFromSelection, textChanges } from '../src/editor-model';
import { parseDocument, addMarginNote } from '../src/model';
const require = createRequire(import.meta.url);
const { EditorState, EditorSelection, Transaction } = require('@codemirror/state') as typeof import('@codemirror/state');
const { history, isolateHistory, undo, redo } = require('@codemirror/commands') as typeof import('@codemirror/commands');

test('native visual selections preserve the exact occurrence, and a caret selects the paragraph', () => {
  const markdown = 'A repeat, then a **repeat**, and a final repeat.\n\nAnother paragraph.';
  const model = parseDocument(markdown), from = markdown.lastIndexOf('repeat');
  const anchor = anchorFromSelection(model, from, from + 6);
  const result = addMarginNote(markdown, anchor, 'Only this occurrence.', 'mn-s-exact').markdown;
  assert.ok(result.includes('**repeat**, and a final ==repeat==[^mn-s-exact]'));
  assert.equal(anchorFromSelection(model, 4, 4).scope, 'paragraph');
  assert.throws(() => anchorFromSelection(model, 5, markdown.length), /one paragraph/);
});

const bundle = await build({
  stdin: { contents: `export { createNativeMargins } from './src/editor'; export { default as Marginalia } from './src/main'; export { editorInfoField, editorLivePreviewField } from 'obsidian';`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['@codemirror/*'],
  plugins: [{ name: 'obsidian-state-fixture', setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      import {StateField} from '@codemirror/state';
      export const editorInfoField=StateField.define({create:()=>({file:{path:'Clippings/Article.md'}}),update:(v)=>v});
      export const editorLivePreviewField=StateField.define({create:()=>true,update:(v)=>v});
      export const parseYaml=(text)=>({tags: /tags:\\s*\\[clippings\\]/.test(text)?['clippings']:[]});
      export class Component {}; export class MarkdownRenderChild extends Component {}; export class FileView {}; export class MarkdownView extends FileView {}; export class Notice {};
      export class Plugin {}; export class PluginSettingTab {}; export class Setting {}; export class TFile {}; export class WorkspaceLeaf {}; export class Scope {};
      export const MarkdownRenderer={}; export const setIcon=()=>{};
    `, loader: 'js', resolveDir: process.cwd() }));
  } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', bundle.outputFiles[0]!.text)(createRequire(import.meta.url), module, module.exports);
const { createNativeMargins, editorInfoField, editorLivePreviewField } = module.exports;
const fixture = '---\ntags: [clippings]\n---\n\nA ==passage==[^mn-s-first] and the rest.[^mn-p-whole]\n\n[^mn-s-first]: A thought.\n\n[^mn-p-whole]: The whole paragraph.\n';
function setup(doc = fixture, live = true) {
  const native = createNativeMargins({ app: {}, drafts: {}, storeDraft: async () => {} });
  const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('A ==') + 2 }, extensions: [editorInfoField, editorLivePreviewField.init(() => live), native.extension, history()] });
  return { native, state };
}
function replacements(state: CMState, native: any) {
  const output: { from: number; to: number }[] = [];
  state.field<any>(native.field).decorations.between(0, state.doc.length, (from: number, to: number, decoration: any) => {
    if (from < to && !decoration.spec.class) output.push({ from, to });
  });
  return output;
}

test('native decorations show scoped margins and hide only managed footnotes in Live Preview', () => {
  const { state, native } = setup();
  const value = state.field<any>(native.field);
  assert.equal(value.enabled, true);
  assert.equal(value.model.notes.length, 2);
  assert.equal(replacements(state, native).length, 4);
  const source = setup(fixture, false);
  assert.ok(source.state.field<any>(source.native.field).decorations.size > 0);
  assert.equal(replacements(source.state, source.native).length, 0);
  const ordinary = setup('An ordinary note.');
  assert.equal(ordinary.state.field<any>(ordinary.native.field).enabled, true);
  const optedOutPreviously = setup('---\nmarginalia: false\n---\n\nAn ordinary note.');
  assert.equal(optedOutPreviously.state.field<any>(optedOutPreviously.native.field).enabled, true);
});

test('Vim or keyboard navigation into a hidden definition reveals its editable source', () => {
  const { state, native } = setup();
  const definition = state.field<any>(native.field).model.notes[0].definition;
  const moved = state.update({ selection: EditorSelection.cursor(definition.from + 5) }).state;
  assert.ok(!replacements(moved, native).some(span => span.from <= definition.from && span.to >= definition.to));
  assert.equal(moved.doc.toString(), fixture);
});

test('native typing keeps annotations anchored; annotation saves are one undoable native transaction', () => {
  let { state, native } = setup();
  const insertion = fixture.indexOf('A ==');
  state = state.update({ changes: { from: insertion, insert: 'Thoughtful ' }, annotations: Transaction.userEvent.of('input.type') }).state;
  assert.equal(state.field<any>(native.field).model.notes[0].quote, 'passage');
  const before = state.doc.toString(), model = parseDocument(before), block = model.blocks[0]!;
  const from = before.indexOf('the rest');
  const after = addMarginNote(before, anchorFromSelection(model, from, from + 8), 'Another thought.', 'mn-s-added').markdown;
  state = state.update({ changes: textChanges(before, after), annotations: [Transaction.userEvent.of('input.marginalia'), isolateHistory.of('full')] }).state;
  assert.equal(state.field<any>(native.field).model.notes.length, 3);
  const historyTarget = () => ({ state, dispatch: (tr: CMTransaction) => { state = tr.state; } });
  assert.equal(undo(historyTarget()), true);
  assert.equal(state.doc.toString(), before);
  assert.equal(redo(historyTarget()), true);
  assert.equal(state.doc.toString(), after);
  assert.equal(state.field<any>(native.field).model.blocks[0].projection.text, block.projection.text);
});

test('adding a margin note leaves the native cursor in unchanged article text', () => {
  const before = 'First paragraph has an idea.\n\nSecond paragraph is being edited.';
  const caret = before.indexOf('being');
  const state = EditorState.create({ doc: before, selection: { anchor: caret } });
  const model = parseDocument(before);
  const after = addMarginNote(before, anchorFromSelection(model, 0, 5), 'A thought.', 'mn-s-cursor').markdown;
  const updated = state.update({ changes: textChanges(before, after) }).state;
  assert.equal(updated.doc.toString(), after);
  assert.equal(updated.doc.sliceString(updated.selection.main.head, updated.selection.main.head + 5), 'being');
});
