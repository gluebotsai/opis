import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("worktual-insights");
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  document.body.appendChild(el);
  return el;
}

describe("worktual-insights", () => {
  it("shows certified metric values and does not send sql", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        assistantText: "12 abiertos.",
        sessionMemoryPatch: {
          lastToolOutcome: {
            success: true,
            payload: { metrics: [{ label: "Abiertos", value: 12 }] },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const el = mount({
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      locale: "es",
      "theme-primary-color": "#112233",
    });
    expect(el.shadowRoot?.querySelector(".title")?.textContent).toBe("Indicadores");
    expect(el.style.getPropertyValue("--wt-primary")).toBe("#112233");
    const input = el.shadowRoot?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing question");
    input.value = "¿Cuántos tickets abiertos?";
    el.shadowRoot
      ?.querySelector("button[data-kind=metrics]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      const table = el.shadowRoot?.querySelector("table.metrics");
      expect(table?.querySelector("th")?.textContent).toBe("Abiertos");
      expect(table?.querySelector("td")?.textContent).toBe("12");
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      sdk_task: "analytics.ask",
      message: "¿Cuántos tickets abiertos?",
      locale: "es",
    });
    expect(body.sql).toBeUndefined();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.tasks.askMetrics"
    );
  });

  it("shows the unavailable state without the model's number", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          assistantText: "SLA fell by 40.",
          data: { code: "temporarily_unavailable" },
        })
      )
    );
    const el = mount({
      endpoint: "http://127.0.0.1:3001",
      token: "jwt",
      locale: "ar",
    });
    expect(el.getAttribute("dir")).toBe("rtl");
    const input = el.shadowRoot?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("missing question");
    input.value = "لماذا انخفض الاتفاق؟";
    el.shadowRoot?.querySelector("button[data-kind=why]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector(".body")?.textContent).toBe("هذه الإجابة غير متاحة مؤقتاً.");
    });
    expect(el.shadowRoot?.querySelector("table.metrics")?.hidden).toBe(true);
    expect(el.shadowRoot?.querySelector("table.rows")?.hidden).toBe(true);
    expect(el.shadowRoot?.textContent).not.toContain("40");
  });
});
