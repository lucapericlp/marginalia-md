import { FileView, MarkdownView, Notice, Plugin, PluginSettingTab, TFile, WorkspaceLeaf, type SettingDefinitionItem } from 'obsidian';
import { parseDocument } from './model';
import { createNativeMargins } from './editor';
import { anchorFromSelection } from './editor-model';
import { createReadingMargins } from './reading';
import type { Draft } from './types';

const LEGACY_VIEW = 'marginalia-reader';
interface SavedData { drafts: Record<string, Draft> }

export default class Marginalia extends Plugin {
  drafts: Record<string, Draft> = {};
  private savingData: Promise<void> = Promise.resolve();
  private native!: ReturnType<typeof createNativeMargins>;
  private reading!: ReturnType<typeof createReadingMargins>;
  private configured = new WeakSet<MarkdownView>();
  private modes = new WeakMap<MarkdownView, string>();
  private unloading = false;

  async onload(): Promise<void> {
    const data = await this.loadData() as Partial<SavedData> | null;
    this.drafts = data?.drafts ?? {};
    this.native = createNativeMargins(this);
    this.reading = createReadingMargins(this, this);
    this.registerEditorExtension(this.native.extension);
    this.registerMarkdownPostProcessor((element, context) => this.reading.process(element, context), 100);
    // Retain this registration solely to migrate tabs saved by versions 0.1–0.2.
    this.registerView(LEGACY_VIEW, leaf => new LegacyMarginView(leaf));
    this.addRibbonIcon('pencil-line', 'Write in the margin', () => void this.annotateActive());
    this.addCommand({ id: 'write-note', name: 'Write in the margin', checkCallback: checking => {
      const view = this.app.workspace.getMostRecentLeaf()?.view;
      if (!(view instanceof MarkdownView) || !view.file) return false;
      if (!checking) void this.annotate(view);
      return true;
    } });
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, _editor, info) => {
      if (info instanceof MarkdownView) menu.addItem(item => item.setTitle('Write in the margin').setIcon('pencil-line').onClick(() => void this.annotate(info)));
    }));
    const scan = () => {
      if (this.unloading) return;
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || !view.file) continue;
        if (!this.configured.has(view)) {
          this.configured.add(view);
          if (view.scope) {
            const save = view.scope.register(['Mod'], 'Enter', () => {
              if (view.getMode() === 'preview' ? this.reading.save(view) : this.native.save(view)) return false;
            });
            const cancel = view.scope.register([], 'Escape', () => {
              if (view.getMode() === 'preview' ? this.reading.cancel(view) : this.native.cancel(view)) return false;
            });
            this.register(() => { view.scope?.unregister(save); view.scope?.unregister(cancel); });
          }
        }
        const mode = view.getMode();
        if (this.modes.get(view) !== mode) {
          this.modes.set(view, mode);
          if (mode === 'preview') this.native.suspend(view);
          else { this.reading.sync(view); this.native.resume(view); }
        }
        this.reading.sync(view);
      }
      for (const leaf of this.app.workspace.getLeavesOfType(LEGACY_VIEW)) {
        const file = (leaf.view as FileView).file;
        if (file) void leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'preview' } });
      }
    };
    this.registerEvent(this.app.workspace.on('active-leaf-change', scan));
    this.registerEvent(this.app.workspace.on('file-open', scan));
    this.registerEvent(this.app.workspace.on('layout-change', scan));
    this.app.workspace.onLayoutReady(scan);
    this.addSettingTab(new MarginaliaSettings(this));
  }
  private async annotateActive(): Promise<void> {
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    if (view instanceof MarkdownView) await this.annotate(view);
  }
  private async annotate(view: MarkdownView): Promise<void> {
    if (!view.file) return;
    if (view.getMode() === 'preview') { this.reading.annotate(view); return; }
    const model = parseDocument(view.editor.getValue());
    const from = view.editor.posToOffset(view.editor.getCursor('from'));
    const to = view.editor.posToOffset(view.editor.getCursor('to'));
    try { this.native.open(view, anchorFromSelection(model, from, to)); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
  }
  async storeDraft(path: string, draft: Draft | null): Promise<void> {
    if (draft) this.drafts[path] = structuredClone(draft); else delete this.drafts[path];
    this.savingData = this.savingData.catch(() => {}).then(() => this.saveData({ drafts: this.drafts }));
    await this.savingData;
  }
  onunload(): void { this.unloading = true; this.reading?.dispose(); }
}

class LegacyMarginView extends FileView {
  constructor(leaf: WorkspaceLeaf) { super(leaf); }
  getViewType(): string { return LEGACY_VIEW; }
  getDisplayText(): string { return this.file?.basename ?? 'Note'; }
  async onLoadFile(_file: TFile): Promise<void> { /* The workspace scan migrates this tab to native Reading view. */ }
}

class MarginaliaSettings extends PluginSettingTab {
  constructor(plugin: Marginalia) { super(plugin.app, plugin); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { name: 'Read and write', desc: 'Margin notes are available in every note, in both editing and reading view. The article keeps your theme’s typography and formatting. No tags or special view are needed.' },
      { name: 'Write a margin note', desc: 'Select a passage or use the pencil beside a paragraph to write in its margin. You can also run Marginalia: Write in the margin; a Vim visual selection works in the editor. Save with ⌘/Ctrl + Enter and cancel with Escape.' },
      { name: 'Storage', desc: 'Annotations are ordinary Markdown footnotes stored in the note. Unsaved drafts are kept locally when you close a note or switch views.' },
    ];
  }
}
