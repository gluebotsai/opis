#!/usr/bin/env node
/**
 * File locator for CCaaS chat-service (webchat).
 *
 * Usage:
 *   node docs/chatservice/locator.js                  # list all modules
 *   node docs/chatservice/locator.js webchat_ws         # paths for one module
 *   node docs/chatservice/locator.js webchat_ws dummy_bot
 *   node docs/chatservice/locator.js --search websocket
 *   node docs/chatservice/locator.js --keys
 *
 * Paths are relative to the ai_contact_center_2 repo root.
 */

export const ROOT_HINT = "ai_contact_center_2";

/** @typedef {{ label: string, status?: string, knowledge?: string[], server?: string[], docs?: string[], notes?: string }} ModuleLocator */

/** @type {Record<string, ModuleLocator>} */
export const MODULES = {
  webchat_overview: {
    label: "Webchat — ownership & handoff",
    status: "done",
    knowledge: ["docs/chatservice/webchat_widget.md"],
    docs: ["docs/chatservice/README.md", "docs/chatservice/PLAN.md"],
    notes: "My Accounts owns widget UI + config; CCaaS owns realtime at /ws/webchat.",
  },
  webchat_api: {
    label: "Webchat — API reference",
    status: "done",
    docs: ["docs/chatservice/API.md", "docs/chatservice/api.openapi.json"],
    notes: "HTTP health + internal ingest + WebSocket frame contract.",
  },
  webchat_ws: {
    label: "Webchat WebSocket gateway",
    status: "done",
    server: ["apps/chat-service/src/websocket/webchat-ws-gateway.ts"],
    docs: ["docs/chatservice/API.md#websocket--get-wswebchat-upgrade"],
    notes: "Paths: /ws/webchat (primary), /ccaas/chat (legacy). JSON text frames.",
  },
  webchat_frames: {
    label: "Webchat frame schemas (Zod)",
    status: "done",
    server: ["apps/chat-service/src/types/webchat-frames.ts"],
    notes: "session.start, message (in); session.ready, system, message (out).",
  },
  webchat_session: {
    label: "In-memory webchat sessions",
    status: "done",
    server: ["apps/chat-service/src/services/webchat-session-store.ts"],
    notes: "Keyed by webchatId:visitorId. No DB persistence yet.",
  },
  dummy_bot: {
    label: "Dummy bot responder (v1 stub)",
    status: "done",
    server: ["apps/chat-service/src/services/dummy-bot.ts"],
    notes: "BotResponder interface; swap for NlpBotResponder later.",
  },
  accounts_config: {
    label: "Accounts public config client",
    status: "done",
    server: ["apps/chat-service/src/services/accounts-config-client.ts"],
    notes: "GET /api/v1/public/webchat/:webchatId/config when ACCOUNTS_PUBLIC_API_URL is set.",
  },
  chat_service_entry: {
    label: "chat-service HTTP entry",
    status: "done",
    server: [
      "apps/chat-service/src/index.ts",
      "apps/chat-service/package.json",
      "apps/chat-service/.env.example",
    ],
    notes: "Port 3002. Registers WS gateway after listen.",
  },
  chat_health: {
    label: "Health endpoints",
    status: "done",
    server: ["apps/chat-service/src/index.ts"],
    notes: "GET /health, GET /health/ready",
  },
  internal_messages: {
    label: "Internal message ingest",
    status: "done",
    server: ["apps/chat-service/src/index.ts"],
    knowledge: ["packages/event-contracts/src/index.ts"],
    notes: "POST /internal/messages — channel_type forced to webchat.",
  },
  golden_path: {
    label: "Golden path: Webchat → Agent",
    status: "planned",
    knowledge: ["docs/golden-path/webchat-to-agent.md"],
    notes: "Kafka + cc-core agent inbox — not implemented.",
  },
  web_widget_accounts: {
    label: "My Accounts widget (external)",
    status: "external",
    knowledge: ["docs/chatservice/webchat_widget.md"],
    notes: "worktual_widget.js, public config APIs — Accounts repo, not this monorepo.",
  },
};

