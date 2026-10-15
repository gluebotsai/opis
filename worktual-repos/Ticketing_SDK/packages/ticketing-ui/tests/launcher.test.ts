import { afterEach, describe, expect, it } from "vitest";
import "../src/index.js";
import { WorktualChatLauncherElement } from "../src/launcher-element.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(attrs: Record<string, string> = {}): WorktualChatLauncherElement {
  const el = document.createElement("worktual-chat-launcher") as WorktualChatLauncherElement;
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
  return el;
}

function buttonOf(el: WorktualChatLauncherElement): HTMLButtonElement {
  const button = el.shadowRoot?.querySelector(".launcher");
  if (!(button instanceof HTMLButtonElement)) throw new Error("missing launcher");
  return button;
}

describe("worktual-chat-launcher", () => {
  it("starts as a closed chat button", () => {
    const el = mount({ endpoint: "http://127.0.0.1:3001", token: "jwt", locale: "ar" });
    const button = buttonOf(el);
    expect(el.getAttribute("dir")).toBe("rtl");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("افتح المحادثة");
    expect(el.shadowRoot?.querySelector(".panel")?.hasAttribute("hidden")).toBe(true);
    expect(el.shadowRoot?.querySelector("worktual-chat")).toBeNull();
  });

  it("opens a worktual-chat pointed at the same endpoint and token", () => {
    const el = mount({
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      locale: "es",
      "theme-primary-color": "#0f6e56",
    });
    buttonOf(el).click();
    const chat = el.shadowRoot?.querySelector("worktual-chat");
    expect(el.shadowRoot?.querySelector(".panel")?.hasAttribute("hidden")).toBe(false);
    expect(buttonOf(el).getAttribute("aria-expanded")).toBe("true");
    expect(chat?.getAttribute("endpoint")).toBe("http://127.0.0.1:3001");
    expect(chat?.getAttribute("token")).toBe("jwt");
    expect(chat?.getAttribute("locale")).toBe("es");
    expect(chat?.getAttribute("theme-primary-color")).toBe("#0f6e56");
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Asistente de Worktual");
  });

  it("closes from the panel button and keeps the chat mounted", () => {
    const el = mount({ endpoint: "http://127.0.0.1:3001", token: "jwt" });
    buttonOf(el).click();
    const close = el.shadowRoot?.querySelector(".close");
    if (!(close instanceof HTMLButtonElement)) throw new Error("missing close");
    close.click();
    expect(el.shadowRoot?.querySelector(".panel")?.hasAttribute("hidden")).toBe(true);
    expect(buttonOf(el).getAttribute("aria-expanded")).toBe("false");
    expect(buttonOf(el).getAttribute("aria-label")).toBe("Open chat");
    expect(el.shadowRoot?.querySelector("worktual-chat")).toBeTruthy();
  });
});