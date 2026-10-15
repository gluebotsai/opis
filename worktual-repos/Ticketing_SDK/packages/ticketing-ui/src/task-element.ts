import { failureDetail } from "./widget-client.js";
import { endWidgetSession, widgetClient } from "./widget-client.js";
import type { AiTaskResult, AiToolProposal, SdkTaskId } from "@worktual/ticketing";
import { chatStrings, localeDir, taskStrings, type TaskStrings } from "./i18n.js";

type CardTaskId = Exclude<SdkTaskId, "analytics.ask" | "analytics.why" | "ticket.list">;

const THEME_VARS: Record<string, string> = {
  "theme-primary-color": "--wt-primary",
  "theme-border-radius": "--wt-radius",
  "theme-font": "--wt-font",
  "theme-surface": "--wt-surface",
  "theme-text": "--wt-text",
};

const FEATURE: Record<CardTaskId, string> = {
  "ticket.summarize": "ai.tasks.summarize",
  "ticket.classify": "ai.tasks.classify",
  "ticket.draftReply": "ai.tasks.draftReply",
  "ticket.similar": "ai.tasks.similar",
  "ticket.kb": "ai.tasks.recommendKb",
  "intake.deflect": "ai.tasks.deflect",
  "ticket.create": "ai.tasks.createTicket",
  "ticket.assign": "ai.tasks.assign",
  "ticket.resolveSuggest": "ai.tasks.resolveSuggest",
  "ticket.quality": "ai.tasks.qualityCheck",
  "sla.advise": "ai.tasks.slaAdvise",
  "ticket.workload": "ai.tasks.workload",
};

const TITLE_KEY: Record<CardTaskId, keyof TaskStrings["titles"]> = {
  "ticket.summarize": "summarize",
  "ticket.classify": "classify",
  "ticket.draftReply": "draftReply",
  "ticket.similar": "similar",
  "ticket.kb": "kb",
  "intake.deflect": "deflect",
  "ticket.create": "create",
  "ticket.assign": "assign",
  "ticket.resolveSuggest": "resolve",
  "ticket.quality": "quality",
  "sla.advise": "sla",
  "ticket.workload": "workload",
};

export type WorktualTaskActionDetail = {
  feature: string;
  task: CardTaskId;
  status?: AiTaskResult["status"];
  reply?: string;
  sessionId?: string;
  ticketNumber?: string;
  proposal?: { name: string; args?: Record<string, unknown> } | null;
  code?: string;
};

