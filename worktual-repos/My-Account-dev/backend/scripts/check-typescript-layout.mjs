import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ignoredDirectories = new Set([
  "coverage",
  "dist",
  "node_modules",
  "scripts",
]);

function collectJavaScriptFiles(directory, results = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavaScriptFiles(absolutePath, results);
    } else if (entry.name.endsWith(".js")) {
      results.push(path.relative(backendRoot, absolutePath));
    }
  }
  return results;
}

const applicationJavaScript = collectJavaScriptFiles(backendRoot);
const sourceFiles = fs
  .readdirSync(path.join(backendRoot, "src"), { recursive: true })
  .map(String);

if (applicationJavaScript.length > 0) {
  console.error("Application JavaScript remains outside backend/src:");
  for (const file of applicationJavaScript) console.error(`- ${file}`);
  process.exit(1);
}

if (!sourceFiles.some((file) => file.endsWith(".ts"))) {
  console.error("No TypeScript application sources found under backend/src.");
  process.exit(1);
}

console.log("Backend application layout is TypeScript-only under src/.");
