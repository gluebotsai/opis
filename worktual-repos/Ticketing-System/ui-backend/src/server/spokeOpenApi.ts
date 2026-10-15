import type { Express, Request, Response } from "express";

const OPENAPI = {
  openapi: "3.0.3",
  info: {
    title: "Worktual Ticketing API",
    version: "1.0.0",
    description:
      "Frozen spoke contract for staff console, support portal, intake, and co-worker agents.",
  },
  servers: [{ url: "/api", description: "Ticketing API (prefixed routes)" }],
  tags: [
    { name: "auth", description: "Staff session and identity" },
    { name: "tickets", description: "Ticket CRUD and notes" },
    { name: "queues", description: "Teams and queues" },
    { name: "customers", description: "Customer directory" },
    { name: "kb", description: "Knowledge base" },
    { name: "macros", description: "Macro library" },
    { name: "intake", description: "Multi-channel ticket intake" },
    { name: "portal", description: "Customer support portal" },
    { name: "coworker", description: "LangGraph co-worker proxy" },
    { name: "proactive", description: "Proactive agent approvals" },
    { name: "integration", description: "Org API keys and widgets" },
    { name: "internal", description: "Service-actor agent data (not for hosts)" },
  ],
  paths: {
    "/auth/login": {
      post: { tags: ["auth"], summary: "Staff login (MyAccount password)" },
    },
    "/auth/me": {
      get: { tags: ["auth"], summary: "Current staff user + modules" },
    },
    "/auth/logout": {
      post: { tags: ["auth"], summary: "Clear staff session cookie" },
    },
    "/tickets": {
      get: { tags: ["tickets"], summary: "List tickets (scoped by role)" },
      post: { tags: ["tickets"], summary: "Create ticket" },
    },
    "/tickets/{id}": {
      get: { tags: ["tickets"], summary: "Ticket detail" },
      put: { tags: ["tickets"], summary: "Update ticket" },
    },
    "/intake/tickets": {
      post: {
        tags: ["intake"],
        summary: "Create ticket via org API key or internal service key",
      },
    },
    "/coworker/agent-turn": {
      post: {
        tags: ["coworker"],
        summary: "Staff co-worker turn (CRM envelope)",
      },
    },
    "/coworker/conversation-context": {
      get: {
        tags: ["coworker"],
        summary: "Load durable conversation context (service actor)",
      },
      put: {
        tags: ["coworker"],
        summary: "Save durable conversation context (service actor)",
      },
    },
    "/coworker/triage-data": {
      get: { tags: ["internal"], summary: "Triage roster/workload bundle (tasks key + org)" },
    },
    "/coworker/workflow-events": {
      post: { tags: ["coworker"], summary: "Persist workflow transition events (service actor)" },
    },
    "/proactive/approvals": {
      get: { tags: ["proactive"], summary: "List proactive approvals" },
    },
    "/internal/proactive/recommendations": {
      post: { tags: ["internal"], summary: "Insert proactive recommendation (agents)" },
    },
    "/metrics": {
      get: { tags: ["tickets"], summary: "Dashboard metrics" },
    },
    "/portal/tickets": {
      get: { tags: ["portal"], summary: "Customer portal ticket list" },
    },
  },
} as const;

const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Ticketing API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api/openapi.json",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis],
    });
  </script>
</body>
</html>`;

export function registerSpokeDocsRoutes(app: Express): void {
  app.get("/api/openapi.json", (_req: Request, res: Response) => {
    res.json(OPENAPI);
  });

  app.get("/docs", (_req: Request, res: Response) => {
    res.type("html").send(DOCS_HTML);
  });
};