export class WorktualTaskElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["endpoint", "token", "locale", "ticket", "issue", "powered-by", ...Object.keys(THEME_VARS)];
  }

  task: CardTaskId = "ticket.summarize";
  labels: Partial<TaskStrings> | null = null;

  private ready = false;
  private busy = false;
  private bodyText = "";
  private draft = "";
  private status: AiTaskResult["status"] | "" = "";
  private proposal: AiToolProposal | null = null;
  private articles: AiTaskResult["articles"] = [];
  private tickets: AiTaskResult["tickets"] = [];
  private sessionId = "";

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.querySelector(".run")?.addEventListener("click", () => {
      void this.runTask();
    });
    root.querySelector(".actions")?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("button[data-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.dataset.action === "confirm") void this.confirmTask();
      if (button.dataset.action === "reject") void this.rejectTask();
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

  private strings(): TaskStrings {
    return taskStrings(this.locale(), this.labels);
  }

  private ticket(): string {
    return (this.getAttribute("ticket") || this.getAttribute("focused-ticket") || "").trim();
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
    if (title) title.textContent = strings.titles[TITLE_KEY[this.task]];
    const run = root.querySelector(".run");
    if (run) run.textContent = this.busy ? strings.working : strings.run;
    const body = root.querySelector(".body");
    if (body) body.textContent = this.bodyText;
    const draft = root.querySelector("textarea");
    if (draft instanceof HTMLTextAreaElement) {
      draft.value = this.draft;
      draft.placeholder = strings.draftLabel;
      draft.hidden = this.task !== "ticket.draftReply" || !this.draft;
    }
    const list = root.querySelector(".list");
    if (list) {
      list.replaceChildren();
      for (const article of this.articles) {
        const item = document.createElement("li");
        item.textContent = article.title;
        list.appendChild(item);
      }
      for (const ticket of this.tickets) {
        const item = document.createElement("li");
        item.textContent = ticket.subject ? `${ticket.ticketNumber} ${ticket.subject}` : ticket.ticketNumber;
        list.appendChild(item);
      }
    }
    const actions = root.querySelector(".actions");
    if (actions) {
      actions.replaceChildren();
      const canWrite =
        this.task !== "ticket.similar" &&
        this.task !== "ticket.kb" &&
        this.task !== "intake.deflect" &&
        this.task !== "ticket.workload" &&
        this.status === "confirmation_required";
      if (canWrite) {
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.className = "primary";
        confirm.dataset.action = "confirm";
        confirm.textContent = this.task === "ticket.draftReply" ? strings.send : strings.confirm;
        confirm.disabled = this.busy;
        const reject = document.createElement("button");
        reject.type = "button";
        reject.dataset.action = "reject";
        reject.textContent = strings.reject;
        reject.disabled = this.busy;
        actions.append(confirm, reject);
      }
    }
    const powered = root.querySelector(".powered");
    if (powered instanceof HTMLElement) {
      powered.textContent = chatStrings(this.locale()).poweredBy;
      powered.hidden = this.getAttribute("powered-by") === "false";
    }
    const runButton = root.querySelector(".run");
    if (runButton instanceof HTMLButtonElement) runButton.disabled = this.busy;
  }

  private emit(
    feature: string,
    result?: { status?: AiTaskResult["status"]; reply?: string; sessionId?: string; code?: string }
  ): void {
    const detail: WorktualTaskActionDetail = {
      feature,
      task: this.task,
      status: result?.status,
      reply: result?.reply,
      sessionId: result?.sessionId || this.sessionId || undefined,
      ticketNumber: this.ticket() || undefined,
      code: result?.code,
      proposal: this.proposal
        ? { name: this.proposal.name, args: this.proposal.args }
        : null,
    };
    this.dispatchEvent(new CustomEvent("worktual-action", { bubbles: true, composed: true, detail }));
  }

  private fail(error: unknown): void {
    const failure = failureDetail(error, "Request failed");
    this.bodyText = failure.message;
    this.emit(FEATURE[this.task], { reply: failure.message, code: failure.code });
  }

  private async runTask(): Promise<void> {
    if (this.busy) return;
    const strings = this.strings();
    if (!this.getAttribute("endpoint") || !this.getAttribute("token")) {
      this.bodyText = strings.missingAuth;
      this.paint();
      return;
    }
    const needsIssue = this.task === "intake.deflect" || this.task === "ticket.create";
    const needsTicket = this.task !== "ticket.workload" && !needsIssue;
    if (needsIssue) {
      const issue = (this.getAttribute("issue") || "").trim();
      if (!issue) {
        this.bodyText = strings.missingIssue;
        this.paint();
        return;
      }
    } else if (needsTicket && !this.ticket()) {
      this.bodyText = strings.missingTicket;
      this.paint();
      return;
    }
    this.busy = true;
    this.paint();
    try {
      const input = {
        locale: this.locale(),
        sessionToken: this.getAttribute("token") || "",
        sessionId: this.sessionId || this.getAttribute("session-id") || undefined,
        ticketNumber: this.ticket() || undefined,
        message: needsIssue ? this.getAttribute("issue") || "" : undefined,
      };
      const tasks = this.client().ai.tasks;
      const runners: Record<CardTaskId, () => Promise<AiTaskResult>> = {
        "ticket.summarize": () => tasks.summarize(input),
        "ticket.classify": () => tasks.classify(input),
        "ticket.draftReply": () => tasks.draftReply(input),
        "ticket.similar": () => tasks.similar(input),
        "ticket.kb": () => tasks.recommendKb(input),
        "intake.deflect": () => tasks.deflect(input),
        "ticket.create": () => tasks.createTicket(input),
        "ticket.assign": () => tasks.assign(input),
        "ticket.resolveSuggest": () => tasks.resolveSuggest(input),
        "ticket.quality": () => tasks.qualityCheck(input),
        "sla.advise": () => tasks.slaAdvise(input),
        "ticket.workload": () => tasks.workload(input),
      };
      const result = await runners[this.task]();
      this.applyResult(result);
      this.emit(FEATURE[this.task], result);
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
      this.paint();
    }
  }

  private applyResult(result: AiTaskResult): void {
    if (result.sessionId) {
      this.sessionId = result.sessionId;
      this.setAttribute("session-id", result.sessionId);
    }
    this.bodyText = result.reply;
    this.draft = result.draft || "";
    this.status = result.status;
    this.proposal = result.proposal;
    this.articles = result.articles;
    this.tickets = result.tickets;
    if (this.task === "ticket.draftReply" && result.status !== "applied") {
      this.status = "confirmation_required";
    }
  }

  private async confirmTask(): Promise<void> {
    if (this.busy) return;
    const ticket = this.ticket();
    const draftBox = this.shadowRoot?.querySelector("textarea");
    const text = draftBox instanceof HTMLTextAreaElement ? draftBox.value : this.draft;
    const name = this.proposal?.name || (this.task === "ticket.draftReply" ? "add_ticket_note" : "update_ticket");
    const args: Record<string, unknown> = {
      ...(this.proposal?.args || {}),
      ...(ticket ? { ticket_number: ticket } : {}),
      ...(this.task === "ticket.draftReply" ? { text, visibility: "public" } : {}),
    };
    this.busy = true;
    this.paint();
    try {
      const result = await this.client().ai.confirm({
        locale: this.locale(),
        sessionToken: this.getAttribute("token") || "",
        sessionId: this.sessionId || this.getAttribute("session-id") || undefined,
        focusedTicketId: ticket || undefined,
        message: this.task === "ticket.draftReply" ? "Send this reply" : "confirm",
        confirmTool: { name, args },
      });
      this.bodyText = result.reply;
      this.status = result.status;
      this.proposal = null;
      this.draft = "";
      this.emit("ai.confirm", result);
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
      this.paint();
    }
  }

  private async rejectTask(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.paint();
    try {
      const result = await this.client().ai.reject({
        locale: this.locale(),
        sessionToken: this.getAttribute("token") || "",
        sessionId: this.sessionId || this.getAttribute("session-id") || undefined,
        focusedTicketId: this.ticket() || undefined,
      });
      this.bodyText = result.reply;
      this.status = "answered";
      this.proposal = null;
      this.draft = "";
      this.emit("ai.reject", result);
    } catch (error) {
      this.fail(error);
    } finally {
      this.busy = false;
      this.paint();
    }
  }
}

