import { endWidgetSession, failureDetail, widgetClient } from "./widget-client.js";
import type { SdkProposal } from "@worktual/ticketing";
import { approvalStrings, chatStrings, localeDir, type ApprovalStrings } from "./i18n.js";

const THEME_VARS: Record<string, string> = {
  "theme-primary-color": "--wt-primary",
  "theme-border-radius": "--wt-radius",
  "theme-font": "--wt-font",
  "theme-surface": "--wt-surface",
  "theme-text": "--wt-text",
};

export type WorktualApprovalActionDetail = {
  feature: "ai.proposals.list" | "ai.proposals.confirm" | "ai.proposals.reject";
  id?: string;
  status?: string;
  ticketNumber?: string | null;
  code?: string;
};

export class WorktualApprovalsElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["endpoint", "token", "locale", "ticket", "status", "powered-by", ...Object.keys(THEME_VARS)];
  }

  labels: Partial<ApprovalStrings> | null = null;

  private ready = false;
  private busy = false;
  private items: SdkProposal[] = [];
  private note = "";
  private loadGeneration = 0;

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.querySelector(".list")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button[data-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      const id = button.dataset.id || "";
      const action = button.dataset.action;
      if (action === "confirm") void this.decide(id, "confirm");
      if (action === "reject") void this.decide(id, "reject");
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
    if (name === "ticket" || name === "token" || name === "endpoint" || name === "status" || name === "locale") {
      void this.load();
    } else {
      this.paint();
    }
  }

  private locale(): string {
    return (this.getAttribute("locale") || "en").trim() || "en";
  }

  private strings(): ApprovalStrings {
    return approvalStrings(this.locale(), this.labels);
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
      if (!this.items.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = this.note || strings.empty;
        list.appendChild(empty);
      }
      for (const item of this.items) {
        const card = document.createElement("article");
        card.className = "card";
        const heading = document.createElement("h3");
        heading.textContent = item.ticketNumber ? `${item.ticketNumber} · ${item.summary}` : item.summary;
        card.appendChild(heading);
        const meta = document.createElement("p");
        meta.className = "meta";
        meta.textContent =
          item.status === "recommendation" ? strings.recommendation : item.agentId;
        card.appendChild(meta);
        if (item.draft) {
          const box = document.createElement("textarea");
          box.dataset.id = item.id;
          box.value = item.draft;
          card.appendChild(box);
        }
        const row = document.createElement("div");
        row.className = "row";
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.className = "primary";
        confirm.dataset.action = "confirm";
        confirm.dataset.id = item.id;
        confirm.textContent = this.busy ? strings.working : strings.confirm;
        confirm.disabled = this.busy;
        const reject = document.createElement("button");
        reject.type = "button";
        reject.dataset.action = "reject";
        reject.dataset.id = item.id;
        reject.textContent = strings.reject;
        reject.disabled = this.busy;
        row.append(confirm, reject);
        card.appendChild(row);
        list.appendChild(card);
      }
    }
    const powered = root.querySelector(".powered");
    if (powered instanceof HTMLElement) {
      powered.textContent = chatStrings(this.locale()).poweredBy;
      powered.hidden = this.getAttribute("powered-by") === "false";
    }
  }

  private emit(feature: WorktualApprovalActionDetail["feature"], detail: Partial<WorktualApprovalActionDetail> = {}): void {
    this.dispatchEvent(
      new CustomEvent("worktual-action", {
        bubbles: true,
        composed: true,
        detail: { feature, ...detail },
      })
    );
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
    this.note = "";
    try {
      const result = await this.client().ai.proposals.list({
        sessionToken: this.getAttribute("token") || "",
        ticketNumber: this.getAttribute("ticket") || undefined,
        status: this.getAttribute("status") || undefined,
      });
      if (generation !== this.loadGeneration) return;
      this.items = result.items || [];
      this.emit("ai.proposals.list", { status: "answered" });
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.items = [];
      const failure = failureDetail(error, "Request failed");
      this.note = failure.message;
      this.emit("ai.proposals.list", { code: failure.code });
    }
    this.paint();
  }

  private async decide(id: string, decision: "confirm" | "reject"): Promise<void> {
    if (this.busy || !id) return;
    const boxes = Array.from(this.shadowRoot?.querySelectorAll("textarea") || []);
    let text: string | undefined;
    for (const box of boxes) {
      if (box instanceof HTMLTextAreaElement && box.dataset.id === id) text = box.value;
    }
    const current = this.items.find((item) => item.id === id);
    this.busy = true;
    this.paint();
    try {
      const result = await this.client().ai.proposals.decide({
        id,
        decision,
        sessionToken: this.getAttribute("token") || "",
        edits: text != null ? { text } : undefined,
      });
      this.items = this.items.filter((item) => item.id !== id);
      this.emit(decision === "confirm" ? "ai.proposals.confirm" : "ai.proposals.reject", {
        id,
        status: result.status,
        ticketNumber: current?.ticketNumber,
      });
    } catch (error) {
      const failure = failureDetail(error, "Request failed");
      this.note = failure.message;
      this.emit(decision === "confirm" ? "ai.proposals.confirm" : "ai.proposals.reject", {
        id,
        code: failure.code,
        ticketNumber: current?.ticketNumber,
      });
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
    line-height: 1.45;
  }
  .shell {
    background: var(--wt-surface, #ffffff);
    border: 1px solid color-mix(in srgb, var(--wt-primary, #0f172a) 16%, #e2e8f0);
    border-radius: var(--wt-radius, 8px);
    padding: 12px;
  }
  .title { margin: 0 0 8px; font-size: 15px; }
  .empty { margin: 0; color: #64748b; }
  .card {
    margin-top: 8px;
    padding: 8px;
    border: 1px solid #e2e8f0;
    border-radius: var(--wt-radius, 8px);
  }
  .card h3 { margin: 0; font-size: 14px; }
  .meta { margin: 4px 0 0; color: #64748b; font-size: 12px; }
  textarea {
    width: 100%;
    box-sizing: border-box;
    margin-top: 8px;
    min-height: 72px;
    border: 1px solid #cbd5e1;
    border-radius: var(--wt-radius, 8px);
    padding: 8px;
    font: inherit;
    color: inherit;
    background: transparent;
  }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  button {
    border: 1px solid #cbd5e1;
    background: #fff;
    color: inherit;
    border-radius: var(--wt-radius, 8px);
    padding: 8px 12px;
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: var(--wt-primary, #0f172a);
    color: #fff;
    border-color: transparent;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .powered { margin: 8px 0 0; color: #94a3b8; font-size: 11px; }
</style>
<div class="shell">
  <h2 class="title"></h2>
  <div class="list"></div>
  <p class="powered"></p>
</div>
`;
