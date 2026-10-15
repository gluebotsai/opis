import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  Check,
  CircleAlert,
  Loader2,
  Mail,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";

import {
  SetupPageHeader,
  SetupStatusBadge,
} from "../../../components/customer/setup/SetupPageChrome.jsx";
import { useCustomerDashboard } from "../../../hooks/useCustomerDashboard.js";
import {
  EMAIL_CHANNEL_PRODUCT_IDS,
  getEmailEligibleProductCatalog,
  getProductName,
} from "../../../lib/productCatalog.js";
import {
  confirmEmailDomain,
  createEmailChannelConfig,
  deleteEmailChannelConfig,
  getEmailChannelConfig,
  startEmailOAuthConnect,
  updateEmailChannelConfig,
  verifyEmailChannelConfig,
} from "../../../lib/setup/setupApi.js";

const EMAIL_ALLOWED = new Set(EMAIL_CHANNEL_PRODUCT_IDS);
const CCAAS_PRODUCT_ID = "contact-center";

const INTEGRATION_METHODS = [
  {
    id: "third_party",
    label: "Third-party provider",
    description: "Connect Google, Microsoft, Yahoo, or enter SMTP credentials.",
  },
  {
    id: "custom_domain",
    label: "Your own domain",
    description: "Use mailboxes on a domain you own, with DNS verification.",
  },
  {
    id: "hosted",
    label: "Hosted with us",
    description: "Request a mailbox on vectone.tech.",
  },
];

const OAUTH_PROVIDERS = [
  { id: "google", label: "Google", title: "Sign in with Google" },
  { id: "microsoft", label: "Microsoft", title: "Sign in with Microsoft" },
  { id: "yahoo", label: "Yahoo", title: "Sign in with Yahoo" },
];

const CCAAS_HANDLERS = [
  {
    id: "bot",
    label: "Bot",
    description: "Contact Centre AI replies to this mailbox. Inbox stays in CCaaS.",
    icon: Bot,
  },
  {
    id: "human",
    label: "Human agent",
    description: "Live agents handle this mailbox in Contact Centre.",
    icon: UserRound,
  },
  {
    id: "bot_then_human",
    label: "Bot then Human",
    description: "Bot replies first; escalate to a human agent when needed.",
    icon: Users,
  },
];

export function ccaasHandlerLabel(handler) {
  if (handler === "bot") return "Bot";
  if (handler === "human") return "Human";
  if (handler === "bot_then_human") return "Bot → Human";
  return "";
}

function filterEmailProductIds(productIds = []) {
  return (Array.isArray(productIds) ? productIds : []).filter((id) => EMAIL_ALLOWED.has(id));
}

function ProviderIcon({ provider }) {
  if (provider === "google") {
    return (
      <svg aria-hidden height="28" viewBox="0 0 24 24" width="28">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
    );
  }
  if (provider === "microsoft") {
    return (
      <svg aria-hidden height="28" viewBox="0 0 23 23" width="28">
        <path d="M1 1h10v10H1z" fill="#f25022" />
        <path d="M12 1h10v10H12z" fill="#7fba00" />
        <path d="M1 12h10v10H1z" fill="#00a4ef" />
        <path d="M12 12h10v10H12z" fill="#ffb900" />
      </svg>
    );
  }
  return (
    <svg aria-hidden height="28" viewBox="0 0 24 24" width="28">
      <circle cx="12" cy="12" fill="#6001D2" r="12" />
      <path
        d="M16.4 8.2c-.4-.5-1-.8-1.7-.8H9.3c-.7 0-1.3.3-1.7.8-.4.5-.6 1.1-.5 1.8l.9 5.1c.1.7.7 1.2 1.4 1.2h4.2c.7 0 1.3-.5 1.4-1.2l.9-5.1c.1-.7-.1-1.3-.5-1.8zm-2.2 5.2h-4.4l-.3-1.7h5l-.3 1.7zm.5-2.8h-5.4l-.2-1.3h5.8l-.2 1.3z"
        fill="#fff"
      />
    </svg>
  );
}

function FieldError({ message }) {
  if (!message) return null;
  return (
    <p className="setup-field-error" role="alert">
      <CircleAlert aria-hidden size={14} />
      <span>{message}</span>
    </p>
  );
}

function statusTone(status) {
  if (status === "active") return "success";
  if (status === "pending") return "warning";
  return "neutral";
}

function statusLabel(status) {
  if (status === "active") return "Active";
  if (status === "pending") return "Pending";
  if (status === "inactive") return "Inactive";
  return status || "Unknown";
}