/** Aliases → canonical module key */
export const ALIASES = {
  ws: "webchat_ws",
  websocket: "webchat_ws",
  socket: "webchat_ws",
  gateway: "webchat_ws",
  "/ws/webchat": "webchat_ws",
  "/ccaas/chat": "webchat_ws",
  frames: "webchat_frames",
  zod: "webchat_frames",
  session: "webchat_session",
  bot: "dummy_bot",
  stub: "dummy_bot",
  nlp: "dummy_bot",
  config: "accounts_config",
  greeting: "accounts_config",
  accounts: "accounts_config",
  api: "webchat_api",
  openapi: "webchat_api",
  health: "chat_health",
  ingest: "internal_messages",
  kafka: "golden_path",
  agent: "golden_path",
  widget: "web_widget_accounts",
  handoff: "webchat_overview",
  plan: "webchat_overview",
  readme: "webchat_overview",
};

export function resolveKey(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  if (MODULES[key]) return key;
  if (ALIASES[key]) return ALIASES[key];
  if (ALIASES[String(raw || "").trim().toLowerCase()]) {
    return ALIASES[String(raw || "").trim().toLowerCase()];
  }
  return null;
}

export function locate(moduleKey) {
  const key = resolveKey(moduleKey);
  if (!key) return null;
  return { key, ...MODULES[key] };
}

export function listModules() {
  return Object.entries(MODULES).map(([key, mod]) => ({
    key,
    label: mod.label,
    status: mod.status || "unknown",
  }));
}

export function searchModules(query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return listModules();
  return Object.entries(MODULES)
    .filter(([key, mod]) => {
      const hay = [
        key,
        mod.label,
        mod.notes,
        ...(mod.knowledge || []),
        ...(mod.server || []),
        ...(mod.docs || []),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return hay.includes(q);
    })
    .map(([key, mod]) => ({ key, label: mod.label, status: mod.status || "unknown" }));
}

function printModule(entry) {
  console.log(`\n[${entry.key}] ${entry.label}${entry.status ? `  (${entry.status})` : ""}`);
  const groups = [
    ["knowledge", entry.knowledge],
    ["server", entry.server],
    ["docs", entry.docs],
  ];
  for (const [name, paths] of groups) {
    if (!paths?.length) continue;
    console.log(`  ${name}:`);
    for (const path of paths) console.log(`    - ${path}`);
  }
  if (entry.notes) console.log(`  notes: ${entry.notes}`);
}

function printHelp() {
  console.log(`CCaaS chat-service file locator (root: ${ROOT_HINT})

Usage:
  node docs/chatservice/locator.js
  node docs/chatservice/locator.js <module> [module...]
  node docs/chatservice/locator.js --search <text>
  node docs/chatservice/locator.js --keys

Examples:
  node docs/chatservice/locator.js webchat_ws
  node docs/chatservice/locator.js dummy_bot accounts_config
  node docs/chatservice/locator.js --search websocket
`);
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args[0] === "--keys") {
    for (const row of listModules()) {
      console.log(`${row.key.padEnd(24)} ${row.status.padEnd(10)} ${row.label}`);
    }
    console.log("\nAliases:", Object.keys(ALIASES).sort().join(", "));
    return;
  }
  if (args[0] === "--search") {
    const query = args.slice(1).join(" ");
    const hits = searchModules(query);
    if (!hits.length) {
      console.log(`No modules matched "${query}".`);
      return;
    }
    for (const hit of hits) printModule(locate(hit.key));
    return;
  }
  if (!args.length) {
    console.log(`Modules (repo root: ${ROOT_HINT})\n`);
    for (const row of listModules()) {
      console.log(`  ${row.key.padEnd(24)} ${row.status.padEnd(10)} ${row.label}`);
    }
    console.log("\nRun with a module key, or --help.");
    return;
  }

  let found = 0;
  for (const arg of args) {
    const entry = locate(arg);
    if (!entry) {
      console.error(`Unknown module: "${arg}". Try --keys or --search.`);
      continue;
    }
    found += 1;
    printModule(entry);
  }
  if (!found) process.exitCode = 1;
}

const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  /locator\.js$/.test(process.argv[1].replace(/\\/g, "/"));

if (isDirectRun) {
  main(process.argv);
}
