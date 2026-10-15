import { execSync } from "node:child_process";

const ports = [5173, 5174, 3001, 3002];

for (const port of ports) {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" }).trim();
    if (!output) {
      continue;
    }

    for (const pid of output.split("\n").filter(Boolean)) {
      console.log(`Stopping process ${pid} on port ${port}`);
      process.kill(Number(pid), "SIGTERM");
    }
  } catch {
    // No process on this port.
  }
}

console.log("Dev ports cleared (5173, 5174, 3001, 3002).");