function methodLabel(providerType) {
  return INTEGRATION_METHODS.find((method) => method.id === providerType)?.label || providerType;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidConfigId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

const EMPTY_WIZARD = {
  productIds: [],
  ccaasHandler: "",
  providerType: "",
  thirdPartyMode: "oauth",
  oauthProvider: "",
  domain: "",
  senderEmail: "",
  requestedLocalPart: "",
  hostedDomain: "vectone.tech",
  smtpHost: "",
  smtpPort: "587",
  smtpSecure: false,
  smtpUser: "",
  smtpPass: "",
  imapHost: "",
  imapPort: "993",
  imapSecure: true,
  name: "",
  senderName: "",
  replyTo: "",
};

function OptionCard({ active, description, icon: Icon, label, onClick, disabled }) {
  return (
    <button
      className={`setup-option-card ${active ? "setup-option-card--active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {Icon ? (
        <span className="setup-option-card__icon">
          <Icon size={20} />
        </span>
      ) : null}
      <span className="setup-option-card__body">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </span>
      {active ? (
        <span className="setup-option-card__check">
          <Check size={16} />
        </span>
      ) : null}
    </button>
  );
}

export function SetupEmailConfigPage() {
  const { configId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isNew = configId === "new";
  const hasValidConfigId = isValidConfigId(configId);
  const { dashboard } = useCustomerDashboard();

  useEffect(() => {
    if (!isNew && !hasValidConfigId) {
      navigate("/customer/setup/communication", { replace: true });
    }
  }, [hasValidConfigId, isNew, navigate]);

  const eligibleProducts = useMemo(
    () => getEmailEligibleProductCatalog(dashboard?.activeProducts),
    [dashboard?.activeProducts],
  );
  const hasEmailEligibleProducts = eligibleProducts.length > 0;

  const [config, setConfig] = useState(null);
  const [wizard, setWizard] = useState(EMPTY_WIZARD);
  const [wizardStep, setWizardStep] = useState(0);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [attemptedContinue, setAttemptedContinue] = useState(false);
  const [dnsInfo, setDnsInfo] = useState(null);
  const [oauthNotice, setOauthNotice] = useState("");

  const needsCcaasHandler = wizard.productIds.includes(CCAAS_PRODUCT_ID);

  const wizardSteps = useMemo(() => {
    const steps = [
      {
        id: "products",
        label: "Products",
        subtitle: "Which purchased products use this mailbox.",
      },
    ];
    if (needsCcaasHandler) {
      steps.push({
        id: "handling",
        label: "Handling",
        subtitle: "How Contact Centre should use this mailbox.",
      });
    }
    steps.push(
      {
        id: "method",
        label: "Method",
        subtitle: "How you connect the mailbox.",
      },
      {
        id: "connect",
        label: "Connect",
        subtitle: "Sign in with a provider or enter SMTP details.",
      },
      {
        id: "details",
        label: "Details",
        subtitle: "Name this configuration and optional sender details.",
      },
    );
    return steps;
  }, [needsCcaasHandler]);

  const currentStep = wizardSteps[wizardStep] || wizardSteps[0];

  useEffect(() => {
    if (wizardStep >= wizardSteps.length) {
      setWizardStep(Math.max(0, wizardSteps.length - 1));
    }
  }, [wizardStep, wizardSteps.length]);

  useEffect(() => {
    const oauthParam = searchParams.get("oauth");
    if (oauthParam === "success") {
      setOauthNotice("Email account connected successfully.");
      searchParams.delete("oauth");
      setSearchParams(searchParams, { replace: true });
      if (!isNew && configId) {
        getEmailChannelConfig(configId)
          .then((row) => setConfig(row))
          .catch(() => {});
      }
    } else if (oauthParam === "error") {
      const raw = searchParams.get("message") || "Email provider sign-in was cancelled or failed.";
      let message = raw;
      try {
        message = decodeURIComponent(raw);
      } catch {
        message = raw;
      }
      setError(message);
      searchParams.delete("oauth");
      searchParams.delete("message");
      setSearchParams(searchParams, { replace: true });
    }
  }, [configId, isNew, searchParams, setSearchParams]);

  useEffect(() => {
    if (isNew || !hasValidConfigId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const row = await getEmailChannelConfig(configId);
        if (cancelled) return;
        setConfig(row);
        setWizard({
          productIds: filterEmailProductIds(row.productIds),
          ccaasHandler: row.ccaasHandler || "",
          providerType: row.providerType || "",
          thirdPartyMode: row.thirdPartyMode || "oauth",
          oauthProvider: row.oauthProvider || "",
          domain: row.domain || "",
          senderEmail: row.senderEmail || "",
          requestedLocalPart: row.requestedLocalPart || "",
          hostedDomain: row.hostedDomain || "vectone.tech",
          smtpHost: row.smtpHost || "",
          smtpPort: String(row.smtpPort || 587),
          smtpSecure: Boolean(row.smtpSecure),
          smtpUser: "",
          smtpPass: "",
          imapHost: row.imapHost || "",
          imapPort: String(row.imapPort || 993),
          imapSecure: row.imapSecure !== false,
          name: row.name || "",
          senderName: row.senderName || "",
          replyTo: row.replyTo || "",
        });
        setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load email configuration.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configId, hasValidConfigId, isNew]);

  function updateWizard(key, value) {
    setWizard((current) => ({ ...current, [key]: value }));
  }

  function toggleProduct(productId) {
    setWizard((current) => {
      const set = new Set(current.productIds);
      if (set.has(productId)) set.delete(productId);
      else set.add(productId);
      const productIds = [...set];
      const stillCcaas = productIds.includes(CCAAS_PRODUCT_ID);
      return {
        ...current,
        productIds,
        ccaasHandler: stillCcaas ? current.ccaasHandler : "",
      };
    });
  }

  function selectProviderType(providerType) {
    setWizard((current) => ({
      ...EMPTY_WIZARD,
      productIds: current.productIds,
      ccaasHandler: current.ccaasHandler,
      providerType,
      thirdPartyMode: providerType === "third_party" ? "oauth" : current.thirdPartyMode,
      oauthProvider: "",
    }));
    setDnsInfo(null);
  }

  function selectSmtpOther() {
    setWizard((current) => ({
      ...current,
      thirdPartyMode: "smtp",
      oauthProvider: "",
    }));
  }

  async function startProviderOAuth(provider) {
    setError("");
    setActionLoading(provider);
    try {
      let id = isNew ? null : configId;
      if (isNew) {
        const label = OAUTH_PROVIDERS.find((entry) => entry.id === provider)?.label || provider;
        const created = await createEmailChannelConfig({
          name: `${label} mailbox`,
          productIds: wizard.productIds,
          ccaasHandler: needsCcaasHandler ? wizard.ccaasHandler : undefined,
          providerType: "third_party",
          thirdPartyMode: "oauth",
          oauthProvider: provider,
        });
        id = created.id;
      } else {
        await updateEmailChannelConfig(configId, {
          thirdPartyMode: "oauth",
          oauthProvider: provider,
          productIds: wizard.productIds,
          ccaasHandler: needsCcaasHandler ? wizard.ccaasHandler : null,
        });
      }
      const result = await startEmailOAuthConnect(id, { provider });
      if (!result?.url) {
        throw new Error("OAuth provider did not return a sign-in URL.");
      }
      window.location.href = result.url;
    } catch (err) {
      setError(err.message || "Failed to start email provider sign-in.");
      setActionLoading("");
    }
  }

  function handleOAuthConnect(provider) {
    void startProviderOAuth(provider || config?.oauthProvider || wizard.oauthProvider || "microsoft");
  }

  const productError = useMemo(() => {
    if (!hasEmailEligibleProducts) {
      return "Purchase Contact Centre or Campaign to configure email.";
    }
    if (wizard.productIds.length) return "";
    return attemptedContinue && currentStep?.id === "products"
      ? "Select at least one product."
      : "";
  }, [attemptedContinue, currentStep?.id, hasEmailEligibleProducts, wizard.productIds.length]);

  const handlerError = useMemo(() => {
    if (!needsCcaasHandler || wizard.ccaasHandler) return "";
    return attemptedContinue && currentStep?.id === "handling"
      ? "Choose Bot, Human agent, or Bot then Human."
      : "";
  }, [attemptedContinue, currentStep?.id, needsCcaasHandler, wizard.ccaasHandler]);

  const methodError = useMemo(() => {
    if (wizard.providerType) return "";
    return attemptedContinue && currentStep?.id === "method"
      ? "Choose an integration method to continue."
      : "";
  }, [attemptedContinue, currentStep?.id, wizard.providerType]);

  const integrationError = useMemo(() => {
    if (currentStep?.id !== "connect" || !attemptedContinue) return "";
    if (wizard.providerType === "custom_domain") {
      if (!wizard.domain.trim()) return "Domain is required.";
      if (!wizard.senderEmail.trim()) return "Mailbox email address is required.";
    }
    if (wizard.providerType === "hosted" && !wizard.requestedLocalPart.trim()) {
      return "Mailbox name is required.";
    }
    if (wizard.providerType === "third_party" && wizard.thirdPartyMode === "smtp") {
      if (!wizard.smtpHost.trim()) return "SMTP host is required.";
      if (!wizard.smtpUser.trim()) return "SMTP username is required.";
      if (!wizard.smtpPass.trim() && isNew) return "SMTP password is required.";
      if (!wizard.senderEmail.trim()) return "Sender email is required.";
    }
    return "";
  }, [attemptedContinue, currentStep?.id, isNew, wizard]);

  const detailsError = useMemo(() => {
    if (currentStep?.id !== "details" || !attemptedContinue) return "";
    if (!wizard.name.trim()) return "Configuration name is required.";
    if (needsCcaasHandler && !wizard.ccaasHandler) {
      return "Choose how Contact Centre should handle this mailbox.";
    }
    return "";
  }, [attemptedContinue, currentStep?.id, needsCcaasHandler, wizard.ccaasHandler, wizard.name]);

  function canAdvanceFromStepId(stepId) {
    if (stepId === "products") return hasEmailEligibleProducts && wizard.productIds.length > 0;
    if (stepId === "handling") return Boolean(wizard.ccaasHandler);
    if (stepId === "method") return Boolean(wizard.providerType);
    if (stepId === "connect") {
      if (wizard.providerType === "third_party" && wizard.thirdPartyMode !== "smtp") return false;
      if (wizard.providerType === "custom_domain") {
        return Boolean(wizard.domain.trim() && wizard.senderEmail.trim());
      }
      if (wizard.providerType === "hosted") return Boolean(wizard.requestedLocalPart.trim());
      if (wizard.providerType === "third_party" && wizard.thirdPartyMode === "smtp") {
        return Boolean(
          wizard.smtpHost.trim() &&
            wizard.smtpUser.trim() &&
            (wizard.smtpPass.trim() || !isNew) &&
            wizard.senderEmail.trim(),
        );
      }
      return true;
    }
    if (stepId === "details") {
      return Boolean(wizard.name.trim()) && (!needsCcaasHandler || Boolean(wizard.ccaasHandler));
    }
    return true;
  }

  function goNext() {
    setAttemptedContinue(true);
    if (!canAdvanceFromStepId(currentStep?.id)) return;
    setAttemptedContinue(false);
    setWizardStep((step) => Math.min(step + 1, wizardSteps.length - 1));
  }

  function goBack() {
    setAttemptedContinue(false);
    setWizardStep((step) => Math.max(step - 1, 0));
  }

  function buildCreatePayload() {
    const payload = {
      name: wizard.name.trim(),
      productIds: wizard.productIds,
      providerType: wizard.providerType,
      senderName: wizard.senderName.trim() || undefined,
      replyTo: wizard.replyTo.trim() || undefined,
    };
    if (needsCcaasHandler) payload.ccaasHandler = wizard.ccaasHandler;
    if (wizard.providerType === "third_party") {
      payload.thirdPartyMode = wizard.thirdPartyMode;
      if (wizard.thirdPartyMode === "oauth") {
        payload.oauthProvider = wizard.oauthProvider || "microsoft";
      }
      if (wizard.thirdPartyMode === "smtp") {
        Object.assign(payload, {
          senderEmail: wizard.senderEmail.trim(),
          smtpHost: wizard.smtpHost.trim(),
          smtpPort: Number(wizard.smtpPort) || 587,
          smtpSecure: wizard.smtpSecure,
          smtpUser: wizard.smtpUser.trim(),
          smtpPass: wizard.smtpPass,
          imapHost: wizard.imapHost.trim() || undefined,
          imapPort: Number(wizard.imapPort) || 993,
          imapSecure: wizard.imapSecure,
        });
      }
    } else if (wizard.providerType === "custom_domain") {
      payload.domain = wizard.domain.trim();
      payload.senderEmail = wizard.senderEmail.trim();
    } else if (wizard.providerType === "hosted") {
      payload.requestedLocalPart = wizard.requestedLocalPart.trim();
      payload.hostedDomain = wizard.hostedDomain;
    }
    return payload;
  }

  async function handleSaveNew() {
    setAttemptedContinue(true);
    if (!canAdvanceFromStepId("details")) return;
    setSaving(true);
    setError("");
    try {
      const created = await createEmailChannelConfig(buildCreatePayload());
      navigate(`/customer/setup/communication/email/${created.id}`, { replace: true });
    } catch (err) {
      setError(err.message || "Failed to save email configuration.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveExisting() {
    if (needsCcaasHandler && !wizard.ccaasHandler) {
      setError("Choose how Contact Centre should handle this mailbox.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: wizard.name.trim(),
        productIds: wizard.productIds,
        ccaasHandler: needsCcaasHandler ? wizard.ccaasHandler : null,
        senderName: wizard.senderName.trim() || null,
        replyTo: wizard.replyTo.trim() || null,
      };
      if (config?.providerType === "custom_domain") {
        payload.domain = wizard.domain.trim();
        payload.senderEmail = wizard.senderEmail.trim();
      }
      if (config?.providerType === "hosted") {
        payload.requestedLocalPart = wizard.requestedLocalPart.trim();
      }
      if (config?.providerType === "third_party" && wizard.thirdPartyMode === "smtp") {
        Object.assign(payload, {
          thirdPartyMode: "smtp",
          senderEmail: wizard.senderEmail.trim(),
          smtpHost: wizard.smtpHost.trim(),
          smtpPort: Number(wizard.smtpPort) || 587,
          smtpSecure: wizard.smtpSecure,
          imapHost: wizard.imapHost.trim() || null,
          imapPort: Number(wizard.imapPort) || 993,
          imapSecure: wizard.imapSecure,
        });
        if (wizard.smtpUser.trim()) payload.smtpUser = wizard.smtpUser.trim();
        if (wizard.smtpPass.trim()) payload.smtpPass = wizard.smtpPass;
      }
      const updated = await updateEmailChannelConfig(configId, payload);
      setConfig(updated);
      setWizard((current) => ({
        ...current,
        ccaasHandler: updated.ccaasHandler || "",
        productIds: filterEmailProductIds(updated.productIds),
      }));
    } catch (err) {
      setError(err.message || "Failed to update email configuration.");
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    setActionLoading("verify");
    setError("");
    try {
      const result = await verifyEmailChannelConfig(configId);
      if (result.dnsInstructions) setDnsInfo(result.dnsInstructions);
      setConfig(await getEmailChannelConfig(configId));
    } catch (err) {
      setError(err.message || "Verification failed.");
    } finally {
      setActionLoading("");
    }
  }

  async function handleConfirmDomain() {
    setActionLoading("confirm");
    setError("");
    try {
      await confirmEmailDomain(configId);
      setConfig(await getEmailChannelConfig(configId));
    } catch (err) {
      setError(err.message || "Could not confirm domain.");
    } finally {
      setActionLoading("");
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this email configuration?")) return;
    setActionLoading("delete");
    try {
      await deleteEmailChannelConfig(configId);
      navigate("/customer/setup/communication");
    } catch (err) {
      setError(err.message || "Failed to delete configuration.");
      setActionLoading("");
    }
  }

  function renderHandlerCards({ value, onSelect }) {
    return (
      <div className="setup-option-grid">
        {CCAAS_HANDLERS.map((handler) => (
          <OptionCard
            active={value === handler.id}
            description={handler.description}
            icon={handler.icon}
            key={handler.id}
            label={handler.label}
            onClick={() => onSelect(handler.id)}
          />
        ))}
      </div>
    );
  }

  function renderSmtpFields() {
    return (
      <div className="setup-form-grid" style={{ marginTop: "16px" }}>
        <label className="setup-form-field">
          <span>Sender email</span>
          <input
            onChange={(event) => updateWizard("senderEmail", event.target.value)}
            type="email"
            value={wizard.senderEmail}
          />
        </label>
        <label className="setup-form-field">
          <span>SMTP host</span>
          <input
            onChange={(event) => updateWizard("smtpHost", event.target.value)}
            value={wizard.smtpHost}
          />
        </label>
        <label className="setup-form-field">
          <span>SMTP port</span>
          <input
            onChange={(event) => updateWizard("smtpPort", event.target.value)}
            type="number"
            value={wizard.smtpPort}
          />
        </label>
        <label className="setup-form-field setup-form-field--checkbox">
          <input
            checked={wizard.smtpSecure}
            onChange={(event) => updateWizard("smtpSecure", event.target.checked)}
            type="checkbox"
          />
          <span>Use SSL/TLS for SMTP</span>
        </label>
        <label className="setup-form-field">
          <span>SMTP username</span>
          <input
            onChange={(event) => updateWizard("smtpUser", event.target.value)}
            placeholder={config?.hasSmtpCredentials ? "Leave blank to keep existing" : ""}
            value={wizard.smtpUser}
          />
        </label>
        <label className="setup-form-field">
          <span>SMTP password</span>
          <input
            onChange={(event) => updateWizard("smtpPass", event.target.value)}
            placeholder={config?.hasSmtpCredentials ? "Leave blank to keep existing" : ""}
            type="password"
            value={wizard.smtpPass}
          />
        </label>
        <label className="setup-form-field">
          <span>IMAP host (optional)</span>
          <input
            onChange={(event) => updateWizard("imapHost", event.target.value)}
            value={wizard.imapHost}
          />
        </label>
        <label className="setup-form-field">
          <span>IMAP port</span>
          <input
            onChange={(event) => updateWizard("imapPort", event.target.value)}
            type="number"
            value={wizard.imapPort}
          />
        </label>
      </div>
    );
  }

  function renderWizardStep() {
    if (currentStep?.id === "products") {
      return (
        <div className="setup-step-body">
          <p className="setup-step-lead">
            Select Contact Centre and/or Campaign. Inbox and routing stay in each product.
          </p>
          {hasEmailEligibleProducts ? (
            <div className="setup-option-grid">
              {eligibleProducts.map((product) => (
                <OptionCard
                  active={wizard.productIds.includes(product.id)}
                  description={
                    product.id === CCAAS_PRODUCT_ID
                      ? "Configure a mailbox for Contact Centre (bot or human)."
                      : "Configure a mailbox for Campaign Management."
                  }
                  key={product.id}
                  label={product.name}
                  onClick={() => toggleProduct(product.id)}
                />
              ))}
            </div>
          ) : (
            <p className="setup-step-muted">
              Purchase Contact Centre or Campaign to configure email.
            </p>
          )}
          <FieldError message={productError} />
        </div>
      );
    }

    if (currentStep?.id === "handling") {
      return (
        <div className="setup-step-body">
          <p className="setup-step-lead">
            How should Contact Centre use this mailbox? My Account only stores this choice —
            replies and routing run in CCaaS.
          </p>
          {renderHandlerCards({
            value: wizard.ccaasHandler,
            onSelect: (id) => updateWizard("ccaasHandler", id),
          })}
          <FieldError message={handlerError} />
        </div>
      );
    }

    if (currentStep?.id === "method") {
      return (
        <div className="setup-step-body">
          <p className="setup-step-lead">Choose how you will connect the mailbox.</p>
          <div className="setup-option-grid">
            {INTEGRATION_METHODS.map((method) => (
              <OptionCard
                active={wizard.providerType === method.id}
                description={method.description}
                key={method.id}
                label={method.label}
                onClick={() => selectProviderType(method.id)}
              />
            ))}
          </div>
          <FieldError message={methodError} />
        </div>
      );
    }

    if (currentStep?.id === "connect") {
      if (wizard.providerType === "third_party") {
        return (
          <div className="setup-step-body">
            <p className="setup-step-lead">
              Sign in with a provider. We store the connection here; send and receive happen in the
              product.
            </p>
            <div className="setup-oauth-providers">
              {OAUTH_PROVIDERS.map((provider) => {
                const busy = actionLoading === provider.id;
                return (
                  <button
                    className={`setup-oauth-provider ${
                      wizard.oauthProvider === provider.id ? "setup-oauth-provider--active" : ""
                    }`}
                    disabled={Boolean(actionLoading)}
                    key={provider.id}
                    onClick={() => startProviderOAuth(provider.id)}
                    title={provider.title}
                    type="button"
                  >
                    <span className="setup-oauth-provider__icon">
                      {busy ? (
                        <Loader2 className="spin" size={28} />
                      ) : (
                        <ProviderIcon provider={provider.id} />
                      )}
                    </span>
                    <span className="setup-oauth-provider__label">{provider.label}</span>
                  </button>
                );
              })}
              <button
                className={`setup-oauth-provider ${
                  wizard.thirdPartyMode === "smtp" ? "setup-oauth-provider--active" : ""
                }`}
                disabled={Boolean(actionLoading)}
                onClick={selectSmtpOther}
                title="Enter SMTP / IMAP credentials"
                type="button"
              >
                <span className="setup-oauth-provider__icon">
                  <Mail size={28} />
                </span>
                <span className="setup-oauth-provider__label">Other / SMTP</span>
              </button>
            </div>
            {wizard.thirdPartyMode === "smtp" ? (
              renderSmtpFields()
            ) : (
              <p className="setup-step-muted">
                Click a provider to open its sign-in page. After you choose an account, we return
                here with the mailbox connected.
              </p>
            )}
            <FieldError message={integrationError} />
          </div>
        );
      }

      if (wizard.providerType === "custom_domain") {
        return (
          <div className="setup-step-body">
            <div className="setup-form-grid">
              <label className="setup-form-field">
                <span>Domain</span>
                <input
                  onChange={(event) => updateWizard("domain", event.target.value)}
                  placeholder="company.com"
                  value={wizard.domain}
                />
              </label>
              <label className="setup-form-field">
                <span>Mailbox email</span>
                <input
                  onChange={(event) => updateWizard("senderEmail", event.target.value)}
                  placeholder="support@company.com"
                  type="email"
                  value={wizard.senderEmail}
                />
              </label>
            </div>
            <FieldError message={integrationError} />
          </div>
        );
      }

      if (wizard.providerType === "hosted") {
        return (
          <div className="setup-step-body">
            <div className="setup-form-grid">
              <label className="setup-form-field">
                <span>Mailbox name</span>
                <input
                  onChange={(event) => updateWizard("requestedLocalPart", event.target.value)}
                  placeholder="support"
                  value={wizard.requestedLocalPart}
                />
              </label>
              <label className="setup-form-field">
                <span>Domain</span>
                <input disabled readOnly value={wizard.hostedDomain} />
              </label>
            </div>
            <FieldError message={integrationError} />
          </div>
        );
      }
    }

    if (currentStep?.id === "details") {
      return (
        <div className="setup-step-body">
          <div className="setup-form-grid">
            <label className="setup-form-field">
              <span>Configuration name</span>
              <input
                onChange={(event) => updateWizard("name", event.target.value)}
                value={wizard.name}
              />
            </label>
            <label className="setup-form-field">
              <span>Integration method</span>
              <input disabled readOnly value={methodLabel(wizard.providerType)} />
            </label>
            <label className="setup-form-field">
              <span>Sender display name (optional)</span>
              <input
                onChange={(event) => updateWizard("senderName", event.target.value)}
                placeholder="e.g. Support Team"
                value={wizard.senderName}
              />
            </label>
            <label className="setup-form-field">
              <span>Reply-to (optional)</span>
              <input
                onChange={(event) => updateWizard("replyTo", event.target.value)}
                type="email"
                value={wizard.replyTo}
              />
            </label>
          </div>
          {needsCcaasHandler ? (
            <div className="setup-section-block">
              <h3 className="setup-section-title">Contact Centre handling</h3>
              <p className="setup-step-muted">
                Stored for CCaaS only. Inbox and replies are not handled in My Account.
              </p>
              {renderHandlerCards({
                value: wizard.ccaasHandler,
                onSelect: (id) => updateWizard("ccaasHandler", id),
              })}
            </div>
          ) : null}
          <FieldError message={detailsError} />
        </div>
      );
    }

    return null;
  }

  function renderEditPanel() {
    const providerType = config?.providerType;
    return (
      <>
        <div className="setup-form-grid">
          <label className="setup-form-field">
            <span>Configuration name</span>
            <input
              onChange={(event) => updateWizard("name", event.target.value)}
              value={wizard.name}
            />
          </label>
          <label className="setup-form-field">
            <span>Integration method</span>
            <input disabled readOnly value={methodLabel(providerType)} />
          </label>
          <label className="setup-form-field">
            <span>Sender display name (optional)</span>
            <input
              onChange={(event) => updateWizard("senderName", event.target.value)}
              placeholder="e.g. Support Team"
              value={wizard.senderName}
            />
          </label>
          <label className="setup-form-field">
            <span>Reply-to (optional)</span>
            <input
              onChange={(event) => updateWizard("replyTo", event.target.value)}
              type="email"
              value={wizard.replyTo}
            />
          </label>
        </div>

        <div className="setup-section-block">
          <h3 className="setup-section-title">Products</h3>
          <div className="setup-option-grid">
            {eligibleProducts.map((product) => (
              <OptionCard
                active={wizard.productIds.includes(product.id)}
                key={product.id}
                label={product.name}
                onClick={() => toggleProduct(product.id)}
              />
            ))}
          </div>
          {!wizard.productIds.length && hasEmailEligibleProducts ? (
            <FieldError message="Select at least one product." />
          ) : null}
        </div>

        {needsCcaasHandler ? (
          <div className="setup-section-block">
            <h3 className="setup-section-title">How should Contact Centre use this mailbox?</h3>
            <p className="setup-step-muted">
              My Account only stores this. Bot replies and human routing run in Contact Centre.
            </p>
            {renderHandlerCards({
              value: wizard.ccaasHandler,
              onSelect: (id) => updateWizard("ccaasHandler", id),
            })}
          </div>
        ) : null}

        {providerType === "third_party" && config?.thirdPartyMode === "oauth" ? (
          <div className="setup-section-block">
            <h3 className="setup-section-title">Mailbox connection</h3>
            <p className="setup-step-lead">
              {config.oauthConnected
                ? `Connected as ${config.oauthAccountEmail || config.senderEmail}`
                : "Not connected yet — choose a provider to sign in."}
            </p>
            {!config.oauthConnected ? (
              <div className="setup-oauth-providers">
                {OAUTH_PROVIDERS.map((provider) => {
                  const busy = actionLoading === provider.id;
                  return (
                    <button
                      className={`setup-oauth-provider ${
                        (config.oauthProvider || wizard.oauthProvider) === provider.id
                          ? "setup-oauth-provider--active"
                          : ""
                      }`}
                      disabled={Boolean(actionLoading)}
                      key={provider.id}
                      onClick={() => handleOAuthConnect(provider.id)}
                      title={provider.title}
                      type="button"
                    >
                      <span className="setup-oauth-provider__icon">
                        {busy ? (
                          <Loader2 className="spin" size={28} />
                        ) : (
                          <ProviderIcon provider={provider.id} />
                        )}
                      </span>
                      <span className="setup-oauth-provider__label">{provider.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <button
                className="secondary-button"
                disabled={actionLoading === "verify"}
                onClick={handleVerify}
                type="button"
              >
                {actionLoading === "verify" ? <Loader2 className="spin" size={16} /> : null}
                Test connection
              </button>
            )}
          </div>
        ) : null}

        {providerType === "third_party" && config?.thirdPartyMode === "smtp" ? (
          <div className="setup-section-block">
            <h3 className="setup-section-title">SMTP / IMAP</h3>
            {renderSmtpFields()}
          </div>
        ) : null}

        {providerType === "custom_domain" ? (
          <div className="setup-section-block">
            <h3 className="setup-section-title">Domain</h3>
            <div className="setup-form-grid">
              <label className="setup-form-field">
                <span>Domain</span>
                <input
                  onChange={(event) => updateWizard("domain", event.target.value)}
                  value={wizard.domain}
                />
              </label>
              <label className="setup-form-field">
                <span>Mailbox email</span>
                <input
                  onChange={(event) => updateWizard("senderEmail", event.target.value)}
                  type="email"
                  value={wizard.senderEmail}
                />
              </label>
            </div>
            {dnsInfo || config.domainVerificationToken ? (
              <p className="setup-step-muted">
                TXT verification token:{" "}
                <code>{dnsInfo?.token || config.domainVerificationToken}</code>
              </p>
            ) : null}
            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
              <button
                className="secondary-button"
                disabled={actionLoading === "confirm"}
                onClick={handleConfirmDomain}
                type="button"
              >
                {actionLoading === "confirm" ? <Loader2 className="spin" size={16} /> : null}
                Mark domain verified
              </button>
            </div>
          </div>
        ) : null}

        {providerType === "hosted" ? (
          <div className="setup-section-block">
            <h3 className="setup-section-title">Hosted mailbox</h3>
            <div className="setup-form-grid">
              <label className="setup-form-field">
                <span>Mailbox name</span>
                <input
                  onChange={(event) => updateWizard("requestedLocalPart", event.target.value)}
                  value={wizard.requestedLocalPart}
                />
              </label>
              <label className="setup-form-field">
                <span>Domain</span>
                <input disabled readOnly value={wizard.hostedDomain} />
              </label>
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "20px" }}>
          <button
            className="primary-button"
            disabled={
              saving ||
              !hasEmailEligibleProducts ||
              !wizard.productIds.length ||
              (needsCcaasHandler && !wizard.ccaasHandler)
            }
            onClick={handleSaveExisting}
            type="button"
          >
            {saving ? <Loader2 className="spin" size={16} /> : null}
            Save changes
          </button>
          <button
            className="secondary-button"
            disabled={actionLoading === "delete"}
            onClick={handleDelete}
            type="button"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </>
    );
  }

  const hideContinueOnOauthConnect =
    currentStep?.id === "connect" &&
    wizard.providerType === "third_party" &&
    wizard.thirdPartyMode !== "smtp";

  return (
    <section className="setup-workspace-page">
      <SetupPageHeader
        actions={
          <button
            className="secondary-button"
            onClick={() => navigate("/customer/setup/communication")}
            type="button"
          >
            <ArrowLeft size={16} />
            Back to channels
          </button>
        }
        copy={
          isNew
            ? "Configure a mailbox for Contact Centre and/or Campaign. Credentials are stored here; inbox and routing stay in the product."
            : "Update mailbox connection and Contact Centre handling. Inbox and routing remain in the product spokes."
        }
        title={isNew ? "Add email configuration" : config?.name || "Email configuration"}
      />

      {error ? <div className="form-error-banner">{error}</div> : null}
      {oauthNotice ? (
        <div className="form-success-banner" style={{ marginBottom: "12px" }}>
          {oauthNotice}
        </div>
      ) : null}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <section className="setup-form-panel">
          {!isNew && config ? (
            <div className="setup-email-summary">
              <div>
                <p className="setup-email-summary__address">
                  {config.oauthConnected || config.senderEmail
                    ? config.senderEmail || config.oauthAccountEmail
                    : "Sender address comes from Google / Microsoft / Yahoo after you connect."}
                </p>
                <div className="setup-chip-row">
                  {filterEmailProductIds(config.productIds).map((productId) => (
                    <span className="setup-chip" key={productId}>
                      {getProductName(productId)}
                    </span>
                  ))}
                  {config.ccaasHandler ? (
                    <span className="setup-chip setup-chip--active">
                      {ccaasHandlerLabel(config.ccaasHandler)}
                    </span>
                  ) : null}
                </div>
              </div>
              <SetupStatusBadge
                status={statusLabel(config.status)}
                tone={statusTone(config.status)}
              />
            </div>
          ) : null}

          {isNew ? (
            <>
              <div className="setup-step-rail" aria-label="Configuration steps">
                {wizardSteps.map((step, index) => (
                  <div
                    className={`setup-step-rail__item ${
                      index === wizardStep ? "setup-step-rail__item--active" : ""
                    } ${index < wizardStep ? "setup-step-rail__item--done" : ""}`}
                    key={step.id}
                  >
                    <span className="setup-step-rail__index">{index + 1}</span>
                    <span className="setup-step-rail__text">
                      <strong>{step.label}</strong>
                      <span>{step.subtitle}</span>
                    </span>
                  </div>
                ))}
              </div>
              {renderWizardStep()}
              <div className="setup-step-actions">
                {wizardStep > 0 ? (
                  <button className="secondary-button" onClick={goBack} type="button">
                    Back
                  </button>
                ) : null}
                {hideContinueOnOauthConnect ? null : wizardStep < wizardSteps.length - 1 ? (
                  <button
                    className="primary-button"
                    disabled={currentStep?.id === "products" && !hasEmailEligibleProducts}
                    onClick={goNext}
                    type="button"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    disabled={
                      saving ||
                      !hasEmailEligibleProducts ||
                      !wizard.productIds.length ||
                      (needsCcaasHandler && !wizard.ccaasHandler)
                    }
                    onClick={handleSaveNew}
                    type="button"
                  >
                    {saving ? <Loader2 className="spin" size={16} /> : null}
                    Save configuration
                  </button>
                )}
              </div>
            </>
          ) : (
            renderEditPanel()
          )}
        </section>
      )}
    </section>
  );
}
