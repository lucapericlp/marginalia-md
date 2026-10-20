import { Component, MarkdownRenderChild, MarkdownRenderer, MarkdownView, Notice, TFile, setIcon, type MarkdownPostProcessorContext } from 'obsidian';
import { addMarginNote, editMarginNote, makeAnchor, packMarginNotes, parseDocument, removeMarginNote, type Anchor, type MarginNote, type TextBlock } from './model';
import { placeCompactNotes, projectDom, rangeForSource, selectedOffsets } from './dom';
import { managedFootnoteElements, readingBlocks } from './reading-dom';
import type { Draft, MarginHost } from './types';

interface Item { note: MarginNote; element: HTMLElement; host: HTMLElement; mark?: HTMLElement }

/** Enhance Obsidian's existing Reading view; its Markdown renderer and article DOM stay in charge. */
export function createReadingMargins(host: MarginHost, owner: Component) {
  const sessions = new Map<HTMLElement, ReadingMargins>();
  function get(root: HTMLElement, path: string): ReadingMargins {
    let session = sessions.get(root);
    if (session && session.path !== path) { owner.removeChild(session); sessions.delete(root); session = undefined; }
    if (!session) { session = owner.addChild(new ReadingMargins(root, path, host)); sessions.set(root, session); }
    return session;
  }
  function forView(view: MarkdownView): ReadingMargins | undefined {
    const root = view.previewMode.containerEl.matches('.markdown-preview-view') ? view.previewMode.containerEl : view.previewMode.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
    return root && view.file ? view.getMode() === 'preview' ? get(root, view.file.path) : sessions.get(root) : undefined;
  }
  return {
    process(element: HTMLElement, context: MarkdownPostProcessorContext): void {
      if (element.closest('.mg-note, .mg-composer, .internal-embed')) return;
      context.addChild(new class extends MarkdownRenderChild {
        private session?: ReadingMargins;
        onload(): void {
          // Post processors can run while a section is still detached from its preview.
          const frame = window.requestAnimationFrame(() => {
            const root = element.closest<HTMLElement>('.markdown-preview-view');
            if (!root) return;
            this.session = get(root, context.sourcePath);
            this.session.sections.set(element, context); this.session.refreshSoon();
          });
          this.register(() => window.cancelAnimationFrame(frame));
        }
        onunload(): void { this.session?.sections.delete(element); this.session?.refreshSoon(); }
      }(element));
    },
    sync(view: MarkdownView): void {
      for (const [root, session] of sessions) if (!root.isConnected) { owner.removeChild(session); sessions.delete(root); }
      const session = forView(view);
      if (view.getMode() === 'preview') session?.resume(); else session?.suspend();
    },
    annotate(view: MarkdownView): void { forView(view)?.annotateSelection(); },
    save(view: MarkdownView): boolean { const session = forView(view); if (!session?.hasDraft) return false; void session.commit(); return true; },
    cancel(view: MarkdownView): boolean { const session = forView(view); if (!session?.hasDraft) return false; session.close(true); return true; },
    dispose(): void { for (const session of sessions.values()) owner.removeChild(session); sessions.clear(); },
  };
}

class ReadingMargins extends Component {
  readonly sections = new Map<HTMLElement, MarkdownPostProcessorContext>();
  private model = parseDocument('');
  private blocks = new Map<HTMLElement, TextBlock>();
  private items: Item[] = [];
  private rail: HTMLElement | null = null;
  private rendered: Component | null = null;
  private composerOwner: Component | null = null;
  private composer: HTMLElement | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private draft: Draft | null = null;
  private selected: Anchor | null = null;
  private hover: TextBlock | null = null;
  private selectionButton!: HTMLButtonElement;
  private pen!: HTMLButtonElement;
  private resize!: ResizeObserver;
  private mutations!: MutationObserver;
  private observedSizer: HTMLElement | null = null;
  private frame = 0;
  private layoutFrame = 0;
  private saveTimer: number | null = null;
  private disposed = false;
  private busy = false;
  private again = false;
  private saving = false;
  private active = true;
  get hasDraft(): boolean { return !!this.draft; }
  constructor(readonly root: HTMLElement, readonly path: string, private host: MarginHost) { super(); }

