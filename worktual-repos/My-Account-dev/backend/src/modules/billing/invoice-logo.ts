import fs from "node:fs";
import path from "node:path";

import { assetsRoot } from "../../config/runtime-paths.js";

const LOGO_CANDIDATES = [
  path.join(assetsRoot, "worktual-logo.png"),
  path.join(assetsRoot, "worktual-ui-logo.png"),
];

function readPngSize(buffer: any) {
  if (!buffer || buffer.length < 24) {
    return { width: 0, height: 0 };
  }
  // PNG IHDR: width/height are big-endian uint32 at offsets 16 and 20.
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

/** Node-safe Worktual logo for invoice PDFs (no browser canvas/fetch). */
export function loadInvoiceLogoFromFile() {
  for (const logoPath of LOGO_CANDIDATES) {
    try {
      if (!fs.existsSync(logoPath)) {
        continue;
      }
      const buffer = fs.readFileSync(logoPath);
      const { width, height } = readPngSize(buffer);
      if (!width || !height) {
        continue;
      }
      return {
        dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
        width,
        height,
      };
    } catch {
      // try next candidate
    }
  }
  return null;
}
