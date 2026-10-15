#!/usr/bin/env node
/**
 * Copy live product icons into the UI skill references folder.
 *
 *   npm run sync:ui-icons -w web
 */

import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEB_ROOT = path.resolve(REPO_ROOT, "apps/web");
const OUT_ROOT = path.join(SKILL_ROOT, "references", "icons");

const CHANNEL_SRC = path.join(WEB_ROOT, "src/assets/channels");
const BRAND_SRC = path.join(WEB_ROOT, "public/brand");

const LUCIDE_ICONS = [
  "search",
  "x",
  "check",
  "check-circle-2",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "info",
  "expand",
  "shrink",
  "panel-left-close",
  "arrow-up",
  "arrow-up-right",
  "arrow-down-right",
  "messages-square",
  "clock-3",
  "gauge",
  "target",
  "trending-up",
  "file-bar-chart-2",
  "line-chart",
  "bell",
  "users",
  "message-square",
  "monitor-dot",
  "plus",
  "pencil",
  "trash-2",
  "download",
  "calendar-range",
  "loader-circle",
  "alert-triangle",
  "circle-alert",
  "phone",
  "mail",
  "map-pin",
  "building-2",
  "globe-2",
  "sparkles",
  "phone-missed",
];

const HEADSET_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M4.2 11.1V9.8a7.8 7.8 0 0 1 15.6 0v1.3" stroke="#171717" stroke-width="1.7" stroke-linecap="round"/>
  <path d="M4.6 9.8H4a2 2 0 0 0-2 2v3.4a2 2 0 0 0 2 2h.6V9.8Zm14.8 0h.6a2 2 0 0 1 2 2v3.4a2 2 0 0 1-2 2h-.6V9.8Z" fill="#171717"/>
  <path d="M19.8 16.6v.7a2.6 2.6 0 0 1-2.6 2.6h-2" stroke="#171717" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="14.4" cy="19.9" r="1.15" fill="#171717"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M7.1 9.4A2.4 2.4 0 0 1 9.5 7h5a2.4 2.4 0 0 1 2.4 2.4v3.4a2.4 2.4 0 0 1-2.4 2.4h-.2l1.1 2.1-3.4-2.1H9.5a2.4 2.4 0 0 1-2.4-2.4V9.4Zm2.6 1.7a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Zm2.3 0a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Zm2.3 0a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z" fill="#171717"/>
</svg>
`;

function lucideIconDirs() {
  return [
    path.join(WEB_ROOT, "node_modules/lucide-react/dist/esm/icons"),
    path.join(REPO_ROOT, "node_modules/lucide-react/dist/esm/icons"),
  ].filter((dir) => existsSync(dir));
}

function attrsToString(attrs) {
  return Object.entries(attrs)
    .filter(([key]) => key !== "key")
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, "&quot;")}"`)
    .join(" ");
}

function iconNodeToSvg(nodes) {
  const body = nodes
    .map(([tag, attrs]) => {
      if (tag === "svg") return "";
      return `  <${tag} ${attrsToString(attrs)} />`;
    })
    .filter(Boolean)
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#171717" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
${body}
</svg>
`;
}

function parseCreateLucideIcon(source) {
  const fromConst = source.match(/const __iconNode = (\[[\s\S]*?\]);/);
  const fromCall = source.match(/createLucideIcon\([^,]+,\s*(\[[\s\S]*\])\s*\)/);
  const raw = fromConst?.[1] ?? fromCall?.[1];
  if (!raw) return null;
  try {
    return eval(raw);
  } catch {
    return null;
  }
}

async function copyChannels() {
  const dest = path.join(OUT_ROOT, "channels");
  await mkdir(dest, { recursive: true });
  const files = await readdir(CHANNEL_SRC);
  for (const file of files) {
    if (!file.endsWith(".svg") && !file.endsWith(".png")) continue;
    await copyFile(path.join(CHANNEL_SRC, file), path.join(dest, file));
  }
  console.log(`  ✓ channels (${files.length} files)`);
}

async function copyBrand() {
  const dest = path.join(OUT_ROOT, "brand");
  await mkdir(dest, { recursive: true });
  if (!existsSync(BRAND_SRC)) {
    console.log("  · brand skipped (public/brand missing)");
    return;
  }
  const files = await readdir(BRAND_SRC);
  let copied = 0;
  for (const file of files) {
    if (!/\.(png|svg|webp)$/i.test(file)) continue;
    await copyFile(path.join(BRAND_SRC, file), path.join(dest, file));
    copied += 1;
  }
  console.log(copied ? `  ✓ brand (${copied} files)` : "  · brand skipped (no images)");
}

async function writeHeadset() {
  const dest = path.join(OUT_ROOT, "custom");
  await mkdir(dest, { recursive: true });
  await writeFile(path.join(dest, "workspace-headset.svg"), HEADSET_SVG);
  console.log("  ✓ custom/workspace-headset.svg");
}

async function resolveLucideSource(dir, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const file = path.join(dir, `${name}.js`);
  if (!existsSync(file)) return null;
  const source = await readFile(file, "utf8");
  const reexport = source.match(/export \{ default \} from '\.\/([^']+)\.js'/);
  if (reexport) return resolveLucideSource(dir, reexport[1], seen);
  return source;
}

async function extractLucide() {
  const dest = path.join(OUT_ROOT, "lucide");
  await mkdir(dest, { recursive: true });
  const dirs = lucideIconDirs();
  if (dirs.length === 0) {
    console.warn("  ⚠ lucide-react icons not found in node_modules");
    return;
  }
  const dir = dirs[0];
  let copied = 0;
  for (const name of LUCIDE_ICONS) {
    const source = await resolveLucideSource(dir, name);
    if (!source) {
      console.warn(`  · missing lucide ${name}`);
      continue;
    }
    const nodes = parseCreateLucideIcon(source);
    if (!nodes) {
      console.warn(`  · parse failed ${name}`);
      continue;
    }
    await writeFile(path.join(dest, `${name}.svg`), iconNodeToSvg(nodes));
    copied += 1;
  }
  console.log(`  ✓ lucide (${copied}/${LUCIDE_ICONS.length})`);
}

async function writeIndex() {
  const index = `# Icon files

Synced from \`apps/web\`. Re-run:

\`\`\`bash
npm run sync:ui-icons -w web
\`\`\`

- \`channels/\` — omnichannel brand tiles (16×16 artwork)
- \`lucide/\` — chrome icons at 24×24, stroke #171717 / 2.25
- \`custom/workspace-headset.svg\` — sidebar workspace mark
- \`brand/\` — Worktual wordmark / icon when present in \`public/brand\`
`;
  await writeFile(path.join(OUT_ROOT, "README.md"), index);
}

async function main() {
  console.log(`Syncing icons → ${OUT_ROOT}`);
  await mkdir(OUT_ROOT, { recursive: true });
  await copyChannels();
  await copyBrand();
  await writeHeadset();
  await extractLucide();
  await writeIndex();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
