export type NoteRecommendDetail = {
  ticket?: string;
  guidance: string;
  reply: string;
};

const TEMPLATE = `
  <style>
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.4rem;
      max-width: calc(100% - 1.2rem);
      font-family: var(--wt-font, Segoe UI, system-ui, sans-serif);
    }
    button {
      border: 0;
      border-radius: 999px;
      background: var(--wt-primary, #0f6e56);
      color: #fff;
      font: inherit;
      font-size: 0.82rem;
      line-height: 1.2;
      padding: 0.32rem 0.75rem;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(28, 25, 23, 0.16);
    }
    button:disabled { opacity: 0.72; cursor: progress; }
    .fault {
      margin: 0;
      max-width: 16rem;
      padding: 0.2rem 0.45rem;
      border-radius: 8px;
      background: #fff;
      color: #8d2b2b;
      font-size: 0.75rem;
      line-height: 1.3;
    }
    .fault[hidden] { display: none; }
  </style>
  <p class="fault" role="alert" hidden></p>
  <button type="button">Suggest</button>
`;

export class WorktualNoteRecommendElement extends HTMLElement {
  private ready = false;
  private busy = false;

  connectedCallback(): void {
    if (this.ready) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = TEMPLATE;
    root.querySelector("button")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.suggest();
    });
    this.ready = true;
    this.applyTheme();
  }

  private applyTheme(): void {
    const color = this.getAttribute("theme-primary-color")?.trim();
    const font = this.getAttribute("theme-font")?.trim();
    if (color) this.style.setProperty("--wt-primary", color);
    if (font) this.style.setProperty("--wt-font", font);
  }

  private noteBox(): HTMLTextAreaElement | null {
    const name = (this.getAttribute("target") || "body").trim() || "body";
    const scope = this.closest("form") || this.parentElement || document;
    const box = scope.querySelector(`textarea[name="${CSS.escape(name)}"]`);
    return box instanceof HTMLTextAreaElement ? box : null;
  }

  private async suggest(): Promise<void> {
    if (this.busy) return;
    const recommendUrl = (this.getAttribute("recommend-url") || "").trim();
    const issue = (this.getAttribute("issue") || "").trim();
    const button = this.shadowRoot?.querySelector("button");
    const fault = this.shadowRoot?.querySelector(".fault");
    if (!(button instanceof HTMLButtonElement) || !(fault instanceof HTMLElement)) return;
    if (!recommendUrl || !issue) {
      fault.hidden = false;
      fault.textContent = "The recommendation service is not configured.";
      return;
    }
    this.busy = true;
    button.disabled = true;
    button.textContent = "Suggesting…";
    fault.hidden = true;
    fault.textContent = "";
    try {
      const result = await askForReply({
        recommendUrl,
        ragUrl: (this.getAttribute("rag-url") || "").trim(),
        locale: (this.getAttribute("locale") || "en").trim() || "en",
        issue,
      });
      const text = result.reply || result.guidance;
      const box = this.noteBox();
      if (box) {
        box.value = text;
        box.focus();
      }
      this.dispatchEvent(new CustomEvent("worktual-note-recommend", {
        bubbles: true,
        composed: true,
        detail: {
          ticket: this.getAttribute("ticket") || undefined,
          guidance: result.guidance,
          reply: result.reply,
        } satisfies NoteRecommendDetail,
      }));
    } catch (error) {
      fault.hidden = false;
      fault.textContent = error instanceof Error ? error.message : "Suggestion failed.";
    } finally {
      this.busy = false;
      button.disabled = false;
      button.textContent = "Suggest";
    }
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
  ragUrl?: string;
  locale: string;
  issue: string;
}): Promise<{ guidance: string; reply: string }> {
  const ragUrl = String(input.ragUrl || "").trim();
  let knowledge = "";
  if (ragUrl) {
    const known = await searchKnowledge(ragUrl, input.issue);
    if (known) knowledge = known.reply;
  }
  const response = await fetch(input.recommendUrl.trim(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      issue: input.issue,
      locale: input.locale,
      grounded: Boolean(knowledge),
      knowledge,
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

async function searchKnowledge(ragUrl: string, issue: string): Promise<{ guidance: string; reply: string } | null> {
  try {
    const response = await fetch(ragUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ issue }),
    });
    const parsed = await response.json().catch(() => null);
    const payload = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    if (!response.ok || payload.found !== true) return null;
    const reply = String(payload.reply || "").trim();
    if (!reply) return null;
    return {
      guidance: String(payload.guidance || "This came from a saved solution.").trim(),
      reply,
    };
  } catch {
    return null;
  }
}
