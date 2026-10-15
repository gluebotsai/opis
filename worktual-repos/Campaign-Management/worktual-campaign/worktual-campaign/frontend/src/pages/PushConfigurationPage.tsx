import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  TabletSmartphone,
  Trash2,
  KeyRound,
  Copy,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ContentFadeIn } from "@/components/skeleton";
import {
  fetchAppPushIntegrationKeyStatus,
  fetchPushConfig,
  mintAppPushIntegrationKey,
  savePushConfig,
  testPushConfigSend,
  type AppPushIntegrationKeyStatus,
  type PushConfigBundle,
} from "@/services/configuration.service";
import {
  deactivateAppPushEndpoint,
  fetchAppPushEndpoints,
  registerAppPushDevice,
  type AppPushEndpoint,
} from "@/services/app-push.service";
import {
  deactivateWebPushSubscription,
  fetchWebPushSubscriptions,
  registerWebPushSubscription,
  type WebPushSubscription,
} from "@/services/web-push.service";

const inputClass =
  "w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20";

/** Secret inputs: eye toggle; do not put server masks into the field. */
function SecretInput({
  value,
  onChange,
  disabled,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        className={`${inputClass} pr-10 ${className}`.trim()}
        type={show ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setShow((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-caption hover:text-text-primary disabled:opacity-40"
        aria-label={show ? "Hide secret" : "Show secret"}
      >
        {show ? (
          <EyeOff className="size-4" strokeWidth={1.75} />
        ) : (
          <Eye className="size-4" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}

function secretFormValue(
  settings: Record<string, string>,
  key: string,
  secretsSet: Record<string, boolean> | undefined,
): string {
  // Never put masked •••• back into the input — empty means "keep existing".
  if (secretsSet?.[key]) return "";
  const v = settings[key] || "";
  if (v.includes("•")) return "";
  return v;
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "ready") {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (s === "in_progress") {
    return "bg-amber-50 text-amber-900 border-amber-200";
  }
  if (s === "blocked") {
    return "bg-red-50 text-red-800 border-red-200";
  }
  return "bg-subtle text-text-caption border-border-default";
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        className={`size-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-neutral-300"}`}
      />
      <span className={ok ? "text-text-primary" : "text-text-caption"}>
        {label}
      </span>
    </li>
  );
}

function StepBadge({
  n,
  done,
  label,
}: {
  n: number;
  done: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {done ? (
        <CheckCircle2 className="size-5 text-emerald-600" strokeWidth={1.75} />
      ) : (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">
          {n}
        </span>
      )}
      <h2 className="text-sm font-semibold text-text-primary">{label}</h2>
    </div>
  );
}

/** Line-by-line setup guide for tenants configuring App push. */
function AppPushSetupGuide({
  accountsManaged,
}: {
  accountsManaged: boolean;
}) {
  const steps: { title: string; detail: string }[] = accountsManaged
    ? [
        {
          title: "Complete App Push in My Accounts",
          detail:
            "Setup → Channel Setup → App Push. Upload Firebase service account JSON and/or APNs .p8, then set status to Active. Campaign does not store those keys.",
        },
        {
          title: "Generate a company integration key (this page)",
          detail:
            "Use “Company integration API key” above so the mobile backend can call POST /api/app-push/endpoints with X-Api-Key.",
        },
        {
          title: "Get a device push token (pushNotificationId)",
          detail:
            "From your mobile app or company user/device table use pushNotificationId (FCM/APNs token). Do not use deviceId, socketId, or userId — those are not FCM tokens.",
        },
        {
          title: "Register the device",
          detail:
            "Company backend registers after app login, or use Manual test register on the right. Link a contact via email or contact ID.",
        },
        {
          title: "Run the test send",
          detail:
            "Enter a dummy title/body, pick the registered device, click Run test. Green “OK via fcm” means My Accounts credentials + token are correct.",
        },
        {
          title: "Send from a campaign",
          detail:
            "Create an App push campaign for contacts that have a registered device, then launch.",
        },
      ]
    : [
        {
          title: "Open Firebase Console",
          detail:
            "Go to console.firebase.google.com → select the same project your Android/iOS app uses.",
        },
        {
          title: "Download the service account JSON",
          detail:
            "Project settings (gear) → Service accounts → Generate new private key. Save the .json file (do not commit it to git).",
        },
        {
          title: "Paste JSON in Step 1 below → Save (legacy)",
          detail:
            "Preferred: configure App Push in My Accounts Channel Setup. Legacy: paste the JSON into “Service account JSON” here until Accounts is wired.",
        },
        {
          title: "Get a device push token (pushNotificationId)",
          detail:
            "From your mobile app or company user/device table use pushNotificationId (FCM/APNs token). Do not use deviceId, socketId, or userId — those are not FCM tokens.",
        },
        {
          title: "Register the device in Step 2",
          detail:
            "Paste the full token, set platform (android/ios), and link a contact via email or contact ID.",
        },
        {
          title: "Run the test in Step 3",
          detail:
            "Enter a dummy title/body, pick the registered device, click Run test. Green “OK via fcm” means credentials + token are correct.",
        },
        {
          title: "Send from a campaign (Step 4)",
          detail:
            "Create an App push campaign for contacts that have a registered device, then launch. Same path as the test send.",
        },
      ];

  return (
    <section className="rounded-2xl border border-border-default bg-subtle/40 p-5">
      <h2 className="text-sm font-semibold text-text-primary">
        Setup guide — follow line by line
      </h2>
      <p className="mt-1 text-sm text-text-caption">
        {accountsManaged
          ? "Provider keys live in My Accounts Channel Setup. Campaign only registers device tokens and sends."
          : "Use this when configuring App push for the first time. Preferred path is My Accounts Channel Setup; the paste form below is legacy."}
      </p>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-3 text-sm">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-text-primary">{step.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-caption">
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 border-t border-border-default pt-3 text-xs leading-relaxed text-text-caption">
        <p className="font-medium text-text-secondary">Where each value comes from</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>
            <span className="text-text-primary">FCM / APNs</span> —
            {accountsManaged
              ? " My Accounts → Setup → Channel Setup → App Push"
              : " Firebase / Apple, pasted in Campaign (legacy) or My Accounts Channel Setup"}
          </li>
          <li>
            <span className="text-text-primary">Device token (endpoint)</span> —
            app field <code className="text-text-primary">pushNotificationId</code>
            , not <code className="text-text-primary">deviceId</code>
          </li>
          <li>
            <span className="text-text-primary">Contact email / ID</span> —
            Audience / CDP contact linked to that user
          </li>
        </ul>
      </div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-text-primary">{label}</span>
      {hint ? (
        <span className="mt-0.5 block text-xs text-text-caption">{hint}</span>
      ) : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const VISITOR_SITE_API_SAMPLE = `Preferred (My Accounts snippet):
  GET  https://rebuild-campaign-api.worktual.com/api/sdk/web-push.js
  POST /api/v1/push/subscribe
  Host /worktual-web-push-sw.js on your site:
    importScripts("https://rebuild-campaign-api.worktual.com/api/sdk/web-push-sw.js");

{
  "organization_id": 1000,
  "channel_config_id": 1200,
  "endpoint": "https://fcm.googleapis.com/fcm/send/…",
  "keys": { "p256dh": "…", "auth": "…" }
}

Also supported (demo / Origin + ?key=):
  GET  /api/public/web-push/config
  POST /api/public/web-push/visit
  POST /api/public/web-push/subscribe`;

const WEB_EMPTY = {
  site_origin: "",
  vapid_subject: "",
  vapid_public_key: "",
  vapid_private_key: "",
  default_icon_url: "",
  default_badge_url: "",
  subscribe_key: "",
};

const APP_EMPTY = {
  app_display_name: "",
  provider: "fcm",
  fcm_project_id: "",
  fcm_client_email: "",
  fcm_private_key: "",
  fcm_server_key: "",
  fcm_service_account_json: "",
  apns_key_id: "",
  apns_team_id: "",
  apns_bundle_id: "",
  apns_key_p8: "",
};

function contactLabel(d: AppPushEndpoint | WebPushSubscription): string {
  const c = d.contact;
  if (!c) {
    return d.contact_id
      ? `Contact ${d.contact_id.slice(0, 8)}…`
      : "No contact linked";
  }
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  const id = c.email || c.phone || c.id.slice(0, 8);
  return name ? `${name} · ${id}` : id;
}

function AppPushIntegrationKeySection({
  status,
  statusLoading,
  statusError,
  mintBusy,
  mintedKey,
  keyCopied,
  onMint,
  onRefresh,
  onDismissMint,
  onCopyKey,
}: {
  status: AppPushIntegrationKeyStatus | null;
  statusLoading: boolean;
  statusError: string | null;
  mintBusy: boolean;
  mintedKey: { api_key: string; message: string } | null;
  keyCopied: boolean;
  onMint: () => void;
  onRefresh: () => void;
  onDismissMint: () => void;
  onCopyKey: () => void;
}) {
  return (
    <>
      <section className="mt-6 rounded-2xl border-2 border-neutral-900/10 bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <KeyRound className="size-5 shrink-0" strokeWidth={1.75} />
            Company integration API key
          </h2>
          <span className="rounded-full border border-border-default bg-subtle px-2.5 py-0.5 text-[11px] font-medium text-text-caption">
            For onboarding handoff
          </span>
        </div>
        <p className="mt-2 text-sm text-text-caption">
          Generate a secret and send it to the company. Their backend calls{" "}
          <code className="text-text-primary">POST /api/app-push/endpoints</code>{" "}
          with header{" "}
          <code className="text-text-primary">X-Api-Key</code>. Use{" "}
          <span className="font-medium text-text-primary">Manual test register</span>{" "}
          in the right panel only for internal QA (Campaign login).
        </p>
        {statusError ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {statusError}
          </p>
        ) : null}
        {statusLoading && !status ? (
          <p className="mt-3 text-sm text-text-caption">Loading key status…</p>
        ) : (
          <dl className="mt-4 grid gap-2 sm:grid-cols-3 text-sm">
            <div className="rounded-xl border border-border-default bg-subtle/40 px-3 py-2">
              <dt className="text-xs text-text-caption">Status</dt>
              <dd className="mt-0.5 font-medium text-text-primary">
                {status?.configured ? "Configured" : "Not set"}
              </dd>
            </div>
            {status?.key_prefix ? (
              <div className="rounded-xl border border-border-default bg-subtle/40 px-3 py-2">
                <dt className="text-xs text-text-caption">Key prefix</dt>
                <dd className="mt-0.5 font-mono text-xs text-text-primary">
                  {status.key_prefix}
                </dd>
              </div>
            ) : null}
            {status?.last_used_at ? (
              <div className="rounded-xl border border-border-default bg-subtle/40 px-3 py-2">
                <dt className="text-xs text-text-caption">Last used</dt>
                <dd className="mt-0.5 text-text-primary">
                  {new Date(status.last_used_at).toLocaleString()}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="brand"
            disabled={mintBusy || Boolean(statusError?.includes("administrator"))}
            onClick={onMint}
          >
            {mintBusy
              ? "Generating…"
              : status?.configured
                ? "Rotate integration key"
                : "Generate integration key"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={statusLoading}
            onClick={onRefresh}
          >
            Refresh status
          </Button>
        </div>
      </section>

      {mintedKey ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-labelledby="integration-key-dialog-title"
        >
          <div className="max-w-lg w-full rounded-2xl border border-border-default bg-surface p-5 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <h2
                id="integration-key-dialog-title"
                className="text-base font-semibold text-text-primary"
              >
                Copy integration key now
              </h2>
              <button
                type="button"
                className="rounded-lg p-1 text-text-caption hover:bg-subtle hover:text-text-primary"
                aria-label="Close"
                onClick={onDismissMint}
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-amber-900 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              {mintedKey.message}
            </p>
            <label className="mt-4 block">
              <span className="text-xs font-medium text-text-caption">
                X-Api-Key (give to company backend)
              </span>
              <textarea
                readOnly
                className={`${inputClass} mt-1 font-mono text-xs`}
                rows={3}
                value={mintedKey.api_key}
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="brand" onClick={onCopyKey}>
                <Copy className="size-4" strokeWidth={1.75} />
                {keyCopied ? "Copied" : "Copy key"}
              </Button>
              <Button type="button" variant="secondary" onClick={onDismissMint}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Web push / App push configuration.
 * App push flow: credentials → register devices → test send → launch campaigns.
 */
export function PushConfigurationPage() {
  const { channel: param } = useParams();
  const channel =
    param === "web_push" || param === "app_push" ? param : null;

  const [bundle, setBundle] = useState<PushConfigBundle | null>(null);
  const [form, setForm] = useState<Record<string, string>>(
    channel === "app_push" ? { ...APP_EMPTY } : { ...WEB_EMPTY },
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [devices, setDevices] = useState<
    Array<AppPushEndpoint | WebPushSubscription>
  >([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [regForm, setRegForm] = useState({
    endpoint: "",
    platform: "android",
    contactId: "",
    email: "",
    phone: "",
    firstName: "",
    lastName: "",
    p256dh: "",
    auth: "",
  });
  const [regBusy, setRegBusy] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [testForm, setTestForm] = useState({
    title: "Worktual test push",
    body: "If you see this, App push config is working.",
    email: "",
    endpoint: "",
    endpointId: "",
    platform: "android",
  });
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [integrationKeyStatus, setIntegrationKeyStatus] =
    useState<AppPushIntegrationKeyStatus | null>(null);
  const [integrationKeyLoading, setIntegrationKeyLoading] = useState(false);
  const [integrationMintBusy, setIntegrationMintBusy] = useState(false);
  const [mintedIntegrationKey, setMintedIntegrationKey] = useState<{
    api_key: string;
    message: string;
  } | null>(null);
  const [integrationKeyCopied, setIntegrationKeyCopied] = useState(false);
  const [integrationKeyError, setIntegrationKeyError] = useState<string | null>(
    null,
  );

  const refreshIntegrationKeyStatus = useCallback(async () => {
    if (channel !== "app_push") return;
    setIntegrationKeyLoading(true);
    setIntegrationKeyError(null);
    try {
      const status = await fetchAppPushIntegrationKeyStatus();
      setIntegrationKeyStatus(status);
    } catch (err) {
      setIntegrationKeyStatus(null);
      const msg =
        err instanceof Error
          ? err.message
          : "Could not load integration key status";
      setIntegrationKeyError(
        msg.toLowerCase().includes("administrator")
          ? "Only administrators can generate integration keys. Log in with an admin account, or use the internal onboarding API."
          : msg.includes("404") || msg.toLowerCase().includes("not found")
            ? "Integration key API is not on this server yet — deploy the latest backend and run database migrations."
            : msg,
      );
    } finally {
      setIntegrationKeyLoading(false);
    }
  }, [channel]);

  const refreshDevices = useCallback(async () => {
    if (channel !== "app_push" && channel !== "web_push") return;
    setDevicesLoading(true);
    try {
      if (channel === "web_push") {
        const next = await fetchWebPushSubscriptions({ activeOnly: true });
        setDevices(next.subscriptions);
      } else {
        const next = await fetchAppPushEndpoints({ activeOnly: true });
        setDevices(next.endpoints);
      }
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, [channel]);

  const refresh = useCallback(async () => {
    if (!channel) return;
    const next = await fetchPushConfig(channel);
    setBundle(next);
    const base = channel === "app_push" ? { ...APP_EMPTY } : { ...WEB_EMPTY };
    const merged: Record<string, string> = { ...base, ...next.settings };
    if (channel === "app_push") {
      merged.fcm_server_key = secretFormValue(
        next.settings,
        "fcm_server_key",
        next.secrets_set,
      );
      merged.fcm_private_key = secretFormValue(
        next.settings,
        "fcm_private_key",
        next.secrets_set,
      );
      merged.fcm_service_account_json = "";
      merged.apns_key_p8 = secretFormValue(
        next.settings,
        "apns_key_p8",
        next.secrets_set,
      );
    } else {
      merged.vapid_private_key = secretFormValue(
        next.settings,
        "vapid_private_key",
        next.secrets_set,
      );
    }
    setForm(merged);
    await refreshDevices();
  }, [channel, refreshDevices]);

  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load push config",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channel, refresh]);

  useEffect(() => {
    if (channel !== "app_push") return;
    void refreshIntegrationKeyStatus();
  }, [channel, refreshIntegrationKeyStatus]);

  const onMintIntegrationKey = async () => {
    if (channel !== "app_push") return;
    const rotating = integrationKeyStatus?.configured;
    if (
      rotating &&
      !window.confirm(
        "This replaces the current integration key. The company must update X-Api-Key on their backend. Continue?",
      )
    ) {
      return;
    }
    setIntegrationMintBusy(true);
    setIntegrationKeyCopied(false);
    setError(null);
    try {
      const minted = await mintAppPushIntegrationKey();
      setMintedIntegrationKey({
        api_key: minted.api_key,
        message: minted.message,
      });
      await refreshIntegrationKeyStatus();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not generate integration key",
      );
    } finally {
      setIntegrationMintBusy(false);
    }
  };

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    if (!channel) return;
    setBusy(true);
    setToast(null);
    setError(null);
    try {
      const next = await savePushConfig(channel, form);
      setBundle(next);
      const base = channel === "app_push" ? { ...APP_EMPTY } : { ...WEB_EMPTY };
      const merged: Record<string, string> = { ...base, ...next.settings };
      if (channel === "app_push") {
        merged.fcm_server_key = secretFormValue(
          next.settings,
          "fcm_server_key",
          next.secrets_set,
        );
        merged.fcm_private_key = secretFormValue(
          next.settings,
          "fcm_private_key",
          next.secrets_set,
        );
        merged.fcm_service_account_json = "";
        merged.apns_key_p8 = secretFormValue(
          next.settings,
          "apns_key_p8",
          next.secrets_set,
        );
      } else {
        merged.vapid_private_key = secretFormValue(
          next.settings,
          "vapid_private_key",
          next.secrets_set,
        );
      }
      setForm(merged);
      setToast(
        next.status === "ready"
          ? "Saved. Secrets stay on the server (fields stay empty on purpose)."
          : "Saved. Secrets stay on the server (fields stay empty on purpose).",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onRegisterDevice = async () => {
    setRegBusy(true);
    setError(null);
    setToast(null);
    try {
      if (channel === "web_push") {
        const result = await registerWebPushSubscription({
          endpoint: regForm.endpoint.trim(),
          keys: {
            p256dh: regForm.p256dh.trim(),
            auth: regForm.auth.trim(),
          },
          platform: "browser",
          contactId: regForm.contactId.trim() || undefined,
          email: regForm.email.trim() || undefined,
          phone: regForm.phone.trim() || undefined,
          firstName: regForm.firstName.trim() || undefined,
          lastName: regForm.lastName.trim() || undefined,
        });
        setToast(
          result.contact_created
            ? "Subscription registered — new contact created"
            : "Subscription registered and linked to contact",
        );
        setRegForm((p) => ({
          ...p,
          endpoint: "",
          p256dh: "",
          auth: "",
        }));
      } else {
        const result = await registerAppPushDevice({
          endpoint: regForm.endpoint.trim(),
          platform: regForm.platform,
          contactId: regForm.contactId.trim() || undefined,
          email: regForm.email.trim() || undefined,
          phone: regForm.phone.trim() || undefined,
          firstName: regForm.firstName.trim() || undefined,
          lastName: regForm.lastName.trim() || undefined,
        });
        setToast(
          result.contact_created
            ? "Device registered — new contact created"
            : "Device registered and linked to contact",
        );
        setRegForm((p) => ({ ...p, endpoint: "" }));
      }
      await refreshDevices();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to register",
      );
    } finally {
      setRegBusy(false);
    }
  };

  const onDeactivate = async (id: string) => {
    if (
      !window.confirm(
        channel === "web_push"
          ? "Deactivate this browser subscription?"
          : "Deactivate this device token?",
      )
    ) {
      return;
    }
    setDeactivatingId(id);
    setError(null);
    try {
      if (channel === "web_push") {
        await deactivateWebPushSubscription(id);
        setToast("Subscription deactivated");
      } else {
        await deactivateAppPushEndpoint(id);
        setToast("Device deactivated");
      }
      await refreshDevices();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to deactivate",
      );
    } finally {
      setDeactivatingId(null);
    }
  };

  const apiErrMessage = (err: unknown, fallback: string) => {
    if (
      err &&
      typeof err === "object" &&
      "response" in err &&
      (err as { response?: { data?: { message?: string } } }).response?.data
        ?.message
    ) {
      return String(
        (err as { response: { data: { message: string } } }).response.data
          .message,
      );
    }
    return err instanceof Error ? err.message : fallback;
  };

  const onTestSend = async () => {
    if (channel !== "app_push" && channel !== "web_push") return;
    const isWeb = channel === "web_push";
    const email = testForm.email.trim();
    if (isWeb && !email) {
      setTestResult({
        ok: false,
        text: "Enter a contact email to look up their Web push subscription.",
      });
      return;
    }
    setTestBusy(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await testPushConfigSend(channel, {
        title: testForm.title.trim() || "Worktual test push",
        body:
          testForm.body.trim() ||
          (isWeb
            ? "If you see this, Web push send path is working."
            : "If you see this, App push config is working."),
        ...(isWeb
          ? { email, platform: "browser" }
          : {
              ...(testForm.endpoint.trim()
                ? { endpoint: testForm.endpoint.trim() }
                : {}),
              ...(testForm.endpointId
                ? { endpoint_id: testForm.endpointId }
                : {}),
              platform: testForm.platform,
            }),
      });
      const who = result.contact_email ? ` · ${result.contact_email}` : "";
      setTestResult({
        ok: true,
        text: `OK via ${result.provider}${who} · message ${result.message_id} · ${result.destination_preview}`,
      });
      setToast(
        isWeb
          ? "Sent — check Chrome for that contact’s subscription"
          : "Test push sent — check the device",
      );
    } catch (err) {
      const msg = apiErrMessage(err, "Test push failed");
      setTestResult({ ok: false, text: msg });
    } finally {
      setTestBusy(false);
    }
  };

  const checklistItems = useMemo(() => {
    if (!bundle) return [];
    if (channel === "web_push") {
      return [
        { ok: !!bundle.checklist.site_origin, label: "Site origin" },
        { ok: !!bundle.checklist.vapid_subject, label: "VAPID subject" },
        { ok: !!bundle.checklist.vapid_public_key, label: "VAPID public key" },
        {
          ok: !!bundle.checklist.vapid_private_key,
          label: "VAPID private key",
        },
        {
          ok: devices.length > 0,
          label: "At least one subscription registered",
        },
      ];
    }
    return [
      { ok: !!bundle.checklist.app_display_name, label: "App display name" },
      {
        ok: !!bundle.checklist.fcm_http_v1,
        label: "FCM HTTP v1 (service account)",
      },
      { ok: !!bundle.checklist.fcm_ready, label: "FCM ready (if required)" },
      { ok: !!bundle.checklist.apns_ready, label: "APNs ready (if required)" },
      {
        ok: devices.length > 0,
        label: "At least one device registered",
      },
    ];
  }, [bundle, channel, devices.length]);

  if (!channel) {
    return <Navigate to="/configuration" replace />;
  }

  const isWeb = channel === "web_push";
  const Icon = isWeb ? Bell : TabletSmartphone;
  const title = isWeb ? "Web push" : "App push";
  const provider = (form.provider || "fcm").toLowerCase();
  const showFcm = !isWeb && (provider === "fcm" || provider === "both");
  const showApns = !isWeb && (provider === "apns" || provider === "both");
  const isReady = bundle?.status === "ready";
  const hasDevices = devices.length > 0;
  const accountsManaged = bundle?.source === "my_accounts";

  if (loading && !bundle) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <p className="text-sm text-text-caption">Loading {title}…</p>
      </div>
    );
  }

  return (
    <ContentFadeIn className="min-w-0 px-4 py-6 sm:px-6 sm:py-8">
      <Link
        to="/configuration"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        All channels
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-text-primary">
            <Icon className="size-6" strokeWidth={1.75} />
            {title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-caption">
            {isWeb
              ? "Look up a contact by email and send a one-off Web push (My Accounts VAPID — same path as a campaign)."
              : accountsManaged
                ? "FCM and APNs come from My Accounts Channel Setup. Register device tokens here, then test and launch."
                : "Paste Firebase service account JSON (and APNs if needed), Save, register a device token, then Run test."}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${statusBadge(bundle?.status || "not_started")}`}
        >
          {bundle?.status?.replace(/_/g, " ") || "not started"}
        </span>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-border-default bg-surface px-4 py-3 text-sm text-text-danger">
          {error}
        </p>
      ) : null}
      {toast ? (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {toast}
        </p>
      ) : null}

      {!isWeb ? (
        <AppPushIntegrationKeySection
          status={integrationKeyStatus}
          statusLoading={integrationKeyLoading}
          statusError={integrationKeyError}
          mintBusy={integrationMintBusy}
          mintedKey={mintedIntegrationKey}
          keyCopied={integrationKeyCopied}
          onMint={() => void onMintIntegrationKey()}
          onRefresh={() => void refreshIntegrationKeyStatus()}
          onDismissMint={() => setMintedIntegrationKey(null)}
          onCopyKey={() => {
            if (!mintedIntegrationKey) return;
            void navigator.clipboard.writeText(mintedIntegrationKey.api_key);
            setIntegrationKeyCopied(true);
          }}
        />
      ) : null}

      {!isWeb ? (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <div className="min-w-0 space-y-6">
            <AppPushSetupGuide accountsManaged={accountsManaged} />

            {/* Step 1 — credentials */}
            <section className="rounded-2xl border border-border-default bg-surface p-5">
              <StepBadge
                n={1}
                done={Boolean(isReady)}
                label={
                  accountsManaged
                    ? "Save Firebase JSON here to test locally (Campaign credentials)"
                    : "Save provider credentials"
                }
              />
              <p className="mt-2 text-sm text-text-caption">
                {accountsManaged
                  ? bundle?.setup_hint ||
                    "Paste Firebase service account JSON below and Save. Run test uses Campaign credentials (not My Accounts)."
                  : "Paste Firebase service account JSON (and APNs if needed), then Save. Run test uses these Campaign credentials."}
              </p>
              {accountsManaged ? (
                <div className="mt-4 rounded-xl border border-border-default bg-subtle px-4 py-3 text-sm text-text-primary">
                  <p>
                    My Accounts also has App Push (
                    <span className="font-medium capitalize">
                      {(
                        bundle?.accounts_status ||
                        bundle?.status ||
                        "—"
                      ).replace(/_/g, " ")}
                    </span>
                    ). Paste JSON below and Save to test with{" "}
                    <strong>Campaign local credentials</strong> instead.
                  </p>
                </div>
              ) : null}
              <div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="App display name">
                  <input
                    className={inputClass}
                    value={form.app_display_name || ""}
                    onChange={(e) =>
                      setField("app_display_name", e.target.value)
                    }
                    placeholder="Your app name"
                  />
                </Field>
                <Field label="Provider">
                  <select
                    className={inputClass}
                    value={form.provider || "fcm"}
                    onChange={(e) => setField("provider", e.target.value)}
                  >
                    <option value="fcm">FCM (Android / Firebase)</option>
                    <option value="apns">APNs (iOS)</option>
                    <option value="both">Both FCM + APNs</option>
                  </select>
                </Field>
              </div>

              {showFcm ? (
                <div className="mt-5 border-t border-border-default pt-5">
                  <h3 className="text-sm font-medium text-text-primary">
                    Firebase Cloud Messaging (HTTP v1)
                  </h3>
                  <p className="mt-1 text-xs text-text-caption">
                    Paste your Firebase service account JSON (preferred). Legacy
                    server key is deprecated and often returns 404.
                  </p>
                  <div className="mt-3 space-y-4">
                    <Field
                      label="Service account JSON"
                      hint={
                        bundle?.secrets_set?.fcm_private_key
                          ? "Saved on server. Paste a new JSON only to replace."
                          : "Firebase Console → Project settings → Service accounts → Generate new private key"
                      }
                    >
                      <textarea
                        className={`${inputClass} min-h-[120px] font-mono text-xs`}
                        value={form.fcm_service_account_json || ""}
                        placeholder={
                          bundle?.secrets_set?.fcm_private_key
                            ? '{"type":"service_account",…} (saved — paste to replace)'
                            : '{"type":"service_account","project_id":"…",…}'
                        }
                        spellCheck={false}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setForm((prev) => {
                            const next: Record<string, string> = {
                              ...prev,
                              fcm_service_account_json: raw,
                            };
                            const trimmed = raw.trim();
                            if (trimmed.startsWith("{")) {
                              try {
                                const sa = JSON.parse(trimmed) as Record<
                                  string,
                                  unknown
                                >;
                                if (
                                  typeof sa.project_id === "string" &&
                                  sa.project_id.trim()
                                ) {
                                  next.fcm_project_id = sa.project_id.trim();
                                }
                                if (
                                  typeof sa.client_email === "string" &&
                                  sa.client_email.trim()
                                ) {
                                  next.fcm_client_email =
                                    sa.client_email.trim();
                                }
                              } catch {
                                /* incomplete JSON while typing */
                              }
                            }
                            return next;
                          });
                        }}
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="FCM project ID"
                        hint="Filled from JSON, or enter manually"
                      >
                        <input
                          className={inputClass}
                          value={form.fcm_project_id || ""}
                          onChange={(e) =>
                            setField("fcm_project_id", e.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="Client email"
                        hint="service-account@….iam.gserviceaccount.com"
                      >
                        <input
                          className={inputClass}
                          value={form.fcm_client_email || ""}
                          onChange={(e) =>
                            setField("fcm_client_email", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                    <details className="rounded-lg border border-border-default px-3 py-2">
                      <summary className="cursor-pointer text-xs font-medium text-text-caption">
                        Advanced — legacy server key (not recommended)
                      </summary>
                      <div className="mt-3">
                        <Field
                          label="FCM server key (legacy)"
                          hint={
                            bundle?.secrets_set?.fcm_server_key
                              ? "Saved on server. Leave blank to keep it."
                              : "Old Cloud Messaging API — often fails with HTTP 404"
                          }
                        >
                          <SecretInput
                            value={form.fcm_server_key || ""}
                            onChange={(v) => setField("fcm_server_key", v)}
                            placeholder={
                              bundle?.secrets_set?.fcm_server_key
                                ? "•••••••• (saved — type to replace)"
                                : undefined
                            }
                          />
                        </Field>
                      </div>
                    </details>
                  </div>
                </div>
              ) : null}

              {showApns ? (
                <div className="mt-5 border-t border-border-default pt-5">
                  <h3 className="text-sm font-medium text-text-primary">
                    Apple Push Notification service
                  </h3>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <Field label="Key ID">
                      <input
                        className={inputClass}
                        value={form.apns_key_id || ""}
                        onChange={(e) =>
                          setField("apns_key_id", e.target.value)
                        }
                      />
                    </Field>
                    <Field label="Team ID">
                      <input
                        className={inputClass}
                        value={form.apns_team_id || ""}
                        onChange={(e) =>
                          setField("apns_team_id", e.target.value)
                        }
                      />
                    </Field>
                    <Field label="Bundle ID" hint="e.g. com.company.app">
                      <input
                        className={inputClass}
                        value={form.apns_bundle_id || ""}
                        onChange={(e) =>
                          setField("apns_bundle_id", e.target.value)
                        }
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field
                        label="APNs .p8 key"
                        hint={
                          bundle?.secrets_set?.apns_key_p8
                            ? "Saved on server. Leave blank to keep it, or paste a new key to replace."
                            : "Paste AuthKey_XXXX.p8 contents"
                        }
                      >
                        <textarea
                          className={`${inputClass} min-h-[120px] font-mono text-xs`}
                          value={form.apns_key_p8 || ""}
                          placeholder={
                            bundle?.secrets_set?.apns_key_p8
                              ? "•••••••• (saved — paste to replace)"
                              : undefined
                          }
                          onChange={(e) =>
                            setField("apns_key_p8", e.target.value)
                          }
                          spellCheck={false}
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 flex justify-end">
                <Button
                  type="button"
                  variant="brand"
                  disabled={busy}
                  onClick={() => void onSave()}
                >
                  {busy ? "Saving…" : "Save configuration"}
                </Button>
              </div>
              </div>
            </section>

            {/* Step 2 — register devices (list + API; forms on the right) */}
            <section
              className={`rounded-2xl border border-border-default bg-surface p-5 ${
                !isReady ? "opacity-90" : ""
              }`}
            >
              <StepBadge
                n={2}
                done={hasDevices}
                label="Register device tokens"
              />
              <p className="mt-2 text-sm text-text-caption">
                Lines 4–5 of the guide: use{" "}
                <span className="font-medium text-text-primary">
                  pushNotificationId
                </span>{" "}
                (not deviceId). Use{" "}
                <span className="font-medium text-text-primary">
                  Manual test register
                </span>{" "}
                and{" "}
                <span className="font-medium text-text-primary">
                  Test that config works
                </span>{" "}
                in the right panel.
              </p>

              {!isReady ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  <Circle className="mt-0.5 size-3.5 shrink-0" />
                  Finish Step 1 and reach <strong className="mx-1">Ready</strong>{" "}
                  before relying on live sends. You can still register devices
                  for testing.
                </p>
              ) : null}

              <div className="mt-4 rounded-xl border border-dashed border-border-default bg-subtle/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-caption">
                  What the mobile app calls
                </p>
                <pre className="mt-2 overflow-x-auto break-all whitespace-pre-wrap text-[11px] leading-relaxed text-text-secondary">
{`POST /api/app-push/endpoints
X-Api-Key: <org_integration_key>   // company backend (preferred in production)
// — or — Authorization: Bearer <campaign_jwt>   // manual / QA only

{
  "endpoint": "<FCM/APNs token — same as app pushNotificationId>",
  "platform": "android",
  "email": "user@company.com"
}
// pushNotificationId is accepted as an alias for endpoint`}
                </pre>
                <p className="mt-2 text-xs text-text-caption">
                  Use your app&apos;s{" "}
                  <code className="text-text-primary">pushNotificationId</code>,
                  not <code className="text-text-primary">deviceId</code>. Or pass{" "}
                  <code className="text-text-primary">contactId</code> if the
                  contact already exists. Call after login and whenever the token
                  refreshes. Org keys: admin{" "}
                  <code className="text-text-primary">
                    POST /api/configuration/integration/app-push-api-key
                  </code>
                  .
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-caption">
                  Registered devices ({devices.length})
                </h3>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={devicesLoading}
                  onClick={() => void refreshDevices()}
                >
                  {devicesLoading ? "Loading…" : "Refresh devices"}
                </Button>
              </div>
              {devices.length === 0 ? (
                <p className="mt-2 text-sm text-text-caption">
                  No active devices yet. Register via the right panel or the app
                  API.
                </p>
              ) : (
                <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
                  {devices.slice(0, 50).map((d) => (
                    <li
                      key={d.id}
                      className="flex items-start justify-between gap-2 rounded-lg border border-border-default bg-subtle/40 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-text-primary">
                          {(d.platform || "device").toUpperCase()} ·{" "}
                          {contactLabel(d)}
                        </div>
                        <div className="mt-0.5 break-all font-mono text-text-caption">
                          {d.endpoint}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-text-danger hover:bg-red-50 disabled:opacity-50"
                        disabled={deactivatingId === d.id}
                        onClick={() => void onDeactivate(d.id)}
                        title="Deactivate"
                      >
                        <Trash2 className="size-3.5" />
                        {deactivatingId === d.id ? "…" : "Remove"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Step 4 — next */}
            <section className="rounded-2xl border border-border-default bg-surface p-5">
              <StepBadge
                n={4}
                done={Boolean(isReady && hasDevices && testResult?.ok)}
                label="Send from a campaign"
              />
              <p className="mt-2 text-sm text-text-caption">
                Line 7 of the guide: create a campaign, choose audience contacts
                that have devices, pick App push, and launch.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/campaigns/create"
                  className="inline-flex h-10 items-center rounded-xl bg-black px-4 text-sm font-medium text-white hover:bg-neutral-800"
                >
                  Create campaign
                </Link>
                <Link
                  to="/audience"
                  className="inline-flex h-10 items-center rounded-xl border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-900 hover:bg-neutral-50"
                >
                  View audience
                </Link>
              </div>
            </section>
          </div>

          <aside className="h-fit w-full min-w-0 shrink-0 space-y-4">
            <div className="rounded-2xl border border-border-default bg-surface p-4">
              <h2 className="text-sm font-semibold text-text-primary">
                Setup checklist
              </h2>
              <ul className="mt-3 space-y-2">
                {checklistItems.map((item) => (
                  <CheckItem key={item.label} ok={item.ok} label={item.label} />
                ))}
              </ul>
              <p className="mt-4 text-xs text-text-caption">
                Status becomes <strong>Ready</strong> when required provider
                fields are saved. Secrets stay on the server — after save the
                fields look empty on purpose.
              </p>
            </div>
            <div className="rounded-2xl border border-border-default bg-surface p-4">
              <h2 className="text-sm font-semibold text-text-primary">
                Quick reminders
              </h2>
              <ul className="mt-3 space-y-2 text-xs leading-relaxed text-text-caption">
                <li>
                  Use{" "}
                  <span className="font-medium text-text-primary">
                    pushNotificationId
                  </span>
                  , never deviceId.
                </li>
                <li>
                  Same Firebase project for the app and the service account JSON.
                </li>
                <li>
                  Phone cannot call localhost — register tokens manually until
                  Campaign API is live.
                </li>
                <li>
                  Run test (Step 3) before launching a real campaign.
                </li>
              </ul>
            </div>

            <div
              className={`rounded-2xl border border-border-default bg-surface p-4 ${
                !isReady ? "opacity-90" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-text-primary">
                  Manual test register
                </h2>
                <span className="text-[10px] font-medium uppercase tracking-wide text-text-caption">
                  Step 2
                </span>
              </div>
              <p className="mt-1 text-xs text-text-caption">
                Paste <span className="font-medium text-text-primary">pushNotificationId</span>{" "}
                and link a contact.
              </p>
              <div className="mt-3 space-y-3">
                <Field
                  label="Device token (pushNotificationId → endpoint)"
                  hint="Paste the FCM/APNs token from your app — not deviceId."
                >
                  <input
                    className={inputClass}
                    value={regForm.endpoint}
                    onChange={(e) =>
                      setRegForm((p) => ({ ...p, endpoint: e.target.value }))
                    }
                    placeholder="pushNotificationId / FCM / APNs"
                  />
                </Field>
                <Field label="Platform">
                  <select
                    className={inputClass}
                    value={regForm.platform}
                    onChange={(e) =>
                      setRegForm((p) => ({ ...p, platform: e.target.value }))
                    }
                  >
                    <option value="android">android</option>
                    <option value="ios">ios</option>
                  </select>
                </Field>
                <Field label="Contact ID (optional)">
                  <input
                    className={inputClass}
                    value={regForm.contactId}
                    onChange={(e) =>
                      setRegForm((p) => ({ ...p, contactId: e.target.value }))
                    }
                    placeholder="uuid"
                  />
                </Field>
                <Field label="Email">
                  <input
                    className={inputClass}
                    value={regForm.email}
                    onChange={(e) =>
                      setRegForm((p) => ({ ...p, email: e.target.value }))
                    }
                    placeholder="user@example.com"
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className={inputClass}
                    value={regForm.phone}
                    onChange={(e) =>
                      setRegForm((p) => ({ ...p, phone: e.target.value }))
                    }
                    placeholder="+91…"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="First name">
                    <input
                      className={inputClass}
                      value={regForm.firstName}
                      onChange={(e) =>
                        setRegForm((p) => ({ ...p, firstName: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Last name">
                    <input
                      className={inputClass}
                      value={regForm.lastName}
                      onChange={(e) =>
                        setRegForm((p) => ({ ...p, lastName: e.target.value }))
                      }
                    />
                  </Field>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="brand"
                  disabled={
                    regBusy ||
                    !regForm.endpoint.trim() ||
                    (!regForm.contactId.trim() &&
                      !regForm.email.trim() &&
                      !regForm.phone.trim())
                  }
                  onClick={() => void onRegisterDevice()}
                >
                  {regBusy ? "Registering…" : "Register device"}
                </Button>
              </div>
            </div>

            <div
              className={`rounded-2xl border border-border-default bg-surface p-4 ${
                !isReady ? "opacity-90" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-text-primary">
                  Test that config works
                </h2>
                <span className="text-[10px] font-medium uppercase tracking-wide text-text-caption">
                  Step 3
                </span>
              </div>
              <p className="mt-1 text-xs text-text-caption">
                Dummy title/body → Run test. Green OK means credentials + token
                are good.
              </p>
              {!isReady ? (
                <p className="mt-2 text-xs text-amber-900">
                  {accountsManaged
                    ? "Activate App Push in My Accounts Channel Setup or the test will fail."
                    : "Save Step 1 until Ready or the test will fail."}
                </p>
              ) : null}
              <div className="mt-3 space-y-3">
                <Field label="Title">
                  <input
                    className={inputClass}
                    value={testForm.title}
                    onChange={(e) =>
                      setTestForm((p) => ({ ...p, title: e.target.value }))
                    }
                    placeholder="Worktual test push"
                  />
                </Field>
                <Field label="Platform">
                  <select
                    className={inputClass}
                    value={testForm.platform}
                    onChange={(e) =>
                      setTestForm((p) => ({ ...p, platform: e.target.value }))
                    }
                  >
                    <option value="android">android (FCM)</option>
                    <option value="ios">ios (APNs)</option>
                  </select>
                </Field>
                <Field label="Body">
                  <textarea
                    className={`${inputClass} min-h-[64px]`}
                    value={testForm.body}
                    onChange={(e) =>
                      setTestForm((p) => ({ ...p, body: e.target.value }))
                    }
                    placeholder="If you see this, App push config is working."
                  />
                </Field>
                <Field label="Registered device">
                  <select
                    className={inputClass}
                    value={testForm.endpointId}
                    onChange={(e) =>
                      setTestForm((p) => ({
                        ...p,
                        endpointId: e.target.value,
                        endpoint: e.target.value ? "" : p.endpoint,
                      }))
                    }
                  >
                    <option value="">Latest registered device</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {(d.platform || "device").toUpperCase()} ·{" "}
                        {contactLabel(d)} · {d.endpoint.slice(0, 12)}…
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Or paste token">
                  <input
                    className={inputClass}
                    value={testForm.endpoint}
                    onChange={(e) =>
                      setTestForm((p) => ({
                        ...p,
                        endpoint: e.target.value,
                        endpointId: e.target.value.trim() ? "" : p.endpointId,
                      }))
                    }
                    placeholder="Full FCM / APNs token"
                  />
                </Field>
              </div>
              {testResult ? (
                <p
                  className={`mt-3 break-words text-xs ${
                    testResult.ok ? "text-emerald-700" : "text-text-danger"
                  }`}
                  role="status"
                >
                  {testResult.text}
                </p>
              ) : null}
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="brand"
                  disabled={
                    testBusy ||
                    !testForm.title.trim() ||
                    !testForm.body.trim()
                  }
                  onClick={() => void onTestSend()}
                >
                  {testBusy ? "Sending…" : "Run test"}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="mt-6 max-w-xl">
          <section className="rounded-2xl border border-border-default bg-surface p-5">
            <h2 className="text-sm font-semibold text-text-primary">
              Send test to a contact
            </h2>
            <p className="mt-2 text-sm text-text-caption">
              Enter a Contacts email. Campaign finds that row, loads their Web
              push subscription, and sends with My Accounts VAPID keys — the
              same credentials path as a live Web push campaign.
            </p>
            <div className="mt-4">
              <Field label="Contact email">
                <input
                  className={inputClass}
                  type="email"
                  autoComplete="off"
                  value={testForm.email}
                  onChange={(e) =>
                    setTestForm((p) => ({ ...p, email: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void onTestSend();
                    }
                  }}
                  placeholder="revi@gmail.com"
                />
              </Field>
            </div>
            {testResult ? (
              <p
                className={`mt-3 break-words text-xs ${
                  testResult.ok ? "text-emerald-700" : "text-text-danger"
                }`}
                role="status"
              >
                {testResult.text}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="brand"
                disabled={testBusy || !testForm.email.trim()}
                onClick={() => void onTestSend()}
              >
                {testBusy ? "Sending…" : "Run"}
              </Button>
            </div>
            <p className="mt-4 text-xs text-text-caption">
              VAPID keys come from{" "}
              <span className="font-medium text-text-primary">
                My Accounts → Setup → Channel Setup → Web Push
              </span>
              .
            </p>
          </section>
        </div>
      )}
    </ContentFadeIn>
  );
}
