import { endWidgetSession, failureDetail, widgetClient } from "./widget-client.js";
import type { AiInsightResult, AiMetricValue } from "@worktual/ticketing";
import { chatStrings, insightStrings, localeDir, type InsightStrings } from "./i18n.js";

const THEME_VARS: Record<string, string> = {
  "theme-primary-color": "--wt-primary",
  "theme-border-radius": "--wt-radius",
  "theme-font": "--wt-font",
  "theme-surface": "--wt-surface",
  "theme-text": "--wt-text",
};

type InsightKind = "metrics" | "why" | "tickets";

export type WorktualInsightActionDetail = {
  feature: "ai.tasks.askMetrics" | "ai.tasks.askWhy" | "ai.tasks.listTickets";
  status?: AiInsightResult["status"];
  reply?: string;
  code?: string;
};

export class WorktualInsightsElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["endpoint", "token", "locale", "powered-by", ...Object.keys(THEME_VARS)];
  }

  labels: Partial<InsightStrings> | null = null;

  private ready = false;
  private busy = false;
  private bodyText = "";
  private metrics: AiMetricValue[] = [];
  private rows: Array<Record<string, unknown>> = [];

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.querySelector(".actions")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button[data-kind]");
      if (!(button instanceof HTMLButtonElement)) return;
      const kind = button.dataset.kind;
      if (kind === "metrics" || kind === "why" || kind === "tickets") void this.ask(kind);
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

  private strings(): InsightStrings {
    return insightStrings(this.locale(), this.labels);
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
    const input = this.shadowRoot?.querySelector("input");
    if (input instanceof HTMLInputElement) input.placeholder = this.strings().placeholder;
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
    const metrics = root.querySelector("button[data-kind=metrics]");
    const why = root.querySelector("button[data-kind=why]");
    const tickets = root.querySelector("button[data-kind=tickets]");
    if (metrics) metrics.textContent = strings.metrics;
    if (why) why.textContent = strings.why;
    if (tickets) tickets.textContent = strings.tickets;
    const body = root.querySelector(".body");
    if (body) body.textContent = this.bodyText;
    const metricTable = root.querySelector("table.metrics");
    const rowTable = root.querySelector("table.rows");
    if (metricTable instanceof HTMLTableElement) {
      metricTable.replaceChildren();
      metricTable.hidden = this.metrics.length === 0;
      if (this.metrics.length) {
        const body = document.createElement("tbody");
        for (const metric of this.metrics) {
          const tr = document.createElement("tr");
          const label = document.createElement("th");
          label.scope = "row";
          label.textContent = metric.label || "";
          const value = document.createElement("td");
          value.textContent = String(metric.value);
          tr.append(label, value);
          body.appendChild(tr);
        }
        metricTable.appendChild(body);
      }
    }
    if (rowTable instanceof HTMLTableElement) {
      rowTable.replaceChildren();
      const visible = this.rows.filter((row) => {
        const number = String(row.ticketNumber || row.ticket_number || row.id || "").trim();
        const subject = String(row.subject || "").trim();
        return Boolean(number || subject);
      });
      rowTable.hidden = visible.length === 0;
      if (visible.length) {
        const body = document.createElement("tbody");
        for (const row of visible) {
          const number = String(row.ticketNumber || row.ticket_number || row.id || "").trim();
          const subject = String(row.subject || "").trim();
          const status = String(row.status || "").trim();
          const tr = document.createElement("tr");
          for (const text of [number, subject, status]) {
            const cell = document.createElement("td");
            cell.textContent = text;
            tr.appendChild(cell);
          }
          body.appendChild(tr);
        }
        rowTable.appendChild(body);
      }
    }
    for (const button of Array.from(root.querySelectorAll("button"))) {
      if (button instanceof HTMLButtonElement) button.disabled = this.busy;
    }
    const powered = root.querySelector(".powered");
    if (powered instanceof HTMLElement) {
      powered.textContent = chatStrings(this.locale()).poweredBy;
      powered.hidden = this.getAttribute("powered-by") === "false";
    }
  }

  private question(): string {
    const input = this.shadowRoot?.querySelector("input");
    return input instanceof HTMLInputElement ? input.value.trim() : "";
  }

  private async ask(kind: InsightKind): Promise<void> {
    if (this.busy) return;
    const strings = this.strings();
    if (!this.getAttribute("endpoint") || !this.getAttribute("token")) {
      this.bodyText = strings.missingAuth;
      this.metrics = [];
      this.rows = [];
      this.paint();
      return;
    }
    const message = this.question();
    if (!message) {
      this.bodyText = strings.missingQuestion;
      this.metrics = [];
      this.rows = [];
      this.paint();
      return;
    }
    this.busy = true;
    this.paint();
    const feature =
      kind === "metrics" ? "ai.tasks.askMetrics" : kind === "why" ? "ai.tasks.askWhy" : "ai.tasks.listTickets";
    try {
      const tasks = this.client().ai.tasks;
      const input = {
        message,
        locale: this.locale(),
        sessionToken: this.getAttribute("token") || "",
      };
      const result =
        kind === "metrics"
          ? await tasks.askMetrics(input)
          : kind === "why"
            ? await tasks.askWhy(input)
            : await tasks.listTickets(input);
      this.bodyText = result.reply || (result.status === "temporarily_unavailable" ? strings.unavailable : "");
      this.metrics = result.metrics;
      this.rows = result.rows;
      const detail: WorktualInsightActionDetail = {
        feature,
        status: result.status,
        reply: result.reply,
        code: result.code,
      };
      this.dispatchEvent(new CustomEvent("worktual-action", { bubbles: true, composed: true, detail }));
    } catch (error) {
      const failure = failureDetail(error, "Request failed");
      this.bodyText = failure.message;
      this.dispatchEvent(
        new CustomEvent("worktual-action", {
          bubbles: true,
          composed: true,
          detail: { feature, reply: failure.message, code: failure.code },
        })
      );
      this.metrics = [];
      this.rows = [];
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
  input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #cbd5e1;
    border-radius: var(--wt-radius, 8px);
    padding: 8px 10px;
    font: inherit;
    color: inherit;
    background: transparent;
  }
  .actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  button {
    border: 0;
    background: var(--wt-primary, #0f172a);
    color: #fff;
    border-radius: var(--wt-radius, 8px);
    padding: 8px 12px;
    font: inherit;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .body { margin: 8px 0 0; white-space: pre-wrap; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
  }
  th, td {
    text-align: start;
    padding: 6px 8px;
    border-bottom: 1px solid #e2e8f0;
  }
  th { font-weight: 600; }
  .powered { margin: 8px 0 0; color: #94a3b8; font-size: 11px; }
</style>
<div class="shell">
  <h2 class="title"></h2>
  <input type="text" name="question" autocomplete="off" />
  <div class="actions">
    <button type="button" data-kind="metrics"></button>
    <button type="button" data-kind="why"></button>
    <button type="button" data-kind="tickets"></button>
  </div>
  <p class="body"></p>
  <table class="metrics" hidden></table>
  <table class="rows" hidden></table>
  <p class="powered"></p>
</div>
`;
