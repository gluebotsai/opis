import { io, type Socket } from "socket.io-client";
import { subscribeEmbedToken } from "@/lib/embed-auth";
import { getToken } from "@/services/api";

/** LAN dev + Docker/nginx: same-origin `/agents-socket` proxy. Direct :8005 only when host differs. */
function resolveAgentsConnection(): { url: string; path: string } {
  const explicit = import.meta.env.VITE_AGENTS_URL?.trim();
  const explicitPath = import.meta.env.VITE_AGENTS_SOCKET_PATH?.trim();
  const proxyPath = explicitPath || "/agents-socket";

  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    if (!explicit) {
      return { url: origin, path: proxyPath };
    }
    try {
      const target = new URL(explicit);
      const page = new URL(origin);
      const sameHost = target.hostname === page.hostname;
      const defaultPort =
        page.protocol === "https:" ? "443" : page.protocol === "http:" ? "80" : "";
      const targetPort = target.port || defaultPort;
      const pagePort = page.port || defaultPort;
      // Stale LAN IP in .env, or public URL matching the SPA — use nginx/Vite proxy.
      if (!sameHost || targetPort === pagePort) {
        return { url: origin, path: proxyPath };
      }
      // Local direct agents (e.g. VITE_AGENTS_URL=http://127.0.0.1:8005 while on :5173).
      return { url: explicit, path: explicitPath || "/socket-io" };
    } catch {
      return { url: origin, path: proxyPath };
    }
  }

  return {
    url: explicit || "http://127.0.0.1:8005",
    path: explicitPath || (explicit ? "/socket-io" : "/agents-socket"),
  };
}

function agentsConnectionLabel(): { url: string; path: string } {
  return resolveAgentsConnection();
}

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  created_at?: string;
  createdAt?: string;
};

export type LaunchPlan = {
  schedule_mode?: "now" | "at" | string;
  scheduled_at?: string | null;
  timezone?: string | null;
  launch_local_date?: string | null;
  launch_local_time?: string | null;
  launch_channels?: string[];
  primary_channel?: string | null;
  orchestration_mode?: "broadcast" | "prefer_primary" | "staggered" | string | null;
  ab_enabled?: boolean;
  ab_pct_a?: number | null;
  ab_pct_b?: number | null;
  ab_pct_holdout?: number | null;
  ab_auto?: boolean | null;
  ab_decide_after_minutes?: number | null;
  ab_winner?: "a" | "b" | null;
  ab_test_size_a?: number | null;
  ab_test_size_b?: number | null;
  ab_sample_size_a?: number | null;
  ab_sample_size_b?: number | null;
  ab_holdout?: boolean;
  ab_variant_a_template_id?: string | null;
  ab_variant_b_template_id?: string | null;
  ab_note?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

export type CampaignSummaryPayload = {
  name?: string;
  goal?: string;
  objective?: string;
  audience_count?: number;
  audience_description?: string;
  channels?: string[];
  template_ids?: string[];
  templates?: Array<{ template_id?: string | null; channel?: string }>;
};

export type CampaignAgentState = {
  session_id: string;
  module?: string;
  stage?: string;
  campaign?: { name?: string; goal?: string; objective?: string };
  audience?: {
    filters?: Record<string, unknown>;
    matched_count?: number;
    sample_names?: string[];
    description?: string;
    soft_warnings?: string[];
    consent?: {
      weak_count?: number;
      missing_count?: number;
      by_source?: Record<string, number>;
      warnings?: string[];
    };
    quality?: {
      with_email?: number;
      with_phone?: number;
      missing_email?: number;
      missing_phone?: number;
      notes?: string[];
    };
  };
  channels?: string[];
  channel_plans?: Array<{
    channel: string;
    how_it_works?: string;
    suggested_launch_at?: string;
  }>;
  templates?: TemplateCard[];
  confirmed_create_templates?: boolean;
  active_edit_channel?: string | null;
  launch_plan?: LaunchPlan | null;
  launch_confirmed?: boolean;
  templates_finalized?: boolean;
  summary_presented?: boolean;
  campaign_id?: string | null;
  /** FE draft chrome + pinned template timeline (cross-device exact chat). */
  ui?: {
    status?: string;
    committed?: boolean;
    dirty?: boolean;
    timelineTemplates?: unknown[];
    [key: string]: unknown;
  };
  form_launch?: {
    event_id?: string | null;
    title?: string;
    public_url?: string | null;
    public_slug?: string | null;
  } | null;
  form_url?: string | null;
  // contacts module
  focus_contact_id?: string | null;
  draft_contact?: ContactDraftFields;
  /** Agent-chosen panel mode from SET_DRAFT_FIELDS / GET_CONTACT. */
  mode?: "create" | "update" | null;
  candidates?: ContactCandidate[];
  pending_delete_id?: string | null;
  last_action?: string | null;
};

export type ContactDraftFields = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company_name?: string;
  city?: string;
  app_push_token?: string;
  app_push_platform?: string;
  app_push_asked?: string;
  web_push_endpoint?: string;
  web_push_p256dh?: string;
  web_push_auth?: string;
  web_push_asked?: string;
};

