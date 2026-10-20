import { EditorState, RangeSet, StateEffect, StateField, Transaction, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { Component, MarkdownRenderer, MarkdownView, Notice, editorInfoField, editorLivePreviewField, setIcon } from 'obsidian';
import { addMarginNote, editMarginNote, makeAnchor, packMarginNotes, parseDocument, removeMarginNote, type Anchor, type DocumentModel, type MarginNote } from './model';
import { anchorFromSelection, textChanges } from './editor-model';
import type { Draft, MarginHost } from './types';
const draftEffect = StateEffect.define<Draft | null>();
export interface NativeState {
  model: DocumentModel; enabled: boolean;
  path: string; draft: Draft | null; decorations: DecorationSet; atomic: RangeSet<Decoration>;
}

function noteAnchor(model: DocumentModel, note: MarginNote): Anchor {
  return { snapshot: model.markdown, blockFrom: note.block.from, blockTo: note.block.to, scope: note.scope, from: note.range?.from ?? note.block.from, to: note.range?.to ?? note.block.to, quote: note.quote };
}
function draftPosition(model: DocumentModel, draft: Draft): number {
  const original = draft.anchor.snapshot.slice(draft.anchor.blockFrom, draft.anchor.blockTo);
  const block = model.blocks.find(block => block.raw === original);
  return block?.to ?? Math.min(draft.anchor.blockTo, model.markdown.length);
}

/** Decorations stay inside the real Markdown editor; text input, Vim, search and undo remain Obsidian's. */
export function createNativeMargins(host: MarginHost) {
  let controller: ReturnType<typeof ViewPlugin.fromClass<NativeController>>;
  class NoteWidget extends WidgetType {
    constructor(readonly note: MarginNote | null, readonly draft: Draft | null, readonly path: string) { super(); }
    eq(other: NoteWidget): boolean {
      return this.path === other.path && this.draft === other.draft && this.note?.id === other.note?.id && this.note?.body === other.note?.body && this.note?.order === other.note?.order && this.note?.block.from === other.note?.block.from && this.note?.range?.from === other.note?.range?.from;
    }
    toDOM(view: EditorView): HTMLElement {
      const wrapper = view.dom.ownerDocument.adoptNode(createDiv({ cls: 'mg-native-note-widget' }));
      const owner = view.plugin(controller)!;
      if (this.draft) owner.buildComposer(wrapper, this.draft);
      else if (this.note) owner.buildNote(wrapper, this.note);
      return wrapper;
    }
    destroy(element: HTMLElement): void {
      const component = (element as HTMLElement & { mgComponent?: Component }).mgComponent;
      component?.unload();
    }
    ignoreEvent(): boolean { return true; }
    get estimatedHeight(): number { return 0; }
  }

  const field = StateField.define<NativeState>({
    create(state) { return compute(state); },
    update(previous, transaction) { return compute(transaction.state, previous, transaction); },
    provide: field => [EditorView.decorations.from(field, value => value.decorations), EditorView.atomicRanges.of(view => view.state.field(field).atomic)],
  });

  function compute(state: EditorState, previous?: NativeState, tr?: Transaction): NativeState {
    const path = state.field(editorInfoField, false)?.file?.path ?? '';
    const changedFile = path !== previous?.path;
    const model = !previous || tr?.docChanged || changedFile ? parseDocument(state.doc.toString()) : previous.model;
    let draft = changedFile ? host.drafts[path] ?? null : previous?.draft ?? null;
    for (const effect of tr?.effects ?? []) {
      if (effect.is(draftEffect)) draft = effect.value;
    }
    const enabled = !!path;
    const live = state.field(editorLivePreviewField, false) === true;
    const ranges: Range<Decoration>[] = [], atomic: Range<Decoration>[] = [];
    const selected = (from: number, to: number) => state.selection.ranges.some(range => range.from <= to && range.to >= from);
    if (enabled) {
      const markedLines = new Set<number>();
      for (const note of model.notes) {
        if (note.scope === 'paragraph') {
          for (let line = state.doc.lineAt(note.block.from); line.from <= note.block.to;) {
            if (!markedLines.has(line.from)) {
              markedLines.add(line.from);
              ranges.push(Decoration.line({ class: `mg-native-paragraph${line.from === state.doc.lineAt(note.block.from).from ? ' mg-native-paragraph-first' : ''}${line.to >= note.block.to ? ' mg-native-paragraph-last' : ''}` }).range(line.from));
            }
            if (line.number >= state.doc.lines) break;
            line = state.doc.line(line.number + 1);
          }
        } else if (note.range) ranges.push(Decoration.mark({ class: 'mg-native-passage', attributes: { 'data-mg-note': note.id } }).range(note.range.from, note.range.to));
        // Reveal a reference or definition whenever the native caret reaches it. Source mode has no replacements.
        if (live && !selected(note.reference.from, note.reference.to)) {
          const hidden = Decoration.replace({ inclusive: false }).range(note.reference.from, note.reference.to);
          ranges.push(hidden); atomic.push(hidden);
        }
        const start = state.doc.lineAt(note.definition.from).from, end = state.doc.lineAt(note.definition.to).to;
        if (live && !selected(start, end)) {
          const hidden = Decoration.replace({ block: true, inclusive: false }).range(start, end);
          ranges.push(hidden); atomic.push(hidden);
        }
        if (note.id !== draft?.noteId) ranges.push(Decoration.widget({ widget: new NoteWidget(note, null, path), block: true, side: 1 }).range(state.doc.lineAt(note.block.to).to));
      }
      if (draft) ranges.push(Decoration.widget({ widget: new NoteWidget(null, draft, path), block: true, side: 1 }).range(state.doc.lineAt(draftPosition(model, draft)).to));
    }
    return { path, model, enabled, draft, decorations: Decoration.set(ranges, true), atomic: RangeSet.of(atomic, true) };
  }

  class NativeController {
    private resize: ResizeObserver;
    private saveTimer: number | null = null;
    private disposed = false;
    private textarea: HTMLTextAreaElement | null = null;
    private selectionButton: HTMLButtonElement;
    private pen: HTMLButtonElement;
    private hover: number | null = null;
    private root: HTMLElement;
    constructor(readonly view: EditorView) {
      this.root = view.dom.closest<HTMLElement>('.markdown-source-view') ?? view.dom;
      this.selectionButton = this.button(view.scrollDOM, 'Write in the margin about selected text', 'pencil-line', () => {
        const data = view.state.field(field), selection = view.state.selection.main;
        try { this.open(anchorFromSelection(data.model, selection.from, selection.to)); }
        catch (error) { new Notice(String(error)); }
      }, 'Write in margin');
      this.selectionButton.classList.add('mg-native-selection'); this.selectionButton.hidden = true;
      this.pen = this.button(view.scrollDOM, 'Write a note about this paragraph', 'pencil-line', () => {
        const data = view.state.field(field), block = data.model.blocks.find(block => block.from === this.hover);
        if (block) this.open(makeAnchor(data.model, block));
      });
      this.pen.classList.add('mg-native-pen'); this.pen.hidden = true;
      this.resize = new ResizeObserver(() => this.measure());
      this.resize.observe(view.dom);
      this.measure();
    }
    update(update: ViewUpdate): void {
      const previous = update.startState.field(field), current = update.state.field(field);
      if (previous.path !== current.path) {
        this.clearDraftTimer();
        if (previous.draft) void host.storeDraft(previous.path, previous.draft);
      }
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || update.transactions.some(tr => tr.effects.length)) this.measure();
    }
    measure(): void {
      if (this.disposed) return;
      this.view.requestMeasure({
        key: this,
        read: view => {
          const state = view.state.field(field);
          const compact = view.scrollDOM.clientWidth < 820;
          const widgets = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.mg-native-note-widget'));
          const selection = view.state.selection.main, scroll = view.scrollDOM.getBoundingClientRect();
          let selected = false;
          try { if (!selection.empty) { anchorFromSelection(state.model, selection.from, selection.to); selected = true; } } catch { /* More than one paragraph, or syntax rather than prose. */ }
          const selectionCoords = selected && !state.draft ? view.coordsAtPos(selection.to) : null;
          const hoverCoords = this.hover !== null && !state.draft && selection.empty ? view.coordsAtPos(Math.min(this.hover, view.state.doc.length)) : null;
          const content = view.contentDOM.getBoundingClientRect();
          const items = widgets.map((widget, index) => {
            const child = widget.firstElementChild as HTMLElement;
            const note = state.model.notes.find(note => note.id === child?.dataset.note);
            const anchor = note?.range?.from ?? note?.block.from ?? (state.draft?.anchor.from ?? 0);
            const coords = view.coordsAtPos(Math.min(anchor, view.state.doc.length));
            const rect = widget.getBoundingClientRect();
            return { id: String(index), widget, child, origin: rect.top - content.top, preferred: (coords?.top ?? rect.top) - content.top, height: child?.offsetHeight ?? 0 };
          });
          return { enabled: state.enabled, hasMargins: state.model.notes.length > 0 || !!state.draft, compact, items, packed: packMarginNotes(items, 22), selectionCoords, hoverCoords, scroll, content };
        },
        write: result => {
          this.root.classList.toggle('mg-native', result.enabled);
          this.root.classList.toggle('mg-has-margins', result.hasMargins);
          this.root.classList.toggle('mg-native-compact', result.compact);
          this.selectionButton.hidden = !result.enabled || !result.selectionCoords;
          this.pen.hidden = !result.enabled || !result.hoverCoords;
          if (result.selectionCoords) {
            this.selectionButton.style.left = `${Math.max(20, result.selectionCoords.left - result.scroll.left + this.view.scrollDOM.scrollLeft - 35)}px`;
            this.selectionButton.style.top = `${result.selectionCoords.bottom - result.scroll.top + this.view.scrollDOM.scrollTop + 7}px`;
          }
          if (result.hoverCoords) {
            this.pen.style.left = `${result.content.left - result.scroll.left + this.view.scrollDOM.scrollLeft - 35}px`;
            this.pen.style.top = `${result.hoverCoords.top - result.scroll.top + this.view.scrollDOM.scrollTop}px`;
          }
          if (result.compact) {
            for (const item of result.items) if (item.child) item.child.style.removeProperty('top');
          } else {
            for (const packed of result.packed) {
              const item = result.items[Number(packed.id)];
              if (item?.child) item.child.style.top = `${packed.top - item.origin}px`;
            }
          }
        },
      });
    }
    hoverAt(event: MouseEvent): void {
      const target = event.target as HTMLElement;
      if (!target.closest('.cm-line') || target.closest('.mg-native-note-widget')) return;
      const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
      const block = position === null ? undefined : this.view.state.field(field).model.blocks.find(block => position >= block.from && position <= block.to);
      if (this.hover !== (block?.from ?? null)) { this.hover = block?.from ?? null; this.measure(); }
    }
    open(anchor: Anchor, existing?: MarginNote): void {
      const data = this.view.state.field(field);
      if (data.draft) { this.textarea?.focus(); return; }
      existing ??= data.model.notes.find(note => note.scope === anchor.scope && (anchor.scope === 'paragraph' ? note.block.from === anchor.blockFrom : note.range && note.range.from <= anchor.from && note.range.to >= anchor.to));
      const draft: Draft = { anchor, body: existing?.body ?? '', noteId: existing?.id, expectedBody: existing?.body };
      this.view.dispatch({ effects: draftEffect.of(draft) });
      void host.storeDraft(data.path, draft);
      this.view.dispatch({ effects: EditorView.scrollIntoView(Math.min(anchor.to, this.view.state.doc.length), { y: 'center' }) });
    }
    private attach(element: HTMLElement): Component {
      const component = new Component(); component.load();
      (element as HTMLElement & { mgComponent?: Component }).mgComponent = component;
      return component;
    }
    private button(parent: HTMLElement, label: string, icon: string, run: () => void, text = ''): HTMLButtonElement {
      const button = parent.createEl('button', { cls: 'mg-control', attr: { type: 'button', 'aria-label': label, title: label } });
      setIcon(button.createSpan({ cls: 'mg-icon' }), icon);
      if (text) button.createSpan({ text });
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); run(); });
      return button;
    }
    buildNote(wrapper: HTMLElement, note: MarginNote): void {
      const component = this.attach(wrapper);
      const section = wrapper.createEl('aside', { cls: 'mg-note', attr: { 'data-note': note.id, 'aria-label': `${note.scope === 'paragraph' ? 'Paragraph' : 'Passage'} note ${note.order}` } });
      const meta = section.createDiv({ cls: 'mg-note-meta' });
      meta.createSpan({ cls: 'mg-note-number', text: String(note.order).padStart(2, '0') });
      meta.createSpan({ cls: 'mg-scope-symbol', text: note.scope === 'paragraph' ? '¶' : '↳' });
      this.button(meta, `Edit margin note ${note.order}`, 'pencil-line', () => {
        const current = this.view.state.field(field).model;
        const latest = current.notes.find(item => item.id === note.id);
        if (latest) this.open(noteAnchor(current, latest), latest);
      }).classList.add('mg-edit-note');
      const body = section.createDiv({ cls: 'mg-note-body markdown-rendered' });
      section.addEventListener('mouseenter', () => this.view.contentDOM.querySelectorAll<HTMLElement>('[data-mg-note]').forEach(mark => mark.classList.toggle('mg-engaged', mark.dataset.mgNote === note.id)));
      section.addEventListener('mouseleave', () => this.view.contentDOM.querySelectorAll('.mg-engaged').forEach(mark => mark.classList.remove('mg-engaged')));
      void MarkdownRenderer.render(host.app, note.body, body, this.view.state.field(field).path, component).then(() => this.measure()).catch(() => { body.setText(note.body); this.measure(); });
    }
    buildComposer(wrapper: HTMLElement, draft: Draft): void {
      this.attach(wrapper);
      const box = wrapper.createDiv({ cls: 'mg-composer', attr: { 'aria-label': 'Write a margin note', role: 'group' } });
      const heading = box.createDiv({ cls: 'mg-composer-heading' });
      heading.createSpan({ text: `${draft.noteId ? 'EDIT' : 'ON THIS'} ${draft.anchor.scope === 'paragraph' ? 'PARAGRAPH' : 'PASSAGE'}` });
      this.button(heading, 'Cancel margin note', 'x', () => this.close(true));
      box.createDiv({ cls: 'mg-composer-quote', text: draft.anchor.quote.length > 105 ? `${draft.anchor.quote.slice(0, 102)}…` : draft.anchor.quote });
      const textarea = this.textarea = box.createEl('textarea', { attr: { 'aria-label': 'Margin note', rows: '4', placeholder: 'Your thought…' } });
      textarea.value = draft.body;
      textarea.addEventListener('input', () => {
        draft.body = textarea.value;
        const path = this.view.state.field(field).path;
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => { void host.storeDraft(path, draft); this.saveTimer = null; }, 300);
        this.measure();
      });
      textarea.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); this.commit(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
      });
      const footer = box.createDiv({ cls: 'mg-composer-footer' });
      if (draft.noteId) this.button(footer, 'Delete this margin note', 'trash-2', () => this.commit(true));
      footer.createSpan({ cls: 'mg-save-hint', text: '⌘ / Ctrl ↵' });
      this.button(footer, 'Save margin note', 'arrow-up-right', () => this.commit(), 'Save');
      window.requestAnimationFrame(() => { if (!this.disposed && textarea.isConnected) textarea.focus({ preventScroll: true }); });
    }
    commit(remove = false): void {
      const data = this.view.state.field(field), draft = data.draft;
      if (!draft) return;
      try {
        const before = this.view.state.doc.toString();
        const after = remove && draft.noteId ? removeMarginNote(before, draft.noteId, draft.expectedBody ?? '') : draft.noteId ? editMarginNote(before, draft.noteId, draft.body, draft.expectedBody ?? '') : addMarginNote(before, draft.anchor, draft.body).markdown;
        this.view.dispatch({ changes: textChanges(before, after), effects: draftEffect.of(null), annotations: [Transaction.userEvent.of('input.marginalia'), isolateHistory.of('full')] });
        this.clearDraftTimer();
        void host.storeDraft(data.path, null); this.view.focus();
      } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 7000); }
    }
    close(discard = false): void {
      const data = this.view.state.field(field);
      this.clearDraftTimer();
      if (discard) void host.storeDraft(data.path, null);
      this.view.dispatch({ effects: draftEffect.of(null) }); this.textarea = null; this.view.focus();
    }
    suspend(): void {
      const data = this.view.state.field(field);
      this.clearDraftTimer();
      if (data.draft) {
        void host.storeDraft(data.path, data.draft);
        this.view.dispatch({ effects: draftEffect.of(null) });
      }
      this.textarea = null;
    }
    private clearDraftTimer(): void { if (this.saveTimer !== null) window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    destroy(): void {
      const data = this.view.state.field(field);
      if (data.draft) void host.storeDraft(data.path, data.draft);
      this.disposed = true; this.clearDraftTimer(); this.resize.disconnect();
      this.selectionButton.remove(); this.pen.remove();
      this.root.classList.remove('mg-native', 'mg-native-compact', 'mg-has-margins');
    }
  }
  controller = ViewPlugin.fromClass(NativeController, { eventHandlers: { mousemove(event) { this.hoverAt(event); return false; } } });
  const extension: Extension = [field, controller];
  function editorOf(view: MarkdownView): EditorView | undefined {
    // Obsidian documents this bridge for communicating with registered editor extensions.
    return (view.editor as typeof view.editor & { cm?: EditorView }).cm;
  }
  return {
    field, extension,
    open(view: MarkdownView, anchor: Anchor, note?: MarginNote) { editorOf(view)?.plugin(controller)?.open(anchor, note); },
    suspend(view: MarkdownView) {
      editorOf(view)?.plugin(controller)?.suspend();
    },
    resume(view: MarkdownView) {
      const editor = editorOf(view), data = editor?.state.field(field, false);
      if (editor && data && !data.draft && host.drafts[data.path]) editor.dispatch({ effects: draftEffect.of(host.drafts[data.path]!) });
    },
    cancel(view: MarkdownView): boolean {
      const editor = editorOf(view);
      if (!editor?.state.field(field, false)?.draft) return false;
      editor.plugin(controller)?.close(true); return true;
    },
    save(view: MarkdownView): boolean {
      const editor = editorOf(view);
      if (!editor?.state.field(field, false)?.draft) return false;
      editor.plugin(controller)?.commit(); return true;
    },
  };
}
