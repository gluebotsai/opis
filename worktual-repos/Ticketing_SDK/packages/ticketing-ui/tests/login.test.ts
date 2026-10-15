import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
  return el;
}

describe("worktual-login", () => {
  it("uses French chrome", () => {
    const el = mount("worktual-login", { endpoint: "http://127.0.0.1:3001", locale: "fr" });
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Connexion du personnel");
    expect(el.shadowRoot?.querySelector("button.submit")?.textContent).toBe("Se connecter");
  });

  it("signs staff in and returns the session token", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ token: "staff.jwt", user: { email: "jane@worktual.com" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = mount("worktual-login", {
      endpoint: "http://127.0.0.1:3001",
      locale: "es",
      "theme-primary-color": "#112233",
    });
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Acceso del equipo");
    expect(el.style.getPropertyValue("--wt-primary")).toBe("#112233");
    const email = el.shadowRoot?.querySelector(".email");
    const password = el.shadowRoot?.querySelector(".password");
    if (email instanceof HTMLInputElement) email.value = "jane@worktual.com";
    if (password instanceof HTMLInputElement) password.value = "secret";
    const seen: Array<{ feature: string; sessionToken?: string }> = [];
    el.addEventListener("worktual-action", ((event: CustomEvent) => {
      seen.push(event.detail);
    }) as EventListener);
    el.shadowRoot?.querySelector("button.submit")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(seen[0]?.sessionToken).toBe("staff.jwt");
    });
    expect(seen[0]?.feature).toBe("auth.login");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Api-Key")).toBeNull();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/auth/login");
  });

  it("requests a portal code and verifies it in Arabic", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/otp/verify")) {
        return Response.json({ token: "portal.jwt", customer: { id: "c1" } });
      }
      return Response.json({ ok: true, channel: "email", masked: "a***@b.com" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const el = mount("worktual-login", {
      endpoint: "http://127.0.0.1:3001",
      mode: "portal",
      slug: "acme",
      locale: "ar",
    });
    expect(el.getAttribute("dir")).toBe("rtl");
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("بوابة الدعم");
    const email = el.shadowRoot?.querySelector(".email");
    if (email instanceof HTMLInputElement) email.value = "a@b.com";
    el.shadowRoot?.querySelector("button.submit")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".note")?.textContent).toContain("a***@b.com");
    });
    const code = el.shadowRoot?.querySelector(".code");
    if (code instanceof HTMLInputElement) code.value = "123456";
    const seen: string[] = [];
    el.addEventListener("worktual-action", ((event: CustomEvent) => {
      if (event.detail.sessionToken) seen.push(event.detail.sessionToken);
    }) as EventListener);
    el.shadowRoot?.querySelector("button.submit")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(seen).toEqual(["portal.jwt"]);
    });
  });
});