function maskDraftToken(value: string): string {
  const v = value.trim();
  if (v.length <= 20) return v;
  return `${v.slice(0, 10)}…${v.slice(-6)}`;
}

export function formatDraftAppPush(draft: ContactDraftFields): string {
  const token = (draft.app_push_token || "").trim();
  const plat = (draft.app_push_platform || "").trim();
  if (token) return plat ? `${maskDraftToken(token)} · ${plat}` : maskDraftToken(token);
  if ((draft.app_push_asked || "").trim()) return "Skipped";
  return "";
}

export function formatDraftWebPush(draft: ContactDraftFields): string {
  const endpoint = (draft.web_push_endpoint || "").trim();
  if (endpoint) {
    try {
      return new URL(endpoint).host || endpoint;
    } catch {
      return endpoint.length > 40 ? `${endpoint.slice(0, 28)}…` : endpoint;
    }
  }
  if ((draft.web_push_asked || "").trim()) return "Skipped";
  return "";
}

export type ContactCandidate = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company_name?: string | null;
  city?: string | null;
};

export type TemplateFields = {
  subject?: string;
  preheader?: string;
  pattern_id?: string;
  theme_id?: string;
  theme?: Record<string, string>;
  sections?: Array<{
    type?: string;
    purpose?: string;
    content?: string;
    items?: string[];
    label?: string;
    url?: string;
  }>;
  greeting?: string;
  paragraphs?: string[];
  cta_label?: string;
  cta_url?: string;
  signoff?: string;
  footer?: string;
  body?: string;
  title?: string;
  buttons?: Array<{
    label?: string;
    text?: string;
    url?: string;
    type?: string;
  }>;
  [key: string]: unknown;
};

export type TemplateCard = {
  template_id: string;
  session_id?: string;
  channel: string;
  logo?: string;
  launch_at?: string;
  /** @deprecated prefer fields */
  preview?: string;
  fields?: TemplateFields;
  how_it_works?: string;
  generation_batch_id?: string;
  created_at?: string;
  updated_at?: string;
  edit_messages?: Array<{
    role: "user" | "assistant";
    text: string;
  }>;
};

export type TemplateEditMessage = {
  id?: string;
  template_id?: string;
  role: "user" | "assistant" | "system";
  seq?: number;
  kind: "text" | "template";
  payload: {
    text?: string;
    fields?: TemplateFields;
    image_url?: string;
    image_filename?: string;
    image_urls?: { url?: string; filename?: string }[];
  };
  created_at?: string;
};

let shared: Socket | null = null;
let embedAuthSubscribed = false;
/** JWT on the live transport — skip reconnect when embed/CRM re-posts the same token. */
let agentsSocketAuthAtConnect: string | null = null;
/** Dedupe CRM postMessage auth — must match main.tsx (no disconnect mid join_session). */
let lastEmbedAuthRefreshToken: string | null = null;

function normalizeAuthToken(token: string | null | undefined): string | null {
  const t = String(token || "").trim();
  return t || null;
}

function wireSharedSocketLifecycle(socket: Socket) {
  socket.on("connect", () => {
    agentsSocketAuthAtConnect = normalizeAuthToken(getToken());
  });
  socket.on("disconnect", () => {
    // Keep last JWT for dedupe — CRM often re-posts the same token during reconnect.
  });
}

