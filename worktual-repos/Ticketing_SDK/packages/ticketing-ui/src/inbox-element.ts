import { endWidgetSession, failureDetail, widgetClient } from "./widget-client.js";
import type { InboxItem } from "@worktual/ticketing";
import { chatStrings, inboxStrings, localeDir, type InboxStrings } from "./i18n.js";

const THEME_VARS: Record<string, string> = {
  "theme-primary-color": "--wt-primary",
  "theme-border-radius": "--wt-radius",
  "theme-font": "--wt-font",
  "theme-surface": "--wt-surface",
  "theme-text": "--wt-text",
};

export type WorktualInboxActionDetail = {
  feature: "inbox.list" | "inbox.read" | "inbox.readAll";
  id?: string;
  ticketNumber?: string;
  code?: string;
};

export class WorktualInboxElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["endpoint", "token", "locale", "powered-by", ...Object.keys(THEME_VARS)];
  }

  labels: Partial<InboxStrings> | null = null;

  private ready = false;
  private busy = false;
  private items: InboxItem[] = [];
  private note = "";
  private loadGeneration = 0;

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.querySelector(".list")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const row = target.closest("[data-id]");
      if (!(row instanceof HTMLElement) || !row.dataset.id) return;
      void this.mark(row.dataset.id);
    });
    root.querySelector(".mark-all")?.addEventListener("click", () => {
      void this.markAll();
    });
    this.ready = true;
    this.applyTheme();
    this.applyLocale();
    void this.load();
  }

  attributeChangedCallback(name: string): void {
    if (!this.ready) return;
    this.applyTheme();
    this.applyLocale();
    if (name === "endpoint" || name === "token") void this.load();
    else this.paint();
  }

  private locale(): string {
    return (this.getAttribute("locale") || "en").trim() || "en";
  }

  private strings(): InboxStrings {
    return inboxStrings(this.locale(), this.labels);
  }

  private applyTheme(): void {
    for (const [attr, cssVar] of Object.entries(THEME_VARS)) {
      const value = this.getAttribute(attr);
      if (value && value.trim()) this.style.setProperty(cssVar, value.trim());
      else this.style.removeProperty(cssVar);
    }
  }

  private applyLocale(): void {
    this.setAttribute("dir", localeDir(this.locale()));
  }

  endSession(): Promise<void> {
    return endWidgetSession(this);
  }

  private client() {
    return widgetClient(this);
  }

  private paint(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const strings = this.strings();
    const title = root.querySelector(".title");
    if (title) title.textContent = strings.title;
    const list = root.querySelector(".list");
    if (list) {
      list.replaceChildren();
      for (const item of this.items) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = item.read ? "item read" : "item";
        row.dataset.id = item.id;
        const heading = document.createElement("strong");
        heading.textContent = item.title;
        const body = document.createElement("span");
        body.textContent = item.ticketNumber ? `${item.ticketNumber} ${item.message}` : item.message;
        row.append(heading, body);
        list.appendChild(row);
      }
    }
    const empty = root.querySelector(".empty");
    if (empty) {
      empty.textContent = this.note || strings.empty;
      if (empty instanceof HTMLElement) empty.hidden = this.items.length > 0 && !this.note;
    }
    const markAll = root.querySelector(".mark-all");
    if (markAll instanceof HTMLButtonElement) {
      markAll.textContent = strings.markAll;
      markAll.disabled = this.busy || this.items.length === 0;
    }
    const powered = root.querySelector(".powered");
    if (powered instanceof HTMLElement) {
      powered.textContent = chatStrings(this.locale()).poweredBy;
      powered.hidden = this.getAttribute("powered-by") === "false";
    }
  }

  private emit(detail: WorktualInboxActionDetail): void {
    this.dispatchEvent(new CustomEvent("worktual-action", { bubbles: true, composed: true, detail }));
  }

  private async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    const strings = this.strings();
    if (!this.getAttribute("endpoint") || !this.getAttribute("token")) {
      this.items = [];
      this.note = strings.missingAuth;
      this.paint();
      return;
    }
    this.busy = true;
    this.note = "";
    this.paint();
    try {
      const listed = await this.client().inbox.list(this.getAttribute("token") || "");
      if (generation !== this.loadGeneration) return;
      this.items = listed.items;
      this.emit({ feature: "inbox.list" });
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      const failure = failureDetail(error, strings.missingAuth);
      this.note = failure.message;
      this.emit({ feature: "inbox.list", code: failure.code });
    } finally {
      if (generation === this.loadGeneration) {
        this.busy = false;
        this.paint();
      }
    }
  }

  private async mark(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.paint();
    try {
      await this.client().inbox.markRead(id, this.getAttribute("token") || "");
      const item = this.items.find((row) => row.id === id);
      if (item) item.read = true;
      this.emit({ feature: "inbox.read", id, ticketNumber: item?.ticketNumber });
    } catch (error) {
      const failure = failureDetail(error, this.strings().missingAuth);
      this.note = failure.message;
      this.emit({ feature: "inbox.read", id, code: failure.code });
    } finally {
      this.busy = false;
      this.paint();
    }
  }

  private async markAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.paint();
    try {
      await this.client().inbox.markAllRead(this.getAttribute("token") || "");
      for (const item of this.items) item.read = true;
      this.emit({ feature: "inbox.readAll" });
    } catch (error) {
      const failure = failureDetail(error, this.strings().missingAuth);
      this.note = failure.message;
      this.emit({ feature: "inbox.readAll", code: failure.code });
    } finally {
      this.busy = false;
      this.paint();
    }
  }
}

const TEMPLATE = `
<style>
  :host {
    display: block;
    color: var(--wt-text, #0f172a);
    font-family: var(--wt-font, system-ui, sans-serif);
    font-size: 14px;
  }
  .shell {
    background: var(--wt-surface, #ffffff);
    border: 1px solid color-mix(in srgb, var(--wt-primary, #0f172a) 16%, #e2e8f0);
    border-radius: var(--wt-radius, 8px);
    padding: 12px;
  }
  .title { margin: 0 0 8px; font-size: 15px; }
  .list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; }
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    text-align: start;
    border: 1px solid #e2e8f0;
    background: #fff;
    color: inherit;
    border-radius: var(--wt-radius, 8px);
    padding: 8px;
    font: inherit;
    cursor: pointer;
  }
  .item.read { opacity: 0.65; }
  .empty { margin: 8px 0 0; color: #64748b; }
  .mark-all {
    margin-top: 10px;
    border: 1px solid #cbd5e1;
    background: #fff;
    color: inherit;
    border-radius: var(--wt-radius, 8px);
    padding: 8px 12px;
    font: inherit;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .powered { margin: 8px 0 0; color: #94a3b8; font-size: 11px; }
</style>
<div class="shell">
  <h2 class="title"></h2>
  <div class="list"></div>
  <p class="empty"></p>
  <button class="mark-all" type="button"></button>
  <p class="powered"></p>
</div>
`;
