import { launcherStrings, localeDir, type LauncherStrings } from "./i18n.js";

const THEME_VARS: Record<string, string> = {
  "theme-primary-color": "--wt-primary",
  "theme-border-radius": "--wt-radius",
  "theme-font": "--wt-font",
  "theme-surface": "--wt-surface",
  "theme-text": "--wt-text",
};

const BUBBLE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v7A2.5 2.5 0 0 1 16.5 15H12l-3.6 3.2c-.7.6-1.8.1-1.8-.8V15H7.5A2.5 2.5 0 0 1 5 12.5v-7Z"/></svg>`;
const CLOSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.7 5.3a1 1 0 0 0-1.4 1.4L10.6 12l-5.3 5.3a1 1 0 1 0 1.4 1.4L12 13.4l5.3 5.3a1 1 0 0 0 1.4-1.4L13.4 12l5.3-5.3a1 1 0 0 0-1.4-1.4L12 10.6 6.7 5.3Z"/></svg>`;

export class WorktualChatLauncherElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["endpoint", "token", "locale", "open", ...Object.keys(THEME_VARS)];
  }

  labels: Partial<LauncherStrings> | null = null;

  private ready = false;
  private chat: HTMLElement | null = null;

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.querySelector(".launcher")?.addEventListener("click", () => {
      this.toggle();
    });
    root.querySelector(".close")?.addEventListener("click", () => {
      this.close();
    });
    this.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isOpen()) this.close();
    });
    this.ready = true;
    this.applyTheme();
    this.applyLocale();
    this.paint();
    if (this.hasAttribute("open")) this.open();
  }

  attributeChangedCallback(): void {
    if (!this.ready) return;
    this.applyTheme();
    this.applyLocale();
    this.syncChat();
    this.paint();
  }

  private locale(): string {
    return (this.getAttribute("locale") || "en").trim() || "en";
  }

  private strings(): LauncherStrings {
    return launcherStrings(this.locale(), this.labels);
  }

  private isOpen(): boolean {
    return this.shadowRoot?.querySelector(".panel")?.hasAttribute("hidden") === false;
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

  private paint(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const strings = this.strings();
    const open = this.isOpen();
    const launcher = root.querySelector(".launcher");
    const title = root.querySelector(".title");
    const close = root.querySelector(".close");
    const icon = root.querySelector(".launcher .icon");
    if (title) title.textContent = strings.title;
    if (launcher instanceof HTMLButtonElement) {
      launcher.setAttribute("aria-expanded", open ? "true" : "false");
      launcher.setAttribute("aria-label", open ? strings.close : strings.open);
    }
    if (close instanceof HTMLButtonElement) close.setAttribute("aria-label", strings.close);
    if (icon) icon.innerHTML = open ? CLOSE : BUBBLE;
    const panel = root.querySelector(".panel");
    if (panel instanceof HTMLElement) panel.setAttribute("aria-label", strings.title);
  }

  private toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  private open(): void {
    const panel = this.shadowRoot?.querySelector(".panel");
    if (!(panel instanceof HTMLElement)) return;
    panel.removeAttribute("hidden");
    this.ensureChat();
    this.paint();
    queueMicrotask(() => {
      const input = this.chat?.shadowRoot?.querySelector("input");
      if (input instanceof HTMLInputElement) input.focus();
    });
  }

  private close(): void {
    this.shadowRoot?.querySelector(".panel")?.setAttribute("hidden", "");
    this.paint();
    const launcher = this.shadowRoot?.querySelector(".launcher");
    if (launcher instanceof HTMLButtonElement) launcher.focus();
  }

  private ensureChat(): void {
    const body = this.shadowRoot?.querySelector(".body");
    if (!(body instanceof HTMLElement)) return;
    if (!this.chat) {
      this.chat = document.createElement("worktual-chat");
      body.appendChild(this.chat);
    }
    this.syncChat();
  }

  private syncChat(): void {
    if (!this.chat) return;
    const copy = ["endpoint", "token", "locale", ...Object.keys(THEME_VARS)];
    for (const name of copy) {
      const value = this.getAttribute(name);
      if (value && value.trim()) this.chat.setAttribute(name, value);
      else this.chat.removeAttribute(name);
    }
  }
}

const TEMPLATE = `
<style>
  :host {
    position: fixed;
    z-index: 40;
    inset-inline-end: 20px;
    inset-block-end: 20px;
    font-family: var(--wt-font, system-ui, sans-serif);
    color: var(--wt-text, #0f172a);
  }
  .launcher {
    width: 56px;
    height: 56px;
    border: 0;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: var(--wt-primary, #0f172a);
    color: #fff;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.28);
    cursor: pointer;
  }
  .launcher:focus-visible, .close:focus-visible {
    outline: 2px solid var(--wt-primary, #0f172a);
    outline-offset: 3px;
  }
  .icon { width: 26px; height: 26px; display: block; }
  .icon svg { width: 100%; height: 100%; display: block; }
  .panel {
    position: absolute;
    inset-inline-end: 0;
    bottom: 68px;
    width: min(380px, calc(100vw - 32px));
    height: min(640px, calc(100vh - 96px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--wt-surface, #fff);
    color: inherit;
    border-radius: var(--wt-radius, 16px);
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
  }
  .panel[hidden] { display: none; }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--wt-primary, #0f172a);
    color: #fff;
  }
  .title { margin: 0; font-size: 14px; font-weight: 600; }
  .close {
    margin-inline-start: auto;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .close svg { width: 18px; height: 18px; display: block; }
  .body { flex: 1; min-height: 0; display: flex; }
  .body worktual-chat { flex: 1; min-height: 0; height: 100%; }
</style>
<div class="panel" role="dialog" hidden>
  <div class="head">
    <p class="title"></p>
    <button class="close" type="button">${CLOSE}</button>
  </div>
  <div class="body"></div>
</div>
<button class="launcher" type="button" aria-expanded="false">
  <span class="icon">${BUBBLE}</span>
</button>
`;
