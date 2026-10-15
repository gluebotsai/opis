import { failureDetail, widgetClient } from "./widget-client.js";
import { chatStrings, localeDir, loginStrings, type LoginStrings } from "./i18n.js";

const THEME_VARS: Record<string, string> = {
  "theme-primary-color": "--wt-primary",
  "theme-border-radius": "--wt-radius",
  "theme-font": "--wt-font",
  "theme-surface": "--wt-surface",
  "theme-text": "--wt-text",
};

export type WorktualLoginActionDetail = {
  feature: "auth.login" | "auth.portal.requestOtp" | "auth.portal.verifyOtp" | "auth.portal.login";
  sessionToken?: string;
  code?: string;
};

export class WorktualLoginElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["endpoint", "locale", "mode", "slug", "method", "powered-by", ...Object.keys(THEME_VARS)];
  }

  labels: Partial<LoginStrings> | null = null;

  private ready = false;
  private busy = false;
  private note = "";
  private awaitingCode = false;

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.querySelector(".submit")?.addEventListener("click", () => {
      void this.submit();
    });
    this.ready = true;
    this.applyTheme();
    this.applyLocale();
    this.paint();
  }

  attributeChangedCallback(): void {
    if (!this.ready) return;
    this.applyTheme();
    this.applyLocale();
    this.paint();
  }

  private locale(): string {
    return (this.getAttribute("locale") || "en").trim() || "en";
  }

  private strings(): LoginStrings {
    return loginStrings(this.locale(), this.labels);
  }

  private portal(): boolean {
    return this.getAttribute("mode") === "portal";
  }

  private passwordPortal(): boolean {
    return this.portal() && this.getAttribute("method") === "password";
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

  private field(name: string): string {
    const input = this.shadowRoot?.querySelector(name);
    return input instanceof HTMLInputElement ? input.value.trim() : "";
  }

  private paint(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const strings = this.strings();
    const title = root.querySelector(".title");
    if (title) title.textContent = this.portal() ? strings.portalTitle : strings.staffTitle;
    const slug = root.querySelector(".slug-row");
    if (slug instanceof HTMLElement) slug.hidden = !this.portal();
    const password = root.querySelector(".password-row");
    if (password instanceof HTMLElement) password.hidden = this.portal() && !this.passwordPortal();
    const code = root.querySelector(".code-row");
    if (code instanceof HTMLElement) code.hidden = !this.portal() || this.passwordPortal() || !this.awaitingCode;
    const emailLabel = root.querySelector(".email-label");
    if (emailLabel) emailLabel.textContent = this.portal() && !this.passwordPortal() ? strings.identifier : strings.email;
    const passwordLabel = root.querySelector(".password-label");
    if (passwordLabel) passwordLabel.textContent = strings.password;
    const codeLabel = root.querySelector(".code-label");
    if (codeLabel) codeLabel.textContent = strings.code;
    const slugLabel = root.querySelector(".slug-label");
    if (slugLabel) slugLabel.textContent = strings.slug;
    const slugInput = root.querySelector(".slug");
    if (slugInput instanceof HTMLInputElement && !slugInput.value && this.getAttribute("slug")) {
      slugInput.value = this.getAttribute("slug") || "";
    }
    const note = root.querySelector(".note");
    if (note) note.textContent = this.note;
    const button = root.querySelector(".submit");
    if (button instanceof HTMLButtonElement) {
      button.disabled = this.busy;
      if (this.busy) button.textContent = strings.working;
      else if (!this.portal() || this.passwordPortal()) button.textContent = strings.signIn;
      else if (this.awaitingCode) button.textContent = strings.verify;
      else button.textContent = strings.sendCode;
    }
    const powered = root.querySelector(".powered");
    if (powered instanceof HTMLElement) {
      powered.textContent = chatStrings(this.locale()).poweredBy;
      powered.hidden = this.getAttribute("powered-by") === "false";
    }
  }

  private emit(feature: WorktualLoginActionDetail["feature"], sessionToken?: string, code?: string): void {
    const detail: WorktualLoginActionDetail = { feature, sessionToken, code };
    this.dispatchEvent(new CustomEvent("worktual-action", { bubbles: true, composed: true, detail }));
  }

  private client() {
    return widgetClient(this);
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const strings = this.strings();
    if (!this.getAttribute("endpoint")?.trim()) {
      this.note = strings.missing;
      this.paint();
      return;
    }
    const email = this.field(".email");
    const password = this.field(".password");
    const slug = this.field(".slug") || (this.getAttribute("slug") || "").trim();
    const code = this.field(".code");
    this.busy = true;
    this.paint();
    const feature: WorktualLoginActionDetail["feature"] = !this.portal()
      ? "auth.login"
      : this.passwordPortal()
        ? "auth.portal.login"
        : this.awaitingCode
          ? "auth.portal.verifyOtp"
          : "auth.portal.requestOtp";
    try {
      const auth = this.client().auth;
      if (!this.portal()) {
        if (!email || !password) {
          this.note = strings.missing;
          return;
        }
        const result = await auth.login({ email, password });
        this.note = "";
        this.emit("auth.login", result.sessionToken);
        return;
      }
      if (!slug || !email) {
        this.note = strings.missing;
        return;
      }
      if (this.passwordPortal()) {
        if (!password) {
          this.note = strings.missing;
          return;
        }
        const result = await auth.portal.login({ slug, email, password });
        this.note = "";
        this.emit("auth.portal.login", result.sessionToken);
        return;
      }
      if (!this.awaitingCode) {
        const sent = await auth.portal.requestOtp({ slug, identifier: email });
        this.awaitingCode = true;
        this.note = sent.masked ? `${strings.sent} ${sent.masked}` : strings.sent;
        this.emit("auth.portal.requestOtp");
        return;
      }
      if (!code) {
        this.note = strings.missing;
        return;
      }
      const result = await auth.portal.verifyOtp({ slug, identifier: email, code });
      this.note = "";
      this.emit("auth.portal.verifyOtp", result.sessionToken);
    } catch (error) {
      const failure = failureDetail(error, strings.missing);
      this.note = failure.message;
      this.emit(feature, undefined, failure.code);
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
  label { display: block; margin-top: 8px; font-size: 12px; }
  input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 4px;
    border: 1px solid #cbd5e1;
    border-radius: var(--wt-radius, 8px);
    padding: 8px;
    font: inherit;
    color: inherit;
    background: transparent;
  }
  .note { min-height: 1.2em; margin: 8px 0 0; white-space: pre-wrap; }
  button {
    margin-top: 10px;
    border: 0;
    background: var(--wt-primary, #0f172a);
    color: #fff;
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
  <label class="slug-row"><span class="slug-label"></span><input class="slug" /></label>
  <label><span class="email-label"></span><input class="email" autocomplete="username" /></label>
  <label class="password-row"><span class="password-label"></span><input class="password" type="password" autocomplete="current-password" /></label>
  <label class="code-row" hidden><span class="code-label"></span><input class="code" inputmode="numeric" /></label>
  <p class="note"></p>
  <button class="submit" type="button"></button>
  <p class="powered"></p>
</div>
`;
