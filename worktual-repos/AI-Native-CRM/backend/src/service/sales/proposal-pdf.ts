/**
 * Render proposal HTML to PDF via Playwright, then stamp sample-style
 * letterhead (logo + company) + footer stripe onto every page with pdf-lib.
 */
import { existsSync } from "node:fs";
import { chromium, type Browser, type LaunchOptions } from "playwright";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
} from "pdf-lib";
import {
  parseProposalExportLayout,
  proposalPrintOverrideCss,
  ptToMm,
} from "@/lib/proposal-export-layout";

let browserPromise: Promise<Browser> | null = null;

const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

/** Cursor/sandbox often points PLAYWRIGHT_BROWSERS_PATH at an empty cache. */
function clearBrokenPlaywrightBrowsersPath(): void {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!envPath) return;
  try {
    const exe = chromium.executablePath();
    if (!existsSync(exe)) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    }
  } catch {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
}

function chromiumExecutablePath(): string | undefined {
  clearBrokenPlaywrightBrowsersPath();
  try {
    const exe = chromium.executablePath();
    if (existsSync(exe)) return exe;
  } catch {
    /* ignore */
  }
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    try {
      const exe = chromium.executablePath();
      if (existsSync(exe)) return exe;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

async function launchChromium(): Promise<Browser> {
  const executablePath = chromiumExecutablePath();
  const attempts: LaunchOptions[] = [];
  if (executablePath) {
    attempts.push({
      headless: true,
      args: CHROMIUM_ARGS,
      executablePath,
    });
  }
  attempts.push({ headless: true, args: CHROMIUM_ARGS });
  attempts.push({
    headless: true,
    args: CHROMIUM_ARGS,
    channel: "chrome",
  });

  let lastError: unknown;
  for (const options of attempts) {
    try {
      return await chromium.launch(options);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to launch Chromium for PDF.");
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchChromium().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

async function resetBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    /* ignore */
  }
}

export type ProposalPdfChrome = {
  vendorName: string;
  sellerAddress?: string | null;
  /** Raw image bytes for letterhead logo (optional). */
  logoBytes?: Uint8Array | null;
  logoMime?: string | null;
  /** Rainbow / brand footer stripe image from the uploaded sample template. */
  footerBytes?: Uint8Array | null;
  footerMime?: string | null;
};

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function embedImage(
  doc: PDFDocument,
  bytes: Uint8Array | null | undefined,
  mime: string | null | undefined,
): Promise<PDFImage | null> {
  if (!bytes?.length) return null;
  const m = (mime || "").toLowerCase();
  try {
    if (m.includes("png")) return await doc.embedPng(bytes);
    if (m.includes("jpeg") || m.includes("jpg")) return await doc.embedJpg(bytes);
    // Try PNG then JPEG when mime is missing/wrong.
    try {
      return await doc.embedPng(bytes);
    } catch {
      return await doc.embedJpg(bytes);
    }
  } catch {
    return null;
  }
}

/** Stamp sample-PDF letterhead + footer onto every page. */
export async function stampProposalPageChrome(
  pdfBuffer: Buffer,
  chrome: ProposalPdfChrome,
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const vendor = (chrome.vendorName || "Our company").trim() || "Our company";
  const address = (chrome.sellerAddress || "").trim();

  const logo = await embedImage(doc, chrome.logoBytes, chrome.logoMime);
  const footerImg = await embedImage(doc, chrome.footerBytes, chrome.footerMime);

  const stripeColors = [
    rgb(231 / 255, 55 / 255, 43 / 255),
    rgb(128 / 255, 103 / 255, 168 / 255),
    rgb(102 / 255, 53 / 255, 52 / 255),
    rgb(51 / 255, 127 / 255, 189 / 255),
    rgb(180 / 255, 208 / 255, 104 / 255),
  ];

  // Keep chrome inside Playwright margins so we never paint over cover titles
  // or body text (earlier white masks wiped "Submitted to …" on page 1).
  const logoMaxH = 32;
  const headerPadTop = 14;
  const footerStripeH = 6;
  const footerMetaSize = 8;
  const footerPadBottom = 16;

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]!;
    const { width, height } = page.getSize();
    const side = 40;
    const contentWidth = width - side * 2;

    // —— Header (every page): logo in the top margin only ——
    let cursorY = height - headerPadTop;
    if (logo) {
      const maxW = 150;
      const scale = Math.min(logoMaxH / logo.height, maxW / logo.width);
      const w = logo.width * scale;
      const h = logo.height * scale;
      page.drawImage(logo, {
        x: (width - w) / 2,
        y: height - headerPadTop - h,
        width: w,
        height: h,
      });
      cursorY = height - headerPadTop - h - 4;
      // Logo already includes the wordmark — don't redraw the vendor name.
    } else {
      const vendorSize = 11;
      const vendorW = bold.widthOfTextAtSize(vendor, vendorSize);
      page.drawText(vendor, {
        x: Math.max(side, (width - vendorW) / 2),
        y: cursorY - 12,
        size: vendorSize,
        font: bold,
        color: rgb(0, 0, 0),
      });
      cursorY -= 14;
    }

    if (address) {
      const lines = wrapText(address, regular, 6.5, contentWidth);
      for (const line of lines.slice(0, 2)) {
        const lw = regular.widthOfTextAtSize(line, 6.5);
        page.drawText(line, {
          x: Math.max(side, (width - lw) / 2),
          y: cursorY - 8,
          size: 6.5,
          font: regular,
          color: rgb(0.13, 0.13, 0.13),
        });
        cursorY -= 8;
      }
    }

    // —— Footer (every page): clear footer margin, then stripe + meta ——
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height: 36,
      color: rgb(1, 1, 1),
    });

    const stripeY = footerPadBottom + footerMetaSize + 6;
    if (footerImg) {
      const scale = Math.min(
        footerStripeH / Math.max(footerImg.height, 1),
        contentWidth / Math.max(footerImg.width, 1),
      );
      const w = Math.min(contentWidth, footerImg.width * scale);
      const h = Math.max(footerImg.height * scale, 4);
      page.drawImage(footerImg, {
        x: side + (contentWidth - w) / 2,
        y: stripeY,
        width: w,
        height: h,
      });
    } else {
      const segW = contentWidth / stripeColors.length;
      stripeColors.forEach((color, idx) => {
        page.drawRectangle({
          x: side + idx * segW,
          y: stripeY,
          width: segW + 0.5,
          height: footerStripeH,
          color,
        });
      });
    }

    const foot = `Prepared by ${vendor}  ·  ${i + 1} / ${pages.length}`;
    const fw = regular.widthOfTextAtSize(foot, footerMetaSize);
    page.drawText(foot, {
      x: Math.max(side, (width - fw) / 2),
      y: footerPadBottom,
      size: footerMetaSize,
      font: regular,
      color: rgb(0.2, 0.2, 0.2),
    });
  }

  return Buffer.from(await doc.save());
}