export class WorktualSummaryElement extends WorktualTaskElement {
  task: CardTaskId = "ticket.summarize";
}
export class WorktualClassifyElement extends WorktualTaskElement {
  task: CardTaskId = "ticket.classify";
}
export class WorktualReplyDraftElement extends WorktualTaskElement {
  task: CardTaskId = "ticket.draftReply";
}
export class WorktualSimilarElement extends WorktualTaskElement {
  task: CardTaskId = "ticket.similar";
}
export class WorktualKbElement extends WorktualTaskElement {
  task: CardTaskId = "ticket.kb";
}
export class WorktualDeflectionElement extends WorktualTaskElement {
  task: CardTaskId = "intake.deflect";
}
export class WorktualAssignElement extends WorktualTaskElement {
  task: CardTaskId = "ticket.assign";
}
export class WorktualResolveElement extends WorktualTaskElement {
  task: CardTaskId = "ticket.resolveSuggest";
}
export class WorktualQualityElement extends WorktualTaskElement {
  task: CardTaskId = "ticket.quality";
}
export class WorktualSlaElement extends WorktualTaskElement {
  task: CardTaskId = "sla.advise";
}
export class WorktualWorkloadElement extends WorktualTaskElement {
  task: CardTaskId = "ticket.workload";
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
  .body { margin: 0; white-space: pre-wrap; }
  .list { margin: 8px 0 0; padding-inline-start: 18px; }
  textarea {
    width: 100%;
    box-sizing: border-box;
    margin-top: 8px;
    min-height: 88px;
    border: 1px solid #cbd5e1;
    border-radius: var(--wt-radius, 8px);
    padding: 8px;
    font: inherit;
    color: inherit;
    background: transparent;
  }
  .row { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  button {
    border: 1px solid #cbd5e1;
    background: #fff;
    color: inherit;
    border-radius: var(--wt-radius, 8px);
    padding: 8px 12px;
    font: inherit;
    cursor: pointer;
  }
  button.primary, button.run {
    background: var(--wt-primary, #0f172a);
    color: #fff;
    border-color: transparent;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .powered { margin: 8px 0 0; color: #94a3b8; font-size: 11px; }
</style>
<div class="shell">
  <h2 class="title"></h2>
  <p class="body"></p>
  <ul class="list"></ul>
  <textarea hidden></textarea>
  <div class="row">
    <button class="run" type="button"></button>
    <span class="actions"></span>
  </div>
  <p class="powered"></p>
</div>
`;
