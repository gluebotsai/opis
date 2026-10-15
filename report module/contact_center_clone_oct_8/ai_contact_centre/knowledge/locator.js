#!/usr/bin/env node
/**
 * File locator for My Account (Setup + related domains).
 *
 * Usage:
 *   node knowledge/locator.js                  # list all modules
 *   node knowledge/locator.js webchat          # paths for one module
 *   node knowledge/locator.js email queues     # multiple modules
 *   node knowledge/locator.js --search primary # fuzzy search keys/labels/paths
 *
 * Paths are relative to the MY_ACCOUNTS package root.
 */

export const ROOT_HINT = "WORKTUAL-REBUILD/myaccount_overall_portol/MY_ACCOUNTS";

/** @typedef {{ label: string, status?: string, knowledge?: string[], ui?: string[], client?: string[], server?: string[], repo?: string[], schema?: string[], notes?: string }} ModuleLocator */

/** @type {Record<string, ModuleLocator>} */
export const MODULES = {
  auth_customer: {
    label: "Customer auth (portal login)",
    status: "done",
    knowledge: ["knowledge/customer/auth-and-session.md"],
    client: ["src/lib/customerAuth.js"],
    server: ["server/customerAuth.js"],
    repo: ["server/repositories/raw/customerAuth.repo.js"],
    schema: ["database/schema.sql  → customer_users, customer_auth_sessions"],
  },
  auth_staff: {
    label: "Staff / admin auth",
    status: "done",
    knowledge: ["knowledge/internal/auth-admin.md"],
    client: ["src/lib/auth.js"],
    server: ["server/auth.js", "server/users.js"],
    schema: ["database/schema.sql  → users, auth_sessions"],
  },
  setup_overview: {
    label: "Setup workspace overview",
    status: "done",
    knowledge: ["knowledge/setup/README.md", "knowledge/CONVENTIONS.md"],
    ui: [
      "src/layouts/CustomerPortalShell.jsx",
      "src/pages/customer/setup/SetupWorkspaceLayout.jsx",
      "src/components/customer/setup/SetupPageChrome.jsx",
    ],
    client: ["src/lib/setup/setupApi.js", "src/lib/productCatalog.js"],
  },
  business_profile: {
    label: "Organization → Business Profile",
    status: "done",
    knowledge: ["knowledge/setup/organization.md"],
    ui: ["src/pages/customer/setup/SetupBusinessProfilePage.jsx"],
    client: ["src/lib/setup/setupApi.js"],
    server: ["server/setupOrganization.js"],
    repo: ["server/repositories/raw/setupOrganization.repo.js"],
  },
  branches: {
    label: "Organization → Branches",
    status: "done",
    knowledge: ["knowledge/setup/organization.md"],
    ui: ["src/pages/customer/setup/SetupBranchesPage.jsx"],
    client: ["src/lib/setup/setupApi.js"],
    server: ["server/setupOrganization.js"],
    repo: ["server/repositories/raw/setupOrganization.repo.js"],
    schema: ["database/schema.sql  → organization_locations"],
  },
  business_hours: {
    label: "Organization → Business Hours + Holidays",
    status: "done",
    knowledge: ["knowledge/setup/organization.md"],
    ui: ["src/pages/customer/setup/SetupBusinessHoursPage.jsx"],
    client: ["src/lib/setup/setupApi.js", "src/lib/setup/countryHolidays.js"],
    server: ["server/setupOrganization.js"],
    repo: ["server/repositories/raw/setupOrganization.repo.js"],
    schema: [
      "database/schema.sql  → setup_business_hours, setup_business_hour_shifts",
      "database/schema.sql  → setup_holiday_calendars, setup_holidays",
    ],
  },
  teams: {
    label: "Organization → Teams",
    status: "done",
    knowledge: ["knowledge/setup/organization.md"],
    ui: [
      "src/pages/customer/setup/SetupTeamsPage.jsx",
      "src/pages/customer/setup/SetupTeamDetailPage.jsx",
    ],
    client: ["src/lib/setup/setupApi.js"],
    server: ["server/setupOrganization.js"],
    repo: ["server/repositories/raw/setupOrganization.repo.js"],
    schema: ["database/schema.sql  → setup_teams"],
  },
  roles: {
    label: "User onboard → Roles & permissions",
    status: "done",
    knowledge: ["knowledge/setup/organization.md"],
    ui: ["src/pages/customer/setup/SetupRolesPage.jsx"],
    client: [
      "src/lib/setup/setupApi.js",
      "src/lib/setup/crmModules.js",
      "src/lib/setup/crmDefaultRoles.js",
      "src/lib/setup/ccaasDefaultRoles.js",
      "src/lib/setup/defaultRoles.js",
    ],
    server: [
      "server/setupOrganization.js",
      "server/ensureCrmDefaultRoles.js",
      "server/ensureCcaasDefaultRoles.js",
      "server/ensureProductDefaultRoles.js",
      "server/customerAuth.js",
    ],
    repo: ["server/repositories/raw/setupOrganization.repo.js"],
    schema: ["database/schema.sql  → setup_roles (module_permissions JSONB)"],
  },
  people: {
    label: "User onboard → People (setup users)",
    status: "done",
    knowledge: ["knowledge/setup/organization.md"],
    ui: ["src/pages/customer/setup/SetupPeoplePage.jsx"],
    client: ["src/lib/setup/setupApi.js"],
    server: ["server/setupOrganization.js"],
    repo: ["server/repositories/raw/setupOrganization.repo.js"],
    schema: ["database/schema.sql  → setup_users, setup_user_product_access"],
  },
  people_invite: {
    label: "Product-user invite + set-password",
    status: "done",
    knowledge: ["knowledge/setup/organization.md"],
    ui: [
      "src/pages/customer/setup/SetupPeoplePage.jsx",
      "src/pages/SetupUserSetPasswordPage.jsx",
    ],
    client: ["src/lib/setup/setupApi.js", "src/lib/http.js"],
    server: ["server/setupUserInvite.js", "server/notifications.js", "server/setupOrganization.js"],
    repo: ["server/repositories/raw/setupOrganization.repo.js"],
    schema: [
      "database/schema.sql  → setup_users (password_hash, invite_status…)",
      "database/schema.sql  → setup_user_invite_tokens",
    ],
    notes:
      "My Account admins only use customer_users. Setup people get invite email (link only) from SETUP_INVITE_SMTP_FROM. Public /invite/set-password.",
  },
  queues: {
    label: "CCaaS Queues + agents",
    status: "done",
    knowledge: ["knowledge/setup/queues.md"],
    ui: [
      "src/pages/customer/setup/SetupQueuesPage.jsx",
      "src/pages/customer/setup/SetupQueueDetailPage.jsx",
    ],
    client: ["src/lib/setup/setupApi.js"],
    server: ["server/setupQueues.js"],
    schema: ["database/schema.sql  → setup_ccaas_queues, setup_ccaas_queue_agents"],
    notes: "Requires purchased contact-center. One agent → one queue.",
  },
  channels_hub: {
    label: "Channel Setup hub",
    status: "done",
    knowledge: ["knowledge/setup/README.md"],
    ui: ["src/pages/customer/setup/SetupCommunicationPage.jsx"],
    client: ["src/lib/setup/setupApi.js"],
    schema: ["database/schema.sql  → setup_channel_configs"],
    notes: "Voice / Social / SMS listed as Coming soon.",
  },
  email: {
    label: "Channel Setup → Email",
    status: "done",
    knowledge: ["knowledge/setup/channels-email.md"],
    ui: [
      "src/pages/customer/setup/SetupCommunicationPage.jsx",
      "src/pages/customer/setup/SetupEmailConfigPage.jsx",
    ],
    client: ["src/lib/setup/setupApi.js", "src/lib/productCatalog.js"],
    server: [
      "server/setupChannels.js",
      "server/googleOAuth.js",
      "server/yahooOAuth.js",
      "server/msGraphOAuth.js",
    ],
    repo: ["server/repositories/raw/setupChannels.repo.js", "server/repositories/raw/mailOAuth.repo.js"],
    schema: ["database/schema.sql  → setup_channel_configs, setup_email_configs"],
    notes: "Gate: contact-center and/or campaign. OAuth: fetch authorize URL with Bearer, then redirect.",
  },
  webchat: {
    label: "Channel Setup → Web Chat",
    status: "partial",
    knowledge: ["knowledge/setup/channels-webchat.md"],
    ui: [
      "src/pages/customer/setup/SetupWebchatConfigPage.jsx",
      "src/pages/customer/setup/WebchatPersonalisationPanel.jsx",
      "src/pages/customer/setup/WebchatPrimaryFormPanel.jsx",
      "src/pages/customer/setup/webchatPersonalisation.js",
      "src/pages/customer/setup/webchatEmojis.js",
    ],
    client: ["src/lib/setup/setupApi.js"],
    server: ["server/setupWebchat.js"],
    repo: ["server/repositories/raw/setupWebchat.repo.js"],
    schema: ["database/schema.sql  → setup_channel_configs, setup_webchat_configs"],
    notes:
      "Tabs done: Basic, Personalisation, Primary Form. Stubs: Bot Configuration, Installation. Assets under uploads/webchat/.",
  },
  voice: {
    label: "Channel Setup → Voice / Call",
    status: "done",
    knowledge: ["knowledge/setup/channels-voice.md"],
    ui: [
      "src/pages/customer/setup/SetupCommunicationPage.jsx",
      "src/pages/customer/setup/SetupVoicePromptsPage.jsx",
      "src/pages/customer/setup/SetupVoicePromptDetailPage.jsx",
      "src/pages/customer/setup/SetupVoiceNumbersPage.jsx",
      "src/pages/customer/setup/SetupVoiceNumberDetailPage.jsx",
    ],
    client: ["src/lib/setup/setupApi.js", "src/lib/setup/voicePromptSlots.js"],
    server: ["server/setupVoice.js", "server/voice/ttsProvider.js", "server/voice/tts_synthesize.py"],
    repo: ["server/repositories/raw/setupVoice.repo.js"],
    schema: ["database/schema.sql  → setup_voice_prompt_profiles, setup_voice_dids"],
    notes:
      "Prompt profiles (12 slots) + DID routing. CCaaS: user|queue; CRM: user. Media: VOICE_MEDIA_ROOT.",
  },
  webchat_basic: {
    label: "Web Chat → Basic Settings",
    status: "done",
    knowledge: ["knowledge/setup/channels-webchat.md"],
    ui: ["src/pages/customer/setup/SetupWebchatConfigPage.jsx"],
    server: ["server/setupWebchat.js"],
    notes: "Fields: title, aliasTitle, description, greetingMessage, triggerMessage.",
  },
  webchat_personalisation: {
    label: "Web Chat → Personalisation",
    status: "done",
    knowledge: ["knowledge/setup/channels-webchat.md"],
    ui: [
      "src/pages/customer/setup/WebchatPersonalisationPanel.jsx",
      "src/pages/customer/setup/webchatPersonalisation.js",
    ],
    notes: "Stored in setup_webchat_configs.personalisation JSONB.",
  },
  webchat_primary_form: {
    label: "Web Chat → Primary Form (consent + pre-chat)",
    status: "done",
    knowledge: ["knowledge/setup/channels-webchat.md"],
    ui: [
      "src/pages/customer/setup/WebchatPrimaryFormPanel.jsx",
      "src/pages/customer/setup/webchatPersonalisation.js",
    ],
    notes: "Stored under personalisation.primaryForm (no separate table).",
  },
  knowledge_base: {
    label: "Knowledge Base documents",
    status: "done",
    knowledge: ["knowledge/setup/knowledge-documents.md"],
    ui: ["src/pages/customer/setup/SetupKnowledgeBasePage.jsx"],
    client: ["src/lib/setup/setupApi.js"],
    server: ["server/setupKnowledge.js"],
    repo: ["server/repositories/raw/setupKnowledge.repo.js"],
    schema: ["database/schema.sql  → setup_knowledge_documents"],
    notes: "Files under uploads/knowledge/<orgId>/.",
  },
  integrations: {
    label: "Integrations (Connected Apps)",
    status: "mock",
    ui: ["src/pages/customer/setup/SetupIntegrationsPage.jsx"],
    client: ["src/lib/setup/SetupWorkspaceContext.jsx", "src/lib/setup/setupMockData.js"],
    notes: "UI toggles only — no production backend.",
  },
  customer_hub: {
    label: "Customer Hub",
    status: "mock",
    ui: ["src/pages/customer/setup/SetupCustomerHubPage.jsx"],
    client: ["src/lib/setup/SetupWorkspaceContext.jsx", "src/lib/setup/setupMockData.js"],
    notes: "Demo CSV import only.",
  },
  styles_webchat: {
    label: "Web Chat / Setup CSS",
    status: "done",
    ui: ["src/styles.css"],
    notes: "Search for .webchat- and .setup- prefixes.",
  },
};

