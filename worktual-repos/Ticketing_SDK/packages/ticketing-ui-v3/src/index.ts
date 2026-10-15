import { WorktualNoteRecommendElement } from "./note-recommend-element.js";

export { WorktualNoteRecommendElement };
export type { NoteRecommendDetail } from "./note-recommend-element.js";

function define(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

export function defineWorktualNoteRecommend(): void {
  if (typeof customElements === "undefined") return;
  define("worktual-note-recommend", WorktualNoteRecommendElement);
}

defineWorktualNoteRecommend();
