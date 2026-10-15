import { endWidgetSession, failureDetail, widgetClient } from "./widget-client.js";
import type { AiToolProposal, AiTurnResult, AiTurnStatus } from "@worktual/ticketing";
import { chatStrings, localeDir, type ChatStrings } from "./i18n.js";

type Bubble = {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposals: AiToolProposal[];
  status?: AiTurnStatus;
};

export type WorktualActionDetail = {
  feature: "ai.turn" | "ai.stream" | "ai.tasks.createTicket" | "ai.confirm" | "ai.reject" | "auth.session_end";
  code?: string;
  status?: AiTurnStatus;
  reply?: string;
  agent?: string;
  sessionId?: string;
  ticketNumber?: string | null;
  proposal?: { name: string; args?: Record<string, unknown> } | null;
  uiActions?: Array<Record<string, unknown>>;
};

const THEME_VARS: Record<string, string> = {
  "theme-primary-color": "--wt-primary",
  "theme-border-radius": "--wt-radius",
  "theme-font": "--wt-font",
  "theme-surface": "--wt-surface",
  "theme-text": "--wt-text",
};

function proposalLine(proposal: AiToolProposal): string {
  const name = proposal.name.replace(/_/g, " ");
  const bits = Object.entries(proposal.args || {})
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${value}`);
  return bits.length ? `${name} (${bits.join(", ")})` : name;
}

function gatedProposals(proposals: AiToolProposal[]): AiToolProposal[] {
  return proposals.filter((proposal) => proposal.auto === false || proposal.risk === "high");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function actionPayload(action: Record<string, unknown>): Record<string, unknown> {
  return asRecord(action.payload) || action;
}

function listedRows(action: Record<string, unknown>): Array<Record<string, unknown>> | null {
  const payload = actionPayload(action);
  const raw = payload.tickets ?? payload.rows ?? payload.items;
  if (!Array.isArray(raw)) return null;
  return raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
}

function ticketFrom(action: Record<string, unknown>): string {
  const payload = actionPayload(action);
  return String(payload.ticketNumber || payload.ticket_number || payload.id || "").trim();
}

function rowNumber(row: Record<string, unknown>): string {
  return String(row.ticketNumber || row.ticket_number || row.id || "").trim();
}

export class WorktualChatElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [
      "endpoint",
      "token",
      "locale",
      "mode",
      "lists",
      "powered-by",
      ...Object.keys(THEME_VARS),
    ];
  }

  /** Host copy overrides for the chrome strings. */
  labels: Partial<ChatStrings> | null = null;

  private bubbles: Bubble[] = [];
  private listRows: Array<Record<string, unknown>> = [];
  private busy = false;
  private statusText = "";
  private ready = false;
  private seq = 0;

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.sendCurrent();
    });
    root.querySelector(".tickets")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const row = target.closest("tr[data-ticket]");
      if (!(row instanceof HTMLTableRowElement)) return;
      const ticket = row.dataset.ticket || "";
      if (!ticket) return;
      this.setAttribute("focused-ticket", ticket);
    });
    root.querySelector(".log")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button[data-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      const action = button.dataset.action;
      const bubbleId = button.dataset.bubble || "";
      const name = button.dataset.name || "";
      if (action === "confirm") void this.confirmProposal(bubbleId, name);
      if (action === "reject") void this.rejectProposal(bubbleId);
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

  private strings(): ChatStrings {
    return chatStrings(this.locale(), this.labels);
  }

  private applyTheme(): void {
    for (const [attr, cssVar] of Object.entries(THEME_VARS)) {
      const value = this.getAttribute(attr);
      if (value && value.trim()) this.style.setProperty(cssVar, value.trim());
      else this.style.removeProperty(cssVar);
    }
    this.classList.toggle("sidebar", this.getAttribute("mode") === "sidebar");
  }

  private applyLocale(): void {
    const dir = localeDir(this.locale());
    this.setAttribute("dir", dir);
    const root = this.shadowRoot;
    if (!root) return;
    const strings = this.strings();
    const input = root.querySelector("input");
    if (input) input.placeholder = strings.placeholder;
    const send = root.querySelector("button.send");
    if (send) send.textContent = strings.send;
    const footer = root.querySelector(".powered");
    if (footer) {
      footer.textContent = strings.poweredBy;
      footer.toggleAttribute("hidden", this.getAttribute("powered-by") === "false");
    }
  }

  private ensureSessionId(): string {
    const existing = this.getAttribute("session-id")?.trim();
    if (existing) return existing;
    const id = `sdk_${Math.random().toString(36).slice(2, 12)}`;
    this.setAttribute("session-id", id);
    return id;
  }

  /** Revoke this session token. The host hears `worktual-session-end`. */
  endSession(): Promise<void> {
    return endWidgetSession(this);
  }

  private client() {
    return widgetClient(this);
  }

  private paint(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const log = root.querySelector(".log");
    const input = root.querySelector("input");
    const send = root.querySelector("button.send");
    if (!log || !input || !send) return;
    const strings = this.strings();
    input.disabled = this.busy;
    send.toggleAttribute("disabled", this.busy);
    log.replaceChildren();
    this.paintList();

    if (this.statusText) {
      const status = document.createElement("p");
      status.className = "status";
      status.textContent = this.statusText;
      log.appendChild(status);
    }

    for (const bubble of this.bubbles) {
      const row = document.createElement("div");
      row.className = `bubble ${bubble.role}`;
      row.dataset.bubble = bubble.id;
      const text = document.createElement("p");
      text.textContent = bubble.text;
      row.appendChild(text);

      const pending = gatedProposals(bubble.proposals);
      if (bubble.role === "assistant" && bubble.status === "confirmation_required" && pending.length) {
        const card = document.createElement("div");
        card.className = "card";
        const title = document.createElement("p");
        title.className = "card-title";
        title.textContent = strings.confirmTitle;
        card.appendChild(title);
        for (const proposal of pending) {
          const line = document.createElement("p");
          line.className = "proposal";
          line.textContent = proposalLine(proposal);
          card.appendChild(line);
          const confirm = document.createElement("button");
          confirm.type = "button";
          confirm.className = "primary";
          confirm.dataset.action = "confirm";
          confirm.dataset.bubble = bubble.id;
          confirm.dataset.name = proposal.name;
          confirm.textContent = strings.confirm;
          confirm.disabled = this.busy;
          card.appendChild(confirm);
        }
        const reject = document.createElement("button");
        reject.type = "button";
        reject.dataset.action = "reject";
        reject.dataset.bubble = bubble.id;
        reject.textContent = strings.reject;
        reject.disabled = this.busy;
        card.appendChild(reject);
        row.appendChild(card);
      }
      log.appendChild(row);
    }
    log.scrollTop = log.scrollHeight;
  }

  private push(role: Bubble["role"], text: string, extra: Partial<Bubble> = {}): Bubble {
    const bubble: Bubble = {
      id: `m${++this.seq}`,
      role,
      text,
      proposals: extra.proposals || [],
      status: extra.status,
    };
    this.bubbles.push(bubble);
    return bubble;
  }

  private showingLists(): boolean {
    return this.hasAttribute("lists");
  }

  /** Apply open_ticket and refresh_list only while this chat is showing a Worktual list. */
  private applyListActions(actions: Array<Record<string, unknown>>): void {
    if (!this.showingLists()) return;
    for (const action of actions) {
      const type = String(action.type || "").trim().toLowerCase();
      if (type === "refresh_list" || type === "refresh_tickets") {
        const rows = listedRows(action);
        if (rows) this.listRows = rows;
      }
      if (type === "open_ticket") {
        const ticket = ticketFrom(action);
        if (ticket) this.setAttribute("focused-ticket", ticket);
      }
    }
  }

  private paintList(): void {
    const table = this.shadowRoot?.querySelector(".tickets");
    if (!(table instanceof HTMLTableElement)) return;
    table.replaceChildren();
    const show = this.showingLists() && this.listRows.length > 0;
    table.hidden = !show;
    if (!show) return;
    const body = document.createElement("tbody");
    const selected = (this.getAttribute("focused-ticket") || "").trim();
    for (const row of this.listRows) {
      const number = rowNumber(row);
      const subject = String(row.subject || "").trim();
      if (!number && !subject) continue;
      const tr = document.createElement("tr");
      if (number) tr.dataset.ticket = number;
      if (number && number === selected) tr.className = "selected";
      const idCell = document.createElement("td");
      idCell.textContent = number;
      const subjectCell = document.createElement("td");
      subjectCell.textContent = subject;
      tr.append(idCell, subjectCell);
      body.appendChild(tr);
    }
    table.appendChild(body);
  }

  private emit(feature: WorktualActionDetail["feature"], result?: AiTurnResult, proposal?: AiToolProposal | null): void {
    const detail: WorktualActionDetail = {
      feature,
      status: result?.status,
      reply: result?.reply,
      code: result?.code,
      agent: result?.agent,
      sessionId: result?.sessionId || this.getAttribute("session-id") || undefined,
      ticketNumber: this.getAttribute("focused-ticket") || undefined,
      proposal: proposal ? { name: proposal.name, args: proposal.args } : null,
      uiActions: result?.uiActions,
    };
    this.dispatchEvent(new CustomEvent("worktual-action", { detail, bubbles: true, composed: true }));
  }

  private fail(feature: WorktualActionDetail["feature"], error: unknown): void {
    const failure = failureDetail(error, this.strings().missingAuth);
    this.push("assistant", failure.message);
    this.dispatchEvent(
      new CustomEvent("worktual-action", {
        detail: {
          feature,
          code: failure.code,
          reply: failure.message,
          sessionId: this.getAttribute("session-id") || undefined,
          ticketNumber: this.getAttribute("focused-ticket") || undefined,
        },
        bubbles: true,
        composed: true,
      })
    );
  }

  private async sendCurrent(): Promise<void> {
    if (this.busy) return;
    const input = this.shadowRoot?.querySelector("input");
    const message = input?.value.trim() || "";
    if (!message) return;
    if (!this.getAttribute("endpoint")?.trim() || !this.getAttribute("token")?.trim()) {
      this.push("assistant", this.strings().missingAuth);
      this.paint();
      return;
    }
    if (input) input.value = "";
    this.push("user", message);
    this.busy = true;
    this.statusText = this.strings().thinking;
    this.paint();
    const creating = this.getAttribute("mode") === "create";
    try {
      const result = await this.client().ai.stream({
        message,
        locale: this.locale(),
        sessionToken: this.getAttribute("token") || "",
        sessionId: this.ensureSessionId(),
        focusedTicketId: this.getAttribute("focused-ticket") || undefined,
        sdkTask: creating ? "ticket.create" : undefined,
        onProgress: (event) => {
          const step = String(event.step || event.label || event.message || "").trim();
          if (!step) return;
          this.statusText = step;
          this.paint();
        },
      });
      if (result.sessionId) this.setAttribute("session-id", result.sessionId);
      this.applyListActions(result.uiActions);
      this.push("assistant", result.reply, {
        proposals: result.toolProposals,
        status: result.status,
      });
      this.emit(creating ? "ai.tasks.createTicket" : "ai.stream", result);
    } catch (error) {
      this.fail(creating ? "ai.tasks.createTicket" : "ai.stream", error);
    } finally {
      this.busy = false;
      this.statusText = "";
      this.paint();
    }
  }

  private findProposal(bubbleId: string, name: string): AiToolProposal | null {
    const bubble = this.bubbles.find((item) => item.id === bubbleId);
    return bubble?.proposals.find((proposal) => proposal.name === name) || null;
  }

  private async confirmProposal(bubbleId: string, name: string): Promise<void> {
    if (this.busy) return;
    const proposal = this.findProposal(bubbleId, name);
    if (!proposal) return;
    this.busy = true;
    this.statusText = this.strings().thinking;
    this.paint();
    try {
      const result = await this.client().ai.confirm({
        locale: this.locale(),
        sessionToken: this.getAttribute("token") || "",
        sessionId: this.ensureSessionId(),
        focusedTicketId: this.getAttribute("focused-ticket") || undefined,
        confirmTool: { name: proposal.name, args: proposal.args },
      });
      if (result.sessionId) this.setAttribute("session-id", result.sessionId);
      const bubble = this.bubbles.find((item) => item.id === bubbleId);
      if (bubble) bubble.status = "applied";
      this.push("assistant", result.reply, { status: result.status, proposals: result.toolProposals });
      this.emit("ai.confirm", result, proposal);
    } catch (error) {
      this.fail("ai.confirm", error);
    } finally {
      this.busy = false;
      this.statusText = "";
      this.paint();
    }
  }

  private async rejectProposal(bubbleId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.statusText = this.strings().thinking;
    this.paint();
    try {
      const result = await this.client().ai.reject({
        locale: this.locale(),
        sessionToken: this.getAttribute("token") || "",
        sessionId: this.ensureSessionId(),
        focusedTicketId: this.getAttribute("focused-ticket") || undefined,
      });
      if (result.sessionId) this.setAttribute("session-id", result.sessionId);
      const bubble = this.bubbles.find((item) => item.id === bubbleId);
      if (bubble) bubble.status = "answered";
      this.push("assistant", result.reply, { status: result.status });
      this.emit("ai.reject", result);
    } catch (error) {
      this.fail("ai.reject", error);
    } finally {
      this.busy = false;
      this.statusText = "";
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
    display: flex;
    flex-direction: column;
    min-height: 420px;
    height: 100%;
    background: var(--wt-surface, #ffffff);
    border: 1px solid color-mix(in srgb, var(--wt-primary, #0f172a) 16%, #e2e8f0);
    border-radius: var(--wt-radius, 8px);
    overflow: hidden;
  }
  :host(.sidebar) .shell { min-height: 100%; }
  .log {
    flex: 1;
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  table.tickets {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  table.tickets td {
    text-align: start;
    padding: 6px 10px;
    border-bottom: 1px solid #e2e8f0;
    cursor: pointer;
  }
  table.tickets tr.selected td {
    background: color-mix(in srgb, var(--wt-primary, #0f172a) 12%, transparent);
  }
  .status { margin: 0; color: #64748b; font-size: 12px; }
  .bubble {
    max-width: 85%;
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--wt-radius, 8px);
  }
  .bubble p { margin: 0; white-space: pre-wrap; }
  .user {
    margin-inline-start: auto;
    background: var(--wt-primary, #0f172a);
    color: #fff;
  }
  .assistant { background: #f1f5f9; }
  .card {
    margin-top: 8px;
    padding: 8px;
    border: 1px solid #e2e8f0;
    border-radius: var(--wt-radius, 8px);
    background: #fff;
    color: var(--wt-text, #0f172a);
  }
  .card-title { font-weight: 600; margin-bottom: 6px; }
  .proposal { margin: 4px 0; }
  form {
    display: flex;
    gap: 8px;
    padding: 10px;
    border-top: 1px solid #e2e8f0;
  }
  input {
    flex: 1;
    border: 1px solid #cbd5e1;
    border-radius: var(--wt-radius, 8px);
    padding: 8px 10px;
    font: inherit;
    color: inherit;
    background: transparent;
  }
  button {
    border: 1px solid #cbd5e1;
    background: #fff;
    color: inherit;
    border-radius: var(--wt-radius, 8px);
    padding: 8px 12px;
    font: inherit;
    cursor: pointer;
  }
  button.primary, button.send {
    background: var(--wt-primary, #0f172a);
    color: #fff;
    border-color: transparent;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .card button { margin-inline-end: 6px; margin-top: 6px; }
  .powered {
    margin: 0;
    padding: 0 10px 8px;
    color: #94a3b8;
    font-size: 11px;
  }
</style>
<div class="shell">
  <table class="tickets" hidden></table>
  <div class="log" role="log" aria-live="polite"></div>
  <form>
    <input type="text" name="message" autocomplete="off" />
    <button class="send" type="submit"></button>
  </form>
  <p class="powered"></p>
</div>
`;
