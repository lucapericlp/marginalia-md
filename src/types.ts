import type { App } from 'obsidian';
import type { Anchor } from './model';

export interface Draft { anchor: Anchor; body: string; noteId?: string; expectedBody?: string }
export interface MarginHost {
  app: App;
  drafts: Record<string, Draft>;
  storeDraft(path: string, draft: Draft | null): Promise<void>;
}
