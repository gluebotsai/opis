export const WEBCHAT_FONTS = [
  { id: "Inter", google: "Inter" },
  { id: "Roboto", google: "Roboto" },
  { id: "Open Sans", google: "Open+Sans" },
  { id: "Lato", google: "Lato" },
  { id: "Poppins", google: "Poppins" },
  { id: "Nunito", google: "Nunito" },
  { id: "Source Sans 3", google: "Source+Sans+3" },
];

export function ensureWebchatFontLoaded(fontName) {
  if (typeof document === "undefined") return;
  const entry = WEBCHAT_FONTS.find((font) => font.id === fontName) || WEBCHAT_FONTS[0];
  const linkId = `webchat-gf-${entry.google}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${entry.google}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

export function webchatFontFamily(fontName) {
  const safe = String(fontName || "Inter").replace(/["']/g, "");
  return `"${safe}", system-ui, sans-serif`;
}

export const BOT_AVATAR_PRESETS = [
  { id: "orange", color: "#F97316" },
  { id: "purple", color: "#8B5CF6" },
  { id: "green", color: "#22C55E" },
  { id: "sky", color: "#38BDF8" },
  { id: "amber", color: "#FBBF24" },
  { id: "violet", color: "#6D28D9" },
];

export const BACKGROUND_PATTERNS = [
  { id: "none", label: "None" },
  { id: "gradient-violet", label: "Violet glow" },
  { id: "dots-light", label: "Light dots" },
  { id: "dots-dark", label: "Dark dots" },
  { id: "texture-mint", label: "Mint" },
  { id: "texture-rose", label: "Rose" },
  { id: "texture-teal", label: "Teal" },
  { id: "texture-slate", label: "Slate" },
];

export const NOTIFICATION_SOUNDS = [
  { id: "ethereal", label: "Ethereal" },
  { id: "chime", label: "Chime" },
  { id: "soft-ping", label: "Soft ping" },
  { id: "none", label: "None" },
];

export const TRACKER_TYPES = [
  { id: "page_visit", label: "Page visit" },
  { id: "time_on_site", label: "Time on site" },
  { id: "exit_intent", label: "Exit intent" },
  { id: "scroll_depth", label: "Scroll depth" },
];

export const TRACKER_DELAYS = [
  { id: "none", label: "No Delay" },
  { id: "3s", label: "3 seconds" },
  { id: "5s", label: "5 seconds" },
  { id: "10s", label: "10 seconds" },
  { id: "30s", label: "30 seconds" },
];

export const DEFAULT_PERSONALISATION = {
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
  primaryForm: null,
};

export const DEFAULT_PRIMARY_FORM = {
  consentEnabled: false,
  consentLanguage: "browser",
  consentMessage:
    "We use the information you share with us to help address your customer service issues. By clicking on \"Yes, I agree\", you give us consent to follow up via email or phone.",
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
  next.prechatButtonBg = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(next.prechatButtonBg || ""))
    ? String(next.prechatButtonBg).toUpperCase()
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

export function mergePersonalisationClient(raw) {
  const merged = { ...DEFAULT_PERSONALISATION, ...(raw && typeof raw === "object" ? raw : {}) };
  merged.primaryForm = normalizePrimaryForm(merged.primaryForm);
  return merged;
}

export { normalizePrimaryForm };

export function headerBackground(p) {
  if (p.brandColourMode === "gradient") {
    return `linear-gradient(135deg, ${p.chatHeaderGradientFrom}, ${p.chatHeaderGradientTo})`;
  }
  return p.chatHeaderColour;
}

export function fabBackground(p) {
  if (p.brandColourMode === "gradient") {
    return `linear-gradient(135deg, ${p.chatIconGradientFrom}, ${p.chatIconGradientTo})`;
  }
  return p.chatIconColour;
}

export function cornerRadiusPx(roundedCorners) {
  const t = Math.max(0, Math.min(100, Number(roundedCorners) || 0)) / 100;
  return Math.round(4 + t * 20);
}

export function backgroundPatternStyle(patternId) {
  switch (patternId) {
    case "gradient-violet":
      return {
        backgroundImage: "linear-gradient(160deg, #ede9fe 0%, #dbeafe 50%, #f5f3ff 100%)",
      };
    case "dots-light":
      return {
        backgroundColor: "#f3f4f6",
        backgroundImage: "radial-gradient(#c4c4c4 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      };
    case "dots-dark":
      return {
        backgroundColor: "#1e3a5f",
        backgroundImage: "radial-gradient(rgba(255,255,255,0.25) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      };
    case "texture-mint":
      return { backgroundColor: "#ecfdf5" };
    case "texture-rose":
      return { backgroundColor: "#fff1f2" };
    case "texture-teal":
      return { backgroundColor: "#f0fdfa" };
    case "texture-slate":
      return { backgroundColor: "#f1f5f9" };
    default:
      return { backgroundColor: "#ffffff" };
  }
}
