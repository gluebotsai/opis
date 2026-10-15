import { createLogger } from "@ai-contact-center/observability";

import type { ReportPeriod, ReportWindow, ScheduledReportRecord } from "./scheduled-reports.js";

const snapshotLogger = createLogger({ service: "cc-core-dashboard-snapshot" });

function scheduledPeriodToRangeLabel(period: ReportPeriod): "7d" | "30d" | "custom" {
  if (period === "7d") return "7d";
  if (period === "30d") return "30d";
  return "custom";
}

function formatYmd(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function captureDashboardReportPngForSchedule(
  schedule: Pick<ScheduledReportRecord, "period" | "timeZone">,
  reportWindow: ReportWindow,
): Promise<Buffer | null> {
  const baseUrl = process.env.REPORT_DASHBOARD_CAPTURE_URL?.trim();
  const email = process.env.REPORT_DASHBOARD_CAPTURE_EMAIL?.trim();
  const password = process.env.REPORT_DASHBOARD_CAPTURE_PASSWORD?.trim();
  if (!baseUrl || !email || !password) {
    return null;
  }

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 3,
      });
      await page.goto(`${baseUrl.replace(/\/$/, "")}/login`, { waitUntil: "domcontentloaded" });
      await page.fill("#email", email);
      await page.fill("#password", password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });

      await page.goto(`${baseUrl.replace(/\/$/, "")}/admin/dashboard`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForSelector('[data-performance-export-root="true"]', { timeout: 20_000 });
      await page.waitForSelector(
        '[data-performance-export-root="true"] [data-export-body]',
        { state: "visible", timeout: 20_000 },
      );

      const rangeLabel = scheduledPeriodToRangeLabel(schedule.period);
      if (rangeLabel === "custom") {
        const start = formatYmd(reportWindow.start, schedule.timeZone);
        const end = formatYmd(reportWindow.end, schedule.timeZone);
        await page.evaluate(
          `window.dispatchEvent(new CustomEvent("worktual:dashboard-set-selection", { detail: { mode: "custom", start: ${JSON.stringify(start)}, end: ${JSON.stringify(end)} } }))`,
        );
      } else {
        await page.getByRole("button", { name: rangeLabel === "7d" ? "7D" : "30D" }).click();
      }

      await page.waitForTimeout(1500);
      await page.locator('[data-performance-export-root="true"]').waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.evaluate(`
        (() => {
          const root = document.querySelector('[data-performance-export-root="true"]');
          root?.classList.add("performance-export-capture");
          if (root instanceof HTMLElement) {
            root.style.width = "1100px";
            root.style.minWidth = "1100px";
            root.style.borderRadius = "0";
            root.style.overflow = "visible";
            root.style.overflowX = "visible";
            root.style.overflowY = "visible";
            root.style.maxHeight = "none";
            root.style.minHeight = "auto";
            root.style.height = "auto";
            root.style.flex = "none";
          }
          for (const element of root?.querySelectorAll('[data-export-ignore="true"]') ?? []) {
            if (element instanceof HTMLElement) element.style.display = "none";
          }
          for (const element of root?.querySelectorAll("*") ?? []) {
            if (!(element instanceof HTMLElement)) continue;
            const style = window.getComputedStyle(element);
            if (
              style.overflow === "hidden" ||
              style.overflow === "auto" ||
              style.overflow === "scroll" ||
              style.overflowY === "hidden" ||
              style.overflowY === "auto" ||
              style.overflowY === "scroll" ||
              style.maxHeight !== "none" ||
              element.classList.contains("min-h-0") ||
              element.classList.contains("panel-scroll-native") ||
              element.classList.contains("overflow-hidden")
            ) {
              element.style.overflow = "visible";
              element.style.overflowY = "visible";
              element.style.overflowX = "visible";
              element.style.maxHeight = "none";
              element.style.minHeight = "auto";
              element.style.height = "auto";
              element.style.flex = "none";
            }
          }
          root?.scrollIntoView({ block: "start" });
        })()
      `);
      await page.waitForTimeout(800);

      const exportRoot = page.locator('[data-performance-export-root="true"]');
      const png = await exportRoot.screenshot({ type: "png", animations: "disabled" });
      return Buffer.from(png);
    } finally {
      await browser.close();
    }
  } catch (error) {
    snapshotLogger.warn({ err: error }, "dashboard report snapshot capture failed");
    return null;
  }
}
