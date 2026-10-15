import os from "node:os";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import dotenv from "dotenv";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(projectRoot, ".env"), override: true });

const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const apiPort = Number(process.env.MAIL_API_PORT || 3002);
process.env.MAIL_API_PORT = String(apiPort);
process.env.VITE_API_PROXY = process.env.VITE_API_PROXY || `http://127.0.0.1:${apiPort}`;

const children = [];

function clearPort(port) {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" }).trim();
    if (!output) {
      return;
    }

    for (const pid of output.split("\n").filter(Boolean)) {
      console.log(`[dev] Stopping stale process ${pid} on port ${port}`);
      process.kill(Number(pid), "SIGTERM");
    }
  } catch {
    // No process on this port.
  }
}

function getLanAddresses() {
  const addresses = [];

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const net of interfaces || []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  return [...new Set(addresses)];
}

function start(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    cwd: projectRoot,
    env: { ...process.env, ...extraEnv },
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

async function waitForApiReady(port, { timeoutMs = 120_000, intervalMs = 200 } = {}) {
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // API still starting (migrations, port bind, etc.).
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Mail API did not become ready on port ${port} within ${timeoutMs / 1000}s`);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  console.log(`Starting mail API on http://localhost:${apiPort}`);

  const lanAddresses = getLanAddresses();
  if (lanAddresses.length) {
    console.log("Access from other devices on your network (after Vite starts):");
    for (const address of lanAddresses) {
      console.log(`  http://${address}:5173`);
    }
  } else {
    console.log("No LAN address detected. Use your machine IP with port 5173.");
  }

  clearPort(3001); // legacy mail API port — kill stale processes
  clearPort(apiPort);
  start(
    "mail",
    process.execPath,
    ["--watch", path.join(projectRoot, "server", "index.js")],
    { MAIL_API_PORT: String(apiPort), VITE_API_PROXY: process.env.VITE_API_PROXY },
  );

  console.log("[dev] Waiting for mail API (database migrations may take a moment)...");
  await waitForApiReady(apiPort);
  console.log("[dev] Mail API is ready.");

  console.log("Starting Vite dev server on http://localhost:5173");
  start("vite", process.execPath, [viteBin, "--host", "0.0.0.0"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