function syncSocketAuthAndConnect(socket: Socket) {
  const token = getToken();
  socket.auth = { token: token || undefined };
  if (!token) return;
  if (!socket.connected) socket.connect();
}

function ensureEmbedAuthSubscription() {
  if (embedAuthSubscribed) return;
  embedAuthSubscribed = true;
  subscribeEmbedToken((token) => {
    const normalized = normalizeAuthToken(token);
    if (!normalized) return;
    if (lastEmbedAuthRefreshToken === normalized) return;
    lastEmbedAuthRefreshToken = normalized;
    refreshAgentsSocketAuth();
  });
}

/** True when the shared agents Socket.IO transport is up (hub + create share one client). */
export function isAgentsSocketConnected(): boolean {
  return Boolean(shared?.connected);
}

export function getAgentsSocket(): Socket {
  ensureEmbedAuthSubscription();
  const token = getToken();
  if (shared) {
    syncSocketAuthAndConnect(shared);
    return shared;
  }
  const { url, path } = agentsConnectionLabel();
  shared = io(url, {
    path,
    // Polling first — survives nginx/LAN proxies when WS upgrade is flaky.
    transports: ["polling", "websocket"],
    auth: { token: token || undefined },
    // Wait for SPA login or CRM embed JWT — connecting with null auth always fails.
    autoConnect: Boolean(token),
    reconnection: true,
    reconnectionAttempts: 20,
    timeout: 12_000,
  });
  wireSharedSocketLifecycle(shared);
  if (token) shared.connect();
  return shared;
}

export function disconnectAgentsSocket() {
  if (shared) {
    shared.disconnect();
    shared = null;
    agentsSocketAuthAtConnect = null;
  }
}

/** Re-auth after CRM embed token refresh (Socket.IO validates JWT at connect). */
export function refreshAgentsSocketAuth() {
  if (!shared) return;
  const token = normalizeAuthToken(getToken());
  shared.auth = { token: token || undefined };
  if (!token) {
    agentsSocketAuthAtConnect = null;
    lastEmbedAuthRefreshToken = null;
    if (shared.connected) shared.disconnect();
    return;
  }
  if (shared.connected && token === agentsSocketAuthAtConnect) {
    return;
  }
  lastEmbedAuthRefreshToken = token;
  agentsSocketAuthAtConnect = token;
  if (shared.connected) {
    shared.disconnect();
  }
  shared.connect();
}

export function agentsBaseUrl() {
  return agentsConnectionLabel().url;
}

export function agentsSocketPath() {
  return agentsConnectionLabel().path;
}

/** User-facing connect_error — same-origin proxy, not raw :8005. */
export function formatAgentsConnectError(err: Error): string {
  const detail = err.message?.trim() || "connection failed";
  const { path } = agentsConnectionLabel();
  const xhrFailed =
    /xhr (poll|post) error/i.test(detail) ||
    /websocket error/i.test(detail) ||
    /unable to connect/i.test(detail);
  if (typeof window !== "undefined" && xhrFailed) {
    const host = window.location.hostname;
    const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
    if (host === "localhost" || host === "127.0.0.1") {
      return (
        `Cannot reach agents (${detail}). ` +
        "Local dev: run `npm run dev:lan` from worktual-campaign, open the **LAN URL** it prints " +
        `(e.g. http://192.168.x.x:5173), not localhost:${port} if Cursor/VS Code also uses :5173. ` +
        "Agents must be listening on :8005."
      );
    }
  }
  if (path === "/agents-socket" || path.startsWith("/agents-socket")) {
    return `Cannot reach agents (${detail}). Try closing extra Campaign tabs and hard-refresh (Ctrl+Shift+R).`;
  }
  return `Cannot reach agents (${detail}). Is the agents service running?`;
}

/**
 * Socket.IO may emit connect_error while polling is still retrying.
 * Only surface an error if still disconnected after a short wait.
 */
export function deferAgentsConnectError(
  socket: Socket,
  err: Error,
  report: (message: string) => void,
): () => void {
  let cancelled = false;
  const timer = window.setTimeout(() => {
    if (cancelled || socket.connected) return;
    report(formatAgentsConnectError(err));
  }, 2500);
  const onConnect = () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
  socket.once("connect", onConnect);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    socket.off("connect", onConnect);
  };
}
