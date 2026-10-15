export type DeskAssistDetail = {
  ticket?: string;
  guidance: string;
  reply: string;
};

const THEME_VARS: Record<string, string> = {
  "theme-primary-color": "--wt-primary",
  "theme-border-radius": "--wt-radius",
  "theme-font": "--wt-font",
};

export class WorktualDeskAssistElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["recommend-url", "issue", "locale", ...Object.keys(THEME_VARS)];
  }

  private ready = false;
  private busy = false;
  private guidance = "";
  private reply = "";
  private fault = "";

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.querySelector(".save")?.addEventListener("click", () => {
      void this.saveOnDesk();
    });
    root.querySelector(".own")?.addEventListener("click", () => {
      void this.keepAndClose(true);
    });
    root.querySelector(".dismiss")?.addEventListener("click", () => {
      void this.keepAndClose(false);
    });
    this.ready = true;
    this.applyTheme();
    void this.suggest();
  }

  attributeChangedCallback(): void {
    if (!this.ready) return;
    this.applyTheme();
  }

  private applyTheme(): void {
    for (const [attr, cssVar] of Object.entries(THEME_VARS)) {
      const value = this.getAttribute(attr);
      if (value && value.trim()) this.style.setProperty(cssVar, value.trim());
      else this.style.removeProperty(cssVar);
    }
  }

  private issue(): string {
    return (this.getAttribute("issue") || "").trim();
  }

  private async suggest(): Promise<void> {
    const issue = this.issue();
    if (!issue) return;
    if (!this.getAttribute("recommend-url")?.trim()) {
      this.fault = "The recommendation service is not configured.";
      this.paint();
      return;
    }
    this.busy = true;
    this.paint();
    try {
      const result = await askForReply({
        recommendUrl: this.getAttribute("recommend-url") || "",
        locale: (this.getAttribute("locale") || "en").trim() || "en",
        issue,
      });
      this.guidance = result.guidance;
      this.reply = result.reply;
      this.fault = "";
    } catch (error) {
      this.fault = error instanceof Error ? error.message : "Suggestion failed.";
      this.guidance = "";
      this.reply = "";
    } finally {
      this.busy = false;
      this.paint();
    }
  }

  private paint(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const dialog = root.querySelector(".dialog");
    const status = root.querySelector(".status");
    const guidance = root.querySelector(".guidance");
    const reply = root.querySelector(".reply");
    const fault = root.querySelector(".fault");
    const ticket = (this.getAttribute("ticket") || "").trim();
    const kicker = root.querySelector(".kicker");
    if (kicker) kicker.textContent = ticket ? `Suggestion for ${ticket}` : "Suggestion";
    if (status instanceof HTMLElement) {
      status.hidden = !this.busy;
      status.textContent = "Reading this ticket…";
    }
    if (dialog instanceof HTMLElement) dialog.hidden = this.busy || (!this.reply && !this.fault && !this.guidance);
    if (guidance instanceof HTMLElement) {
      guidance.hidden = !this.guidance;
      guidance.textContent = this.guidance;
    }
    if (fault instanceof HTMLElement) {
      fault.hidden = !this.fault;
      fault.textContent = this.fault;
    }
    if (!this.busy && reply instanceof HTMLTextAreaElement && reply.dataset.filled !== "1") {
      reply.value = this.reply;
      reply.dataset.filled = "1";
    }
  }

  private replyValue(): string {
    const reply = this.shadowRoot?.querySelector(".reply");
    return reply instanceof HTMLTextAreaElement ? reply.value.trim() : this.reply.trim();
  }

  private async saveOnDesk(): Promise<void> {
    const text = this.replyValue();
    const action = (this.getAttribute("save-url") || "").trim();
    if (!text || !action) return;
    const kept = await this.keep();
    if (!kept) return;
    const form = document.createElement("form");
    form.method = "post";
    form.action = action;
    form.append(hidden("csrf", this.getAttribute("csrf") || ""), hidden("body", text));
    document.body.appendChild(form);
    this.emit("worktual-desk-save", text);
    form.submit();
  }

  private async keepAndClose(focusNote: boolean): Promise<void> {
    const kept = await this.keep();
    if (!kept) return;
    const dialog = this.shadowRoot?.querySelector(".dialog");
    if (dialog instanceof HTMLElement) dialog.hidden = true;
    const status = this.shadowRoot?.querySelector(".status");
    if (status instanceof HTMLElement) status.hidden = true;
    if (this.replyValue().trim() || this.guidance.trim()) this.park();
    this.emit("worktual-desk-dismiss", this.replyValue());
    if (!focusNote) return;
    const note = document.querySelector("textarea[name='body']");
    if (note instanceof HTMLTextAreaElement) note.focus();
  }

  private async keep(): Promise<boolean> {
    const reply = this.replyValue();
    const guidance = this.guidance.trim();
    if (!reply && !guidance) return true;
    const url = (this.getAttribute("keep-url") || "").trim();
    if (!url) {
      this.park();
      return true;
    }
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf: this.getAttribute("csrf") || "",
        guidance,
        reply,
      }),
    });
    if (!response.ok) {
      this.fault = "Could not keep this suggestion on the ticket.";
      this.paint();
      return false;
    }
    return true;
  }

  private park(): void {
    const slot = document.querySelector("[data-suggestion-slot]");
    if (!(slot instanceof HTMLElement)) return;
    slot.hidden = false;
    const guidance = slot.querySelector("[data-suggestion-guidance]");
    const reply = slot.querySelector("[data-suggestion-reply]");
    if (guidance instanceof HTMLElement) {
      guidance.textContent = this.guidance;
      guidance.hidden = !this.guidance.trim();
    }
    if (reply instanceof HTMLElement) reply.textContent = this.replyValue();
  }

  private emit(name: string, reply: string): void {
    const detail: DeskAssistDetail = {
      ticket: this.getAttribute("ticket") || undefined,
      guidance: this.guidance,
      reply,
    };
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }
}

