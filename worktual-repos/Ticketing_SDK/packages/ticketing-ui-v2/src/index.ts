import { WorktualDeskAssistElement } from "./desk-assist-element.js";

export { WorktualDeskAssistElement };
export type { DeskAssistDetail } from "./desk-assist-element.js";

function define(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

export function defineWorktualDeskAssist(): void {
  if (typeof customElements === "undefined") return;
  define("worktual-desk-assist", WorktualDeskAssistElement);
}

defineWorktualDeskAssist();