/** Aliases → canonical module key */
export const ALIASES = {
  login: "auth_customer",
  customer_login: "auth_customer",
  customer_auth: "auth_customer",
  staff: "auth_staff",
  profile: "business_profile",
  branch: "branches",
  hours: "business_hours",
  holidays: "business_hours",
  team: "teams",
  role: "roles",
  users: "people",
  user: "people",
  setup_users: "people",
  invite: "people_invite",
  set_password: "people_invite",
  "set-password": "people_invite",
  product_invite: "people_invite",
  queue: "queues",
  ccaas_queues: "queues",
  communication: "channels_hub",
  channels: "channels_hub",
  voice: "voice",
  dids: "voice",
  prompt_profiles: "voice",
  call_prompts: "voice",
  mail: "email",
  "web-chat": "webchat",
  web_chat: "webchat",
  widget: "webchat",
  personalisation: "webchat_personalisation",
  personalization: "webchat_personalisation",
  "primary-form": "webchat_primary_form",
  primary_form: "webchat_primary_form",
  consent: "webchat_primary_form",
  prechat: "webchat_primary_form",
  kb: "knowledge_base",
  knowledge: "knowledge_base",
  docs: "knowledge_base",
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
        ...(mod.ui || []),
        ...(mod.client || []),
        ...(mod.server || []),
        ...(mod.repo || []),
        ...(mod.schema || []),
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
    ["ui", entry.ui],
    ["client", entry.client],
    ["server", entry.server],
    ["repo", entry.repo],
    ["schema", entry.schema],
  ];
  for (const [name, paths] of groups) {
    if (!paths?.length) continue;
    console.log(`  ${name}:`);
    for (const path of paths) console.log(`    - ${path}`);
  }
  if (entry.notes) console.log(`  notes: ${entry.notes}`);
}

