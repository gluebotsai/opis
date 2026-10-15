import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { pool } from "./db/pool.js";
import { isOrgAdminCustomer } from "./customerAuth.js";
import { isUuid } from "./db/util.js";
import { listSubscriptionsByOrganization } from "./subscriptions.js";
import * as repo from "./repositories/raw/setupWebchat.repo.js";

export const CCAAS_PRODUCT_ID = "contact-center";
export const WEBCHAT_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const WEBCHAT_ASSET_KINDS = new Set([
  "chat_icon_logo",
  "widget_icon_logo",
  "bot_avatar",
]);

const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads", "webchat");
const ALLOWED_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/jpg"]);

const DEFAULT_PERSONALISATION = {
  chatIconLogoUrl: "",
  chatIconLogoKey: "",
  widgetIconLogoUrl: "",
  widgetIconLogoKey: "",
  fontStyle: "Inter",
  brandColourMode: "solid",
  chatHeaderColour: "#5B55FF",
  chatHeaderGradientFrom: "#5B55FF",
  chatHeaderGradientTo: "#8B5CF6",
  chatIconColour: "#5B55FF",
  chatIconGradientFrom: "#5B55FF",
  chatIconGradientTo: "#8B5CF6",
  agentMessageColour: "#F4F4F4",
  customerMessageColour: "#E2E2FA",
  actionMessageColour: "#575CFF",
  botAvatarPreset: "orange",
  botAvatarUrl: "",
  botAvatarKey: "",
  chatBackgroundPattern: "none",
  notificationSound: "ethereal",
  position: "bottom_right",
  roundedCorners: 72,
  chatIconShape: "circle",
  widgetLauncher: "icon",
  enableTracker: true,
  trackerType: "",
  trackerName: "",
  trackerDelay: "none",
  agentHandoffMessage: "Please wait while I connect you to an available agent",
  agentBusyMessage:
    "All our agents are busy at the moment. We will connect you shortly. You could choose to wait or leave your name, email ID and phone number with us, and we will get back to you",
  agentBusyCallback: false,
  agentUnavailableMessage:
    "All our agents are unavailable at the moment. Please leave your name, email address, and number and we will get back to you",
  agentUnavailableCallback: false,
  outOfHoursMessage:
    "Our agents are only available between <start time> and <end time>. Please leave your name, phone number and email ID and we will get back to you!",
  outOfHoursCallback: false,
  callbackThresholdHours: 24,
  allowCustomerUploadDocuments: false,
  allowCustomerDownloadTranscript: false,
  allowCustomerEmailTranscript: false,
  enableWidgetLanguage: false,
};

const DEFAULT_PRIMARY_FORM = {
  consentEnabled: false,
  consentLanguage: "browser",
  consentMessage:
    'We use the information you share with us to help address your customer service issues. By clicking on "Yes, I agree", you give us consent to follow up via email or phone.',
  privacyPolicyUrl: "https://www.example.com/privacy",
  privacyPolicyLinkText: "View our Privacy Policy",
  optInButton: "Yes, I agree",
  optOutButton: "No, not now",
  optOutConfirmation:
    "That's okay. You can view the policy at any time and continue when you're ready.",
  prechatEnabled: false,
  prechatTitle: "Hello! Let's get started",
  prechatMessage: "To start a conversation, please provide your details",
  prechatButtonLabel: "Start Conversation",
  prechatButtonBg: "#000000",
  prechatTitleLayout: "block",
  customFields: [
    { id: "field_first_name", label: "First name", mandatory: false },
    { id: "field_phone", label: "Phone number", mandatory: false },
    { id: "field_email", label: "Email", mandatory: true },
  ],
};