export function splitSuggestion(text: string): { guidance: string; reply: string } {
  const guidance = text.match(/GUIDANCE:\s*([\s\S]*?)(?:\n\s*REPLY:|$)/i);
  const reply = text.match(/REPLY:\s*([\s\S]*)$/i);
  if (!reply) return { guidance: "", reply: text.trim() };
  return {
    guidance: (guidance?.[1] || "").trim(),
    reply: reply[1].trim(),
  };
}

export async function askForReply(input: {
  recommendUrl: string;
  locale: string;
  issue: string;
}): Promise<{ guidance: string; reply: string }> {
  const response = await fetch(input.recommendUrl.trim(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      issue: input.issue,
      locale: input.locale,
    }),
  });
  let payload: Record<string, unknown> = {};
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(String(payload.error || payload.message || "Suggestion failed."));
  }
  const text = String(payload.text || "").trim();
  const parts = text ? splitSuggestion(text) : { guidance: "", reply: "" };
  const guidance = String(payload.guidance || parts.guidance || "").trim();
  const reply = String(payload.reply || parts.reply || "").trim();
  if (!guidance && !reply) throw new Error("The suggestion came back empty.");
  return { guidance, reply };
}

function hidden(name: string, value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = value;
  return input;
}

const TEMPLATE = `
<style>
  :host {
    position: fixed;
    z-index: 45;
    inset: 0;
    pointer-events: none;
    font-family: var(--wt-font, system-ui, sans-serif);
    color: #1d1a16;
  }
  .status, .dialog { pointer-events: auto; }
  .status {
    position: fixed;
    inset-inline-start: 20px;
    inset-block-end: 20px;
    margin: 0;
    padding: 10px 14px;
    border-radius: 999px;
    background: var(--wt-primary, #0f6e56);
    color: #fff;
    font-size: 14px;
  }
  .dialog {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px 16px;
    background: rgba(27, 36, 48, 0.35);
  }
  .dialog[hidden], .status[hidden], .guidance[hidden], .fault[hidden] { display: none; }
  .card {
    width: min(520px, 100%);
    max-height: min(640px, calc(100vh - 48px));
    overflow: auto;
    background: #fffdf8;
    border-radius: var(--wt-radius, 16px);
    box-shadow: 0 18px 50px rgba(27, 36, 48, 0.28);
    padding: 18px;
  }
  .kicker { margin: 0; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; color: #625c53; }
  h2 { margin: 4px 0 12px; font-size: 1.35rem; }
  .guidance, .fault {
    margin: 0 0 12px;
    padding: 10px 12px;
    border-radius: 10px;
    line-height: 1.45;
  }
  .guidance { background: #e7f4ee; color: #0d5a45; }
  .fault { background: #f8e8e8; color: #8d2b2b; }
  label { display: grid; gap: 6px; font-size: 14px; }
  textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 140px;
    border: 1px solid #e3dacb;
    border-radius: 10px;
    padding: 10px;
    font: inherit;
    resize: vertical;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  button {
    border: 0;
    border-radius: 999px;
    padding: 8px 14px;
    font: inherit;
    cursor: pointer;
  }
  .save { background: var(--wt-primary, #0f6e56); color: #fff; }
  .own, .dismiss { background: transparent; color: #1d1a16; text-decoration: underline; text-underline-offset: 0.15em; }
</style>
<p class="status" hidden></p>
<div class="dialog" role="dialog" aria-modal="true" hidden>
  <div class="card">
    <p class="kicker"></p>
    <h2>Suggested reply</h2>
    <p class="guidance" hidden></p>
    <p class="fault" role="alert" hidden></p>
    <label>
      Customer message
      <textarea class="reply" maxlength="4000"></textarea>
    </label>
    <div class="actions">
      <button class="save" type="button">Save on this ticket</button>
      <button class="own" type="button">Write my own</button>
      <button class="dismiss" type="button">Close</button>
    </div>
  </div>
</div>
`;
