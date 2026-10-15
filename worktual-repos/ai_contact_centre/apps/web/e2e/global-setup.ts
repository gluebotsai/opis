export default async function globalSetup() {
  const checks = [
    ["cc-core", process.env.CC_CORE_URL ?? "http://localhost:3000"],
    ["chat-service", process.env.CHAT_SERVICE_URL ?? "http://localhost:3002"],
    ["nlp", process.env.NLP_URL ?? "http://localhost:8000"],
    ["web", process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173"],
  ] as const;

  for (const [name, baseUrl] of checks) {
    try {
      const healthPath = name === "web" ? "" : "/health";
      const response = await fetch(`${baseUrl}${healthPath}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        console.warn(`E2E setup warning: ${name} unhealthy (${response.status})`);
      }
    } catch (error) {
      console.warn(
        `E2E setup warning: ${name} unreachable (${error instanceof Error ? error.message : error})`,
      );
    }
  }
}