function normalizePrimaryForm(raw) {
  const incoming = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const next = { ...DEFAULT_PRIMARY_FORM, ...incoming };
  next.consentEnabled = Boolean(next.consentEnabled);
  next.consentLanguage = next.consentLanguage === "widget" ? "widget" : "browser";
  next.consentMessage = String(next.consentMessage || DEFAULT_PRIMARY_FORM.consentMessage);
  next.privacyPolicyUrl = String(next.privacyPolicyUrl || "").trim();
  next.privacyPolicyLinkText = String(
    next.privacyPolicyLinkText || DEFAULT_PRIMARY_FORM.privacyPolicyLinkText,
  ).trim();
  next.optInButton = String(next.optInButton || DEFAULT_PRIMARY_FORM.optInButton).trim();
  next.optOutButton = String(next.optOutButton || DEFAULT_PRIMARY_FORM.optOutButton).trim();
  next.optOutConfirmation = String(
    next.optOutConfirmation || DEFAULT_PRIMARY_FORM.optOutConfirmation,
  );
  next.prechatEnabled = Boolean(next.prechatEnabled);
  next.prechatTitle = String(next.prechatTitle || DEFAULT_PRIMARY_FORM.prechatTitle).trim();
  next.prechatMessage = String(next.prechatMessage || DEFAULT_PRIMARY_FORM.prechatMessage);
  next.prechatButtonLabel = String(
    next.prechatButtonLabel || DEFAULT_PRIMARY_FORM.prechatButtonLabel,
  ).trim();
  next.prechatButtonBg = isHexColour(next.prechatButtonBg)
    ? String(next.prechatButtonBg).trim().toUpperCase()
    : DEFAULT_PRIMARY_FORM.prechatButtonBg;
  next.prechatTitleLayout = next.prechatTitleLayout === "inline" ? "inline" : "block";
  const fields = Array.isArray(next.customFields) ? next.customFields : DEFAULT_PRIMARY_FORM.customFields;
  next.customFields = fields
    .map((field, index) => ({
      id: String(field?.id || `field_${index + 1}`),
      label: String(field?.label || "").trim() || `Field ${index + 1}`,
      mandatory: Boolean(field?.mandatory),
    }))
    .slice(0, 20);
  if (!next.customFields.length) {
    next.customFields = DEFAULT_PRIMARY_FORM.customFields.map((field) => ({ ...field }));
  }
  return next;
}

function assertOrgAdmin(customerUser) {
  if (!isOrgAdminCustomer(customerUser)) {
    const error = new Error("Only organization admins can modify setup workspace.");
    error.statusCode = 403;
    throw error;
  }
}

function assertChannelConfigId(id) {
  if (!isUuid(id)) {
    const error = new Error("Web Chat configuration id is invalid.");
    error.statusCode = 400;
    throw error;
  }
}

async function assertCcaasPurchased(organizationId) {
  const subscriptions = await listSubscriptionsByOrganization(organizationId);
  const hasCcaas = subscriptions.some(
    (row) => row.status === "active" && row.productId === CCAAS_PRODUCT_ID,
  );
  if (!hasCcaas) {
    const error = new Error("Web Chat is only available when Contact Centre is purchased.");
    error.statusCode = 403;
    throw error;
  }
}

function generateWebchatId() {
  return `wc_${crypto.randomUUID().replace(/-/g, "")}`;
}

function isHexColour(value) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || "").trim());
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function defaultPersonalisation() {
  return { ...DEFAULT_PERSONALISATION };
}

export function mergePersonalisation(raw) {
  const incoming = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const next = { ...DEFAULT_PERSONALISATION, ...incoming };

  next.fontStyle = String(next.fontStyle || "Inter").trim() || "Inter";
  next.brandColourMode = next.brandColourMode === "gradient" ? "gradient" : "solid";

  for (const key of [
    "chatHeaderColour",
    "chatHeaderGradientFrom",
    "chatHeaderGradientTo",
    "chatIconColour",
    "chatIconGradientFrom",
    "chatIconGradientTo",
    "agentMessageColour",
    "customerMessageColour",
    "actionMessageColour",
  ]) {
    if (!isHexColour(next[key])) {
      next[key] = DEFAULT_PERSONALISATION[key];
    } else {
      next[key] = String(next[key]).trim().toUpperCase();
    }
  }

  next.botAvatarPreset = String(next.botAvatarPreset || "orange").trim() || "orange";
  next.chatBackgroundPattern = String(next.chatBackgroundPattern || "none").trim() || "none";
  next.notificationSound = String(next.notificationSound || "ethereal").trim() || "ethereal";
  next.position = next.position === "bottom_left" ? "bottom_left" : "bottom_right";
  next.roundedCorners = clamp(Number(next.roundedCorners) || 0, 0, 100);
  next.chatIconShape = next.chatIconShape === "square" ? "square" : "circle";
  next.widgetLauncher = next.widgetLauncher === "text" ? "text" : "icon";
  next.enableTracker = Boolean(next.enableTracker);
  next.trackerType = String(next.trackerType || "").trim();
  next.trackerName = String(next.trackerName || "").trim();
  next.trackerDelay = String(next.trackerDelay || "none").trim() || "none";
  next.agentHandoffMessage = String(next.agentHandoffMessage || "").trim();
  next.agentBusyMessage = String(next.agentBusyMessage || "").trim();
  next.agentUnavailableMessage = String(next.agentUnavailableMessage || "").trim();
  next.outOfHoursMessage = String(next.outOfHoursMessage || "").trim();
  next.agentBusyCallback = Boolean(next.agentBusyCallback);
  next.agentUnavailableCallback = Boolean(next.agentUnavailableCallback);
  next.outOfHoursCallback = Boolean(next.outOfHoursCallback);
  next.callbackThresholdHours = clamp(Number(next.callbackThresholdHours) || 24, 1, 168);
  next.allowCustomerUploadDocuments = Boolean(next.allowCustomerUploadDocuments);
  next.allowCustomerDownloadTranscript = Boolean(next.allowCustomerDownloadTranscript);
  next.allowCustomerEmailTranscript = Boolean(next.allowCustomerEmailTranscript);
  next.enableWidgetLanguage = Boolean(next.enableWidgetLanguage);
  next.primaryForm = normalizePrimaryForm(next.primaryForm);

  for (const key of [
    "chatIconLogoUrl",
    "chatIconLogoKey",
    "widgetIconLogoUrl",
    "widgetIconLogoKey",
    "botAvatarUrl",
    "botAvatarKey",
  ]) {
    next[key] = String(next[key] || "").trim();
  }

  return next;
}