function assetToBytes(asset: {
  dataBase64?: string;
} | null | undefined): Uint8Array | null {
  if (!asset?.dataBase64) return null;
  try {
    return Uint8Array.from(Buffer.from(asset.dataBase64, "base64"));
  } catch {
    return null;
  }
}

/** Build chrome payload from blueprint assets (logo + footer stripe). */
export function chromeFromBlueprintAssets(
  assets: Array<{ id: string; mime: string; dataBase64: string }> | undefined,
  vendorName: string,
  sellerAddress?: string | null,
): ProposalPdfChrome {
  const list = assets ?? [];
  const logo = list.find((a) => a.id === "logo");
  const footer = list.find((a) => a.id === "footer");
  return {
    vendorName,
    sellerAddress: sellerAddress ?? null,
    logoBytes: assetToBytes(logo),
    logoMime: logo?.mime ?? null,
    footerBytes: assetToBytes(footer),
    footerMime: footer?.mime ?? null,
  };
}

export async function htmlToPdfBuffer(
  html: string,
  chrome?: ProposalPdfChrome | null,
  options?: { useBlueprintMargins?: boolean },
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        page.setDefaultTimeout(60_000);
        const bodyHtml = html
          .replace(/<\/(?:html|body)>/gi, "")
          .replace(/<script\b[\s\S]*?<\/script>/gi, "");
        const blueprintMargins = options?.useBlueprintMargins === true;
        const layout = blueprintMargins
          ? parseProposalExportLayout(html)
          : null;
        const printCss = blueprintMargins ? proposalPrintOverrideCss() : "";
        await page.setContent(
          `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  html, body { margin: 0; padding: 0; }
  ${printCss}
</style></head><body>${bodyHtml}</body></html>`,
          { waitUntil: "load", timeout: 60_000 },
        );
        // Frozen .proposal-doc already has page inset in CSS padding, but that
        // padding only wraps the whole article — page breaks then sit flush to
        // the paper edge. Move the same inset onto Playwright page margins.
        const top = blueprintMargins
          ? ptToMm(layout?.margins.top ?? 48)
          : chrome
            ? chrome.sellerAddress?.trim()
              ? "34mm"
              : "28mm"
            : "16mm";
        const bottom = blueprintMargins
          ? ptToMm(layout?.margins.bottom ?? 48)
          : chrome
            ? "24mm"
            : "16mm";
        const side = blueprintMargins
          ? ptToMm(
              Math.max(layout?.margins.left ?? 48, layout?.margins.right ?? 48),
            )
          : "14mm";
        const pdf = await page.pdf({
          format: "A4",
          printBackground: true,
          displayHeaderFooter: false,
          margin: {
            top,
            right: side,
            bottom,
            left: side,
          },
        });
        let buffer = Buffer.from(pdf);
        if (buffer.length < 100 || buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
          throw new Error("Playwright returned an invalid PDF buffer.");
        }
        // Always stamp when chrome is provided (logo + footer on every page).
        if (chrome) {
          buffer = await stampProposalPageChrome(buffer, chrome);
        }
        return buffer;
      } finally {
        await page.close().catch(() => undefined);
      }
    } catch (err) {
      lastError = err;
      await resetBrowser();
      const msg = err instanceof Error ? err.message : String(err);
      if (
        attempt === 0 &&
        /Executable doesn't exist|browser has been closed|Target closed/i.test(msg)
      ) {
        continue;
      }
      break;
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  if (/Executable doesn't exist/i.test(detail)) {
    throw new Error(
      "PDF engine is not installed on the API server. Run: npx playwright install chromium",
    );
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to generate PDF.");
}