function printHelp() {
  console.log(`My Account file locator (root: ${ROOT_HINT})

Usage:
  node knowledge/locator.js
  node knowledge/locator.js <module> [module...]
  node knowledge/locator.js --search <text>
  node knowledge/locator.js --keys

Examples:
  node knowledge/locator.js webchat
  node knowledge/locator.js email queues
  node knowledge/locator.js primary-form
  node knowledge/locator.js --search consent
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
      console.log(`${row.key.padEnd(28)} ${row.status.padEnd(8)} ${row.label}`);
    }
    console.log("\nAliases:", Object.keys(ALIASES).sort().join(", "));
    return;
  }
  if (args[0] === "--search") {
    const query = args.slice(1).join(" ");
    const hits = searchModules(query);
    if (!hits.length) {
      console.log(`No modules matched “${query}".`);
      return;
    }
    for (const hit of hits) printModule(locate(hit.key));
    return;
  }
  if (!args.length) {
    console.log(`Modules (package root: ${ROOT_HINT})\n`);
    for (const row of listModules()) {
      console.log(`  ${row.key.padEnd(28)} ${row.status.padEnd(8)} ${row.label}`);
    }
    console.log("\nRun with a module key, or --help.");
    return;
  }

  let found = 0;
  for (const arg of args) {
    const entry = locate(arg);
    if (!entry) {
      console.error(`Unknown module: “${arg}". Try --keys or --search.`);
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