function mapWebchatConfig(row) {
  if (!row) return null;
  return {
    id: row.id,
    channelType: "web_chat",
    name: row.name,
    status: row.status || "pending",
    productIds: Array.isArray(row.product_ids) ? row.product_ids : [],
    webchatId: row.webchat_id,
    title: row.webchat_title || row.title || "",
    aliasTitle: row.alias_title || "",
    description: row.webchat_description || row.description || "",
    greetingMessage: row.greeting_message || "",
    triggerMessage: row.trigger_message || "",
    personalisation: mergePersonalisation(row.personalisation),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TRIGGER_MESSAGE_MAX = 100;

function requireTrimmed(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error(`${label} is required.`);
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function stripHtmlToText(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Allow basic rich-text tags from the greeting editor; drop scripts/events. */
function sanitizeGreetingHtml(value) {
  const raw = String(value || "").trim();
  if (!stripHtmlToText(raw)) {
    const error = new Error("Greeting message is required.");
    error.statusCode = 400;
    throw error;
  }
  return raw
    .replace(/<\/?(script|iframe|object|embed|form|input|button)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
}

function normalizeTriggerMessage(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, TRIGGER_MESSAGE_MAX);
}

function assetUrlFor(configId, key) {
  return `/api/v1/me/setup/channels/web-chat/${configId}/assets/${encodeURIComponent(key)}`;
}

function orgUploadDir(organizationId, configId) {
  return path.join(UPLOAD_ROOT, String(organizationId), String(configId));
}

export async function listWebchatConfigs(organizationId) {
  const rows = await repo.listWebchatChannelConfigs(pool, organizationId);
  return rows.map(mapWebchatConfig);
}

export async function getWebchatConfig(organizationId, id) {
  assertChannelConfigId(id);
  const row = await repo.getWebchatChannelConfigById(pool, organizationId, id);
  if (!row) {
    const error = new Error("Web Chat configuration not found.");
    error.statusCode = 404;
    throw error;
  }
  return mapWebchatConfig(row);
}

export async function createWebchatConfig(customerUser, body = {}) {
  assertOrgAdmin(customerUser);
  await assertCcaasPurchased(customerUser.organizationId);

  const title = requireTrimmed(body.title, "Title");
  const aliasTitle = requireTrimmed(body.aliasTitle, "Alias title");
  const greetingMessage = sanitizeGreetingHtml(body.greetingMessage);
  const description = String(body.description || "").trim() || null;
  const triggerMessage = normalizeTriggerMessage(body.triggerMessage);
  const personalisation = mergePersonalisation(body.personalisation);
  const name = String(body.name || title).trim() || title;

  const row = await repo.insertWebchatChannelConfig(
    pool,
    customerUser.organizationId,
    {
      name,
      status: "pending",
      productIds: [CCAAS_PRODUCT_ID],
    },
    {
      webchatId: generateWebchatId(),
      title,
      aliasTitle,
      description,
      greetingMessage,
      triggerMessage,
      personalisation,
    },
  );
  return mapWebchatConfig(row);
}

export async function patchWebchatConfig(customerUser, id, body = {}) {
  assertOrgAdmin(customerUser);
  assertChannelConfigId(id);
  await assertCcaasPurchased(customerUser.organizationId);

  const existing = await repo.getWebchatChannelConfigById(pool, customerUser.organizationId, id);
  if (!existing) {
    const error = new Error("Web Chat configuration not found.");
    error.statusCode = 404;
    throw error;
  }

  const webchatFields = {};
  const channelFields = {};

  if (body.title !== undefined) {
    webchatFields.title = requireTrimmed(body.title, "Title");
    channelFields.name = webchatFields.title;
  }
  if (body.aliasTitle !== undefined) {
    webchatFields.aliasTitle = requireTrimmed(body.aliasTitle, "Alias title");
  }
  if (body.description !== undefined) {
    webchatFields.description = String(body.description || "").trim() || null;
  }
  if (body.greetingMessage !== undefined) {
    webchatFields.greetingMessage = sanitizeGreetingHtml(body.greetingMessage);
  }
  if (body.triggerMessage !== undefined) {
    webchatFields.triggerMessage = normalizeTriggerMessage(body.triggerMessage);
  }
  if (body.personalisation !== undefined) {
    const existingMerged = mergePersonalisation(existing.personalisation);
    webchatFields.personalisation = mergePersonalisation({
      ...existingMerged,
      ...body.personalisation,
      primaryForm: normalizePrimaryForm({
        ...existingMerged.primaryForm,
        ...(body.personalisation?.primaryForm || {}),
      }),
    });
  }
  if (body.name !== undefined) {
    channelFields.name = String(body.name || "").trim() || existing.name;
  }
  if (body.status !== undefined) {
    channelFields.status = String(body.status || "").trim() || existing.status;
  }

  const row = await repo.updateWebchatChannelConfig(
    pool,
    customerUser.organizationId,
    id,
    channelFields,
    webchatFields,
  );
  return mapWebchatConfig(row);
}

export async function removeWebchatConfig(customerUser, id) {
  assertOrgAdmin(customerUser);
  assertChannelConfigId(id);
  await assertCcaasPurchased(customerUser.organizationId);
  const ok = await repo.deleteWebchatChannelConfig(pool, customerUser.organizationId, id);
  if (!ok) {
    const error = new Error("Web Chat configuration not found.");
    error.statusCode = 404;
    throw error;
  }
  const dir = orgUploadDir(customerUser.organizationId, id);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

export async function uploadWebchatAsset(customerUser, configId, kind, file) {
  assertOrgAdmin(customerUser);
  assertChannelConfigId(configId);
  await assertCcaasPurchased(customerUser.organizationId);

  if (!WEBCHAT_ASSET_KINDS.has(String(kind || ""))) {
    const error = new Error("Upload kind must be chat_icon_logo, widget_icon_logo, or bot_avatar.");
    error.statusCode = 400;
    throw error;
  }
  if (!file?.buffer) {
    const error = new Error("Image file is required.");
    error.statusCode = 400;
    throw error;
  }
  if (file.size > WEBCHAT_ASSET_MAX_BYTES) {
    const error = new Error("Image must be under 5 MB.");
    error.statusCode = 400;
    throw error;
  }

  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext) || !ALLOWED_IMAGE_MIME.has(mime)) {
    const error = new Error("Only JPEG or PNG images are allowed.");
    error.statusCode = 400;
    throw error;
  }

  const existing = await repo.getWebchatChannelConfigById(
    pool,
    customerUser.organizationId,
    configId,
  );
  if (!existing) {
    const error = new Error("Web Chat configuration not found.");
    error.statusCode = 404;
    throw error;
  }

  const safeExt = ext === ".jpeg" ? ".jpg" : ext;
  const key = `${kind}-${crypto.randomUUID()}${safeExt}`;
  const dir = orgUploadDir(customerUser.organizationId, configId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, key), file.buffer);

  const url = assetUrlFor(configId, key);
  const personalisation = mergePersonalisation(existing.personalisation);

  if (kind === "chat_icon_logo") {
    personalisation.chatIconLogoKey = key;
    personalisation.chatIconLogoUrl = url;
  } else if (kind === "widget_icon_logo") {
    personalisation.widgetIconLogoKey = key;
    personalisation.widgetIconLogoUrl = url;
  } else {
    personalisation.botAvatarKey = key;
    personalisation.botAvatarUrl = url;
    personalisation.botAvatarPreset = "custom";
  }

  const row = await repo.updateWebchatChannelConfig(
    pool,
    customerUser.organizationId,
    configId,
    {},
    { personalisation },
  );

  return {
    config: mapWebchatConfig(row),
    asset: { kind, key, url },
  };
}

export async function getWebchatAsset(customerUser, configId, assetKey) {
  assertChannelConfigId(configId);
  await assertCcaasPurchased(customerUser.organizationId);

  const key = path.basename(String(assetKey || ""));
  if (!key || key !== assetKey || key.includes("..")) {
    const error = new Error("Asset not found.");
    error.statusCode = 404;
    throw error;
  }

  const existing = await repo.getWebchatChannelConfigById(
    pool,
    customerUser.organizationId,
    configId,
  );
  if (!existing) {
    const error = new Error("Web Chat configuration not found.");
    error.statusCode = 404;
    throw error;
  }

  const filePath = path.join(orgUploadDir(customerUser.organizationId, configId), key);
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(key).toLowerCase();
    const contentType = ext === ".png" ? "image/png" : "image/jpeg";
    return { data, contentType };
  } catch {
    const error = new Error("Asset not found.");
    error.statusCode = 404;
    throw error;
  }
}