  onload(): void {
    this.root.classList.add('mg-reading');
    this.selectionButton = this.button(this.root, 'Write in the margin about selected text', 'pencil-line', () => { if (this.selected) this.open(this.selected); }, 'Write in margin');
    this.selectionButton.classList.add('mg-reading-selection'); this.selectionButton.hidden = true;
    this.pen = this.button(this.root, 'Write a note about this paragraph', 'pencil-line', () => { if (this.hover) this.open(makeAnchor(this.model, this.hover)); });
    this.pen.classList.add('mg-reading-pen'); this.pen.hidden = true;
    this.registerDomEvent(this.root, 'mouseup', () => this.captureSelection());
    this.registerDomEvent(this.root, 'pointerover', event => {
      const element = (event.target as HTMLElement).closest<HTMLElement>('p, li');
      if (!element || !this.blocks.has(element) || this.draft) return;
      this.hover = this.blocks.get(element)!;
      const rect = element.getBoundingClientRect(), bounds = this.root.getBoundingClientRect();
      this.pen.style.left = `${rect.left - bounds.left + this.root.scrollLeft - 33}px`;
      this.pen.style.top = `${rect.top - bounds.top + this.root.scrollTop}px`; this.pen.hidden = false;
    });
    this.registerDomEvent(this.root, 'mouseleave', () => { this.pen.hidden = true; });
    this.registerDomEvent(this.root, 'scroll', () => { this.pen.hidden = this.selectionButton.hidden = true; }, { passive: true });
    this.registerEvent(this.host.app.vault.on('modify', file => { if (file.path === this.path) this.refreshSoon(); }));
    this.resize = new ResizeObserver(() => this.layoutSoon()); this.resize.observe(this.root);
    this.mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target.instanceOf(Element) && record.target.closest('.mg-note, .mg-composer')) && [...record.addedNodes, ...record.removedNodes].some(node => !(node.instanceOf(Element) && node.matches('.mg-note, .mg-composer'))))) this.refreshSoon();
    });
    this.refreshSoon();
  }
  private button(parent: HTMLElement, label: string, icon: string, action: () => void, text = ''): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'mg-control', attr: { type: 'button', title: label, 'aria-label': label } });
    setIcon(button.createSpan({ cls: 'mg-icon' }), icon);
    if (text) button.createSpan({ text });
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); });
    return button;
  }
  refreshSoon(): void {
    if (this.disposed || this.frame) return;
    this.frame = window.requestAnimationFrame(() => { this.frame = 0; void this.refresh(); });
  }
  private async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    try {
      const file = this.host.app.vault.getAbstractFileByPath(this.path);
      if (!(file instanceof TFile)) return;
      const markdown = await this.host.app.vault.cachedRead(file);
      if (this.disposed) return;
      const model = markdown === this.model.markdown ? this.model : parseDocument(markdown);
      const sizer = this.root.querySelector<HTMLElement>('.markdown-preview-sizer') ?? this.root;
      if (sizer !== this.observedSizer) { this.mutations.disconnect(); this.mutations.observe(sizer, { childList: true, subtree: true }); this.observedSizer = sizer; }
      const blocks = new Map<HTMLElement, TextBlock>();
      for (const [element, context] of this.sections) {
        if (!this.root.contains(element)) continue;
        for (const [el, block] of readingBlocks(element, model, context.getSectionInfo(element))) blocks.set(el, block);
      }
      // Existing previews may predate plugin activation. Only unique prose is matched without section information.
      if (!this.sections.size) for (const [el, block] of readingBlocks(this.root, model)) blocks.set(el, block);
      const changed = model !== this.model || blocks.size !== this.blocks.size || [...blocks].some(([el, block]) => this.blocks.get(el)?.from !== block.from) || !this.rail?.isConnected;
      this.model = model;
      if (changed) {
        this.clearDecorations(); this.blocks = blocks;
        // The preview virtualizer owns the sizer's children. Keep the margin beside that tree.
        this.rail = this.root.createDiv({ cls: 'mg-reading-rail', attr: { 'aria-label': 'Margin notes' } });
        this.rendered = this.addChild(new Component());
        for (const note of model.notes) {
          const element = [...blocks].find(([_el, block]) => block.from === note.block.from)?.[0];
          if (!element) continue;
          await this.renderNote(note, element);
          if (this.disposed) return;
        }
        for (const element of managedFootnoteElements(this.root, model, blocks)) element.classList.add('mg-managed-footnote');
        for (const section of this.root.querySelectorAll<HTMLElement>('.footnotes')) {
          const definitions = Array.from(section.querySelectorAll('ol > li'));
          if (definitions.length && definitions.every(item => item.classList.contains('mg-managed-footnote'))) section.classList.add('mg-footnotes-empty');
        }
      }
      if (this.active && !this.draft && this.host.drafts[this.path]) this.open(this.host.drafts[this.path]!.anchor, this.host.drafts[this.path]);
      this.layoutSoon();
    } catch (error) { console.error('Marginalia MD could not render the margin notes', error); }
    finally { this.busy = false; if (this.again) { this.again = false; this.refreshSoon(); } }
  }
  private async renderNote(note: MarginNote, target: HTMLElement): Promise<void> {
    const element = this.rail!.createEl('aside', { cls: 'mg-note', attr: { tabindex: '0', 'aria-label': `${note.scope === 'paragraph' ? 'Paragraph' : 'Passage'} note ${note.order}` } });
    const meta = element.createDiv({ cls: 'mg-note-meta' });
    meta.createSpan({ cls: 'mg-note-number', text: String(note.order).padStart(2, '0') });
    meta.createSpan({ cls: 'mg-scope-symbol', text: note.scope === 'paragraph' ? '¶' : '↳' });
    this.button(meta, `Edit margin note ${note.order}`, 'pencil-line', () => this.open({ snapshot: this.model.markdown, scope: note.scope, from: note.range?.from ?? note.block.from, to: note.range?.to ?? note.block.to, blockFrom: note.block.from, blockTo: note.block.to, quote: note.quote })).classList.add('mg-edit-note');
    const body = element.createDiv({ cls: 'mg-note-body markdown-rendered' });
    await MarkdownRenderer.render(this.host.app, note.body, body, this.path, this.rendered!).catch(() => body.setText(note.body));
    let mark: HTMLElement | undefined;
    if (note.scope === 'paragraph') target.classList.add('mg-reading-paragraph');
    else if (note.range) {
      const range = rangeForSource(target, note.block.projection, note.range);
      mark = Array.from(target.querySelectorAll('mark')).find(mark => range?.intersectsNode(mark) && projectDom(mark).text === note.quote);
      if (mark) {
        mark.classList.add('mg-reading-passage');
        this.rendered!.registerDomEvent(mark, 'click', () => { if (!this.root.ownerDocument.getSelection()?.toString().trim()) element.focus(); });
      }
    }
    const engage = (value: boolean) => { element.classList.toggle('mg-engaged', value); mark?.classList.toggle('mg-engaged', value); target.classList.toggle('mg-engaged-paragraph', value && note.scope === 'paragraph'); };
    this.rendered!.registerDomEvent(element, 'mouseenter', () => engage(true));
    this.rendered!.registerDomEvent(element, 'mouseleave', () => engage(false));
    this.rendered!.registerDomEvent(element, 'focusin', () => engage(true));
    this.rendered!.registerDomEvent(element, 'focusout', () => engage(false));
    if (mark) { this.rendered!.registerDomEvent(mark, 'mouseenter', () => engage(true)); this.rendered!.registerDomEvent(mark, 'mouseleave', () => engage(false)); }
    this.resize.observe(element);
    this.items.push({ note, element, host: target, mark });
  }
  private captureSelection(): void {
    this.selectionButton.hidden = true; this.selected = null;
    if (this.draft) return;
    const selection = this.root.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const element = (range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement)?.closest<HTMLElement>('p, li');
    if (!element || !element.contains(range.endContainer)) return;
    const block = this.blocks.get(element);
    if (!block) return;
    const offsets = selectedOffsets(range, projectDom(element));
    if (!offsets) return;
    try { this.selected = makeAnchor(this.model, block, offsets.start, offsets.end); } catch { return; }
    const rect = range.getBoundingClientRect(), root = this.root.getBoundingClientRect();
    this.selectionButton.style.left = `${Math.max(15, Math.min(this.root.clientWidth - 155, rect.left - root.left + this.root.scrollLeft))}px`;
    this.selectionButton.style.top = `${rect.bottom - root.top + this.root.scrollTop + 7}px`; this.selectionButton.hidden = false;
  }
  annotateSelection(): void {
    this.captureSelection();
    if (this.selected) this.open(this.selected);
    else if (this.hover) this.open(makeAnchor(this.model, this.hover));
    else new Notice('Select a passage, or use the pencil beside a paragraph to write in its margin.');
  }
  private open(anchor: Anchor, stored?: Draft): void {
    if (this.draft) { this.textarea?.focus(); return; }
    const note = this.model.notes.find(note => note.scope === anchor.scope && (anchor.scope === 'paragraph' ? note.block.from === anchor.blockFrom : note.range && note.range.from <= anchor.from && note.range.to >= anchor.to));
    this.draft = stored ?? { anchor, body: note?.body ?? '', noteId: note?.id, expectedBody: note?.body };
    void this.host.storeDraft(this.path, this.draft);
    this.composerOwner = this.addChild(new Component());
    this.composer = (this.rail ?? this.root).createDiv({ cls: 'mg-composer', attr: { role: 'group', 'aria-label': 'Write a margin note' } });
    const heading = this.composer.createDiv({ cls: 'mg-composer-heading' });
    heading.createSpan({ text: `${this.draft.noteId ? 'EDIT' : 'ON THIS'} ${anchor.scope === 'paragraph' ? 'PARAGRAPH' : 'PASSAGE'}` });
    this.button(heading, 'Cancel margin note', 'x', () => this.close(true));
    this.composer.createDiv({ cls: 'mg-composer-quote', text: anchor.quote.length > 105 ? `${anchor.quote.slice(0, 102)}…` : anchor.quote });
    this.textarea = this.composer.createEl('textarea', { attr: { rows: '4', 'aria-label': 'Margin note', placeholder: 'Your thought…' } });
    this.textarea.value = this.draft.body;
    this.composerOwner.registerDomEvent(this.textarea, 'input', () => {
      if (!this.draft || !this.textarea) return;
      this.draft.body = this.textarea.value;
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => { if (this.draft) void this.host.storeDraft(this.path, this.draft); this.saveTimer = null; }, 300);
      this.layoutSoon();
    });
    this.composerOwner.registerDomEvent(this.textarea, 'keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void this.commit(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
    });
    const footer = this.composer.createDiv({ cls: 'mg-composer-footer' });
    if (this.draft.noteId) this.button(footer, 'Delete this margin note', 'trash-2', () => void this.commit(true));
    footer.createSpan({ cls: 'mg-save-hint', text: '⌘ / Ctrl ↵' });
    this.button(footer, 'Save margin note', 'arrow-up-right', () => void this.commit(), 'Save');
    this.selectionButton.hidden = this.pen.hidden = true; this.resize.observe(this.composer);
    this.layoutSoon();
    window.requestAnimationFrame(() => { if (!this.disposed && this.textarea) { this.textarea.focus({ preventScroll: true }); this.composer?.scrollIntoView({ block: 'nearest' }); } });
  }
  async commit(remove = false): Promise<void> {
    if (!this.draft || this.saving) return;
    const file = this.host.app.vault.getAbstractFileByPath(this.path), draft = this.draft;
    if (!(file instanceof TFile)) return;
    this.saving = true;
    try {
      await this.host.app.vault.process(file, latest => remove && draft.noteId ? removeMarginNote(latest, draft.noteId, draft.expectedBody ?? '') : draft.noteId ? editMarginNote(latest, draft.noteId, draft.body, draft.expectedBody ?? '') : addMarginNote(latest, draft.anchor, draft.body).markdown);
      this.close(true); this.refreshSoon();
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error), 7000); }
    finally { this.saving = false; }
  }
  close(discard: boolean): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer); this.saveTimer = null;
    if (!discard && this.draft) void this.host.storeDraft(this.path, this.draft);
    if (discard) void this.host.storeDraft(this.path, null);
    this.draft = null; this.textarea = null;
    if (this.composer) this.resize.unobserve(this.composer);
    this.composer?.remove(); this.composer = null;
    if (this.composerOwner) this.removeChild(this.composerOwner); this.composerOwner = null;
    this.layoutSoon();
  }
  suspend(): void { this.active = false; if (this.draft) this.close(false); }
  resume(): void { this.active = true; this.refreshSoon(); }
  private layoutSoon(): void {
    if (this.disposed || this.layoutFrame) return;
    this.layoutFrame = window.requestAnimationFrame(() => { this.layoutFrame = 0; this.layout(); });
  }
  private layout(): void {
    if (this.disposed || !this.rail) return;
    const compact = this.root.clientWidth < 820;
    this.root.classList.toggle('mg-reading-compact', compact);
    this.root.classList.toggle('mg-has-margins', this.model.notes.length > 0 || !!this.draft);
    const draftBlock = this.draft ? this.model.blocks.find(block => block.raw === this.draft!.anchor.snapshot.slice(this.draft!.anchor.blockFrom, this.draft!.anchor.blockTo)) : undefined;
    const draftTarget = this.draft?.noteId ? this.items.find(item => item.note.id === this.draft!.noteId)?.host : [...this.blocks].find(([_el, block]) => block.from === draftBlock?.from)?.[0];
    for (const item of this.items) item.element.hidden = item.note.id === this.draft?.noteId;
    if (compact) {
      const placements = this.items.map(item => ({ host: item.host, element: item.element }));
      if (this.composer && draftTarget) placements.push({ host: draftTarget, element: this.composer });
      placeCompactNotes(placements);
      for (const item of this.items) item.element.style.removeProperty('top');
      this.composer?.style.removeProperty('top');
    } else {
      const root = this.root.getBoundingClientRect(), sizer = (this.root.querySelector<HTMLElement>('.markdown-preview-sizer') ?? this.root).getBoundingClientRect();
      this.rail.style.left = `${sizer.right - root.left + this.root.scrollLeft - 232}px`;
      for (const item of this.items) if (item.element.parentElement !== this.rail) this.rail.append(item.element);
      if (this.composer && this.composer.parentElement !== this.rail) this.rail.append(this.composer);
      const top = this.rail.getBoundingClientRect().top;
      const entries = this.items.filter(item => !item.element.hidden).map(item => ({ id: item.note.id, preferred: (item.mark ?? item.host).getBoundingClientRect().top - top, height: item.element.offsetHeight }));
      if (this.composer) entries.push({ id: 'draft', preferred: draftTarget ? draftTarget.getBoundingClientRect().top - top : 0, height: this.composer.offsetHeight });
      for (const packed of packMarginNotes(entries, 22)) {
        const element = packed.id === 'draft' ? this.composer : this.items.find(item => item.note.id === packed.id)?.element;
        if (element) element.style.top = `${packed.top}px`;
      }
    }
  }
  private clearDecorations(): void {
    for (const item of this.items) { this.resize.unobserve(item.element); item.element.remove(); }
    this.items = [];
    if (this.rendered) this.removeChild(this.rendered); this.rendered = null;
    this.root.querySelectorAll('.mg-reading-paragraph, .mg-engaged-paragraph').forEach(el => el.classList.remove('mg-reading-paragraph', 'mg-engaged-paragraph'));
    this.root.querySelectorAll('.mg-reading-passage').forEach(el => el.classList.remove('mg-reading-passage', 'mg-engaged'));
    this.root.querySelectorAll('.mg-managed-footnote, .mg-footnotes-empty').forEach(el => el.classList.remove('mg-managed-footnote', 'mg-footnotes-empty'));
    // Move a live composer out before replacing the rail during a native rerender.
    if (this.composer) this.root.append(this.composer);
    this.rail?.remove(); this.rail = null;
  }
  onunload(): void {
    if (this.draft) this.close(false);
    this.disposed = true;
    if (this.frame) window.cancelAnimationFrame(this.frame);
    if (this.layoutFrame) window.cancelAnimationFrame(this.layoutFrame);
    this.clearDecorations(); this.resize.disconnect(); this.mutations.disconnect(); this.selectionButton.remove(); this.pen.remove();
    this.root.classList.remove('mg-reading', 'mg-reading-compact', 'mg-has-margins');
  }
}
