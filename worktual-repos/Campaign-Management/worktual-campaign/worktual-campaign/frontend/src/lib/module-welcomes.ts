/**
 * Randomized co-worker welcome lines per module.
 * Used on module open / New chat so the opener is not identical every time.
 */

export type WelcomeModule =
  | "contacts"
  | "contacts_b2c"
  | "create_campaign"
  | "monitoring"
  | "reports"
  | "events"
  | "recommendations"
  | "forms"
  | "dashboard";

const POOLS: Record<WelcomeModule, readonly string[]> = {
  contacts: [
    "Hi — I'll help with your audience.\nAsk me to find someone, add a contact, or update their details.",
    "Hey! I can help you find contacts, add someone new, or update details. What would you like to do?",
    "Welcome — need to look someone up, add a contact, or change existing info? Just tell me.",
    "Hi there! I'm here for audience work — search, create, or edit contacts. What's on your mind?",
    "Good to see you. I can look up contacts, walk you through adding one, or help with updates. How can I help?",
    "Hello! Tell me a name or email, or say you'd like to add a new contact — I'll take it from there.",
  ],
  contacts_b2c: [
    "Hi — I'll help with your customers.\nAsk me to find someone, add a customer, or update their details.",
    "Hey! I can help you find customers, add someone new, or update their details. What would you like to do?",
    "Welcome — need to look someone up, add a customer, or change existing info? Just tell me.",
    "Hi there! I'm here for your audience — search, create, or edit customer records. What's on your mind?",
    "Good to see you. I can look up customers, walk you through adding one, or help with updates. How can I help?",
    "Hello! Tell me a name or email, or say you'd like to add a new customer — I'll take it from there.",
  ],
  create_campaign: [
    "Hi — I'll help you create a campaign.\nShare your campaign idea (or say you need ideas), and we'll shape names, strategy, audience, templates, then launch — confirmations stay in this chat.",
    "Welcome! Tell me what you want to promote, or ask for ideas — we'll build the campaign from there.",
    "Hey — ready when you are. Share a campaign idea, or say you need suggestions.",
    "Hi there! I can help with names, audience, templates, and launch. What's the campaign about?",
    "Good to see you. Describe the campaign (or ask for ideas) and I'll guide the next steps.",
  ],
  monitoring: [
    "Ask — I can report on live, scheduled, or past campaigns: email opens/clicks and PPC spend, impressions, CTR, CPC, and conversions. I can also stop a launching campaign, stop or resume a channel, or pick an email A/B winner early.",
    "Hi — need campaign status, opens/clicks, or PPC numbers? Or stop/resume a channel? Just ask.",
    "Welcome. I can check live or past campaigns, channel health, and early A/B winners. What do you need?",
    "Hey! Ask about sends, opens, clicks, spend, or whether to pause a channel.",
  ],
  reports: [
    "Ask about campaign performance (live, scheduled, past, drafts — opens, clicks, sent, failed, launched today) or events tracking (submissions, opens, status). I pull real numbers and answer directly.",
    "Hi — I can pull campaign and events numbers for you. What would you like to know?",
    "Welcome. Ask for opens, clicks, sends, failures, or event submissions — I'll look it up.",
    "Hey! Performance questions welcome — live, scheduled, past, or drafts.",
  ],
  events: [
    "Ask about your events — drafts, launched forms, submissions, opens, and status. Or tell me to create a form, webinar, or other event and I will open Create events for you.",
    "Hi — I can check event drafts, launches, and submissions, or help you start a new form/webinar.",
    "Welcome. Need event status, opens, or a new form? Tell me what you need.",
    "Hey! Ask about submissions and status, or say you want to create an event.",
  ],
  recommendations: [
    "Hi — I'll recommend campaigns from your past results when you have them, or from knowledge if you have not sent yet. Cards show on the board when ready.",
    "Welcome! I can suggest campaign ideas from your history or knowledge. Say when to start.",
    "Hey — ready to recommend campaigns. Ask for ideas and I'll put cards on the board.",
    "Hi there! Tell me what kind of campaign you want ideas for and I'll recommend options.",
  ],
  forms: [
    "Hi — I can help you create and edit this form, then hand off to Create campaign when you're ready. What do you need (goal, fields, colors, or layout)?",
    "Welcome! Tell me the form goal, fields, or look — I'll shape it with you.",
    "Hey — ready to build or tweak this form. What should we change first?",
    "Hi there! Goal, fields, colors, or layout — where should we start?",
  ],
  dashboard: [
    "Hi — I can help you navigate campaigns, audience, reports, and more. What would you like to do?",
    "Welcome! Ask me to open a module or get started on a task.",
    "Hey — ready when you are. Campaigns, audience, monitoring, or reports?",
    "Hi there! Tell me what you need and I'll point you the right way.",
  ],
};

export function pickModuleWelcome(module: WelcomeModule): string {
  const pool = POOLS[module];
  if (!pool.length) return "";
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export function isModuleWelcomeText(
  module: WelcomeModule,
  text: string | null | undefined,
): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  return POOLS[module].some((line) => line.trim() === t);
}

export function contactsWelcomeMessage(b2c = false): {
  id: string;
  role: "assistant";
  text: string;
} {
  return {
    id: `welcome-${crypto.randomUUID()}`,
    role: "assistant",
    text: pickModuleWelcome(b2c ? "contacts_b2c" : "contacts"),
  };
}
