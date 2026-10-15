import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Mail } from "lucide-react";
import {
  GoogleGlyph,
  MicrosoftGlyph,
} from "@/components/brand/ProviderGlyphs";
import { ConfigurationShell } from "@/components/configuration/ConfigurationShell";
import { Button } from "@/components/ui/Button";
import {
  disconnectGoogleEmail,
  disconnectMicrosoftEmail,
  fetchEmailIntegrations,
  oauthStartUrl,
  type EmailIntegrationsStatus,
} from "@/services/configuration";
import {
  fetchSeoSocialConnections,
  type SeoSocialConnection,
} from "@/services/seo";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { chipClass, PAGE_H1_CLASS, TONE_SUCCESS } from "@/lib/ui-tones";

export function EmailConfigurationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<EmailIntegrationsStatus | null>(null);
  const [social, setSocial] = useState<SeoSocialConnection[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = async () => {
    setBusy(true);
    try {
      setStatus(await fetchEmailIntegrations());
    } catch {
      setMessage("Failed to load email integrations.");
    }
    try {
      setSocial(await fetchSeoSocialConnections());
    } catch {
      setSocial(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    const flag = searchParams.get("calendar") || searchParams.get("email");
    if (!flag) return;

    let cancelled = false;
    (async () => {
      let redirectUri = status?.googleRedirectUri;
      if (flag === "redirect_mismatch" && !redirectUri) {
        try {
          const next = await fetchEmailIntegrations();
          if (cancelled) return;
          setStatus(next);
          redirectUri = next.googleRedirectUri;
        } catch {
          /* keep null */
        }
      }

      const emailPage = `${window.location.origin}/configuration/email`;
      const messages: Record<string, string> = {
        connected: "Google connected. You can sync Inbox and send mail.",
        denied: "Google authorization was cancelled.",
        not_configured:
          "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env, then try again.",
        invalid_secret:
          "Google client secret is invalid. In Google Cloud Console → APIs & Services → Credentials, open this OAuth client, copy the current Client secret into GOOGLE_CLIENT_SECRET in .env (must match GOOGLE_CLIENT_ID), then restart the API server and Connect again.",
        redirect_mismatch: redirectUri
          ? `Google redirect_uri_mismatch: add ${redirectUri} under Google Cloud → Credentials → this OAuth client → Authorized redirect URIs (exact match, no trailing slash), Save, wait ~1 min, then open ${emailPage} and Connect again.`
          : `Google redirect_uri_mismatch: add the Authorized redirect URI shown on this page under Google Cloud → Credentials → this OAuth client (exact match, no trailing slash), Save, wait ~1 min, then open ${emailPage} and Connect again.`,
        error:
          "Google connection failed (token exchange). Check server logs, then verify GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and restart the app.",
        invalid: "Google connection failed. Try again.",
        invalid_state: "Google connection failed. Try again.",
        microsoft_connected:
          "Microsoft connected. You can sync Inbox and send mail.",
        microsoft_guest:
          "Microsoft signed in as a guest (#EXT#) with no mailbox. Disconnect, then Connect again and pick your personal Outlook/Hotmail account (Azure app must allow personal accounts).",
        microsoft_denied: "Microsoft authorization was cancelled.",
        microsoft_not_configured:
          "Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to .env, then try again.",
        microsoft_error: "Microsoft connection failed. Try again.",
        microsoft_invalid: "Microsoft connection failed. Try again.",
        microsoft_invalid_state: "Microsoft connection failed. Try again.",
      };
      if (cancelled) return;
      setMessage(messages[flag] ?? "Connection status updated.");
      if (flag.includes("connected") || flag.includes("guest")) {
        await loadStatus();
      }
      setSearchParams({}, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const onConnectGoogle = () => {
    window.location.assign(oauthStartUrl("google"));
  };
  const onConnectMicrosoft = () => {
    window.location.assign(oauthStartUrl("microsoft"));
  };

  const workspace = (
    <ConfigurationShell>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
            Configuration
          </p>
          <div className="mt-1 flex items-start gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-xl bg-violet-0 text-brand">
              <Mail className="size-5" strokeWidth={1.75} />
            </span>
            <div>
              <h1 className={PAGE_H1_CLASS}>Email</h1>
              <p className="mt-1 text-sm text-text-caption">
                Connect Google or Microsoft — only one can be active. Connecting
                a new account disconnects the other.
              </p>
            </div>
          </div>
        </div>

        {message ? (
          <p className="mb-4 rounded-lg border border-border-default bg-subtle px-3 py-2 text-sm text-text-secondary">
            {message}
          </p>
        ) : null}

        <div className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
          <p className="text-sm font-medium text-text-primary">Email account</p>
          <p className="mt-1 text-sm text-text-caption">
            Used to send and receive mail. Only one provider (Google or
            Microsoft) can be connected at a time.
          </p>

          <div className="mt-5 flex flex-wrap gap-4">
            <ProviderTile
              title="Google"
              accent="#4285F4"
              icon={<GoogleGlyph className="size-10" />}
              connected={Boolean(status?.googleConnected)}
              disabled={busy}
              onClick={onConnectGoogle}
              subtitle={
                status?.googleConnected
                  ? status.googleCanSendMail
                    ? "Send ready"
                    : "Connected"
                  : status?.googleConfigured
                    ? "Click to connect"
                    : "Add GOOGLE_* to .env"
              }
            />
            <ProviderTile
              title="Microsoft"
              accent="#00A4EF"
              icon={<MicrosoftGlyph className="size-10" />}
              connected={Boolean(status?.microsoftConnected)}
              disabled={busy || !status?.microsoftConfigured}
              onClick={onConnectMicrosoft}
              subtitle={
                status?.microsoftConnected
                  ? status.microsoftIsGuest
                    ? "Guest — reconnect to send"
                    : status.microsoftCanSendMail
                      ? "Outlook send ready"
                      : "Connected — reconnect for Mail.Send"
                  : status?.microsoftConfigured
                    ? "Click to connect"
                    : "Add MICROSOFT_* to .env"
              }
            />
          </div>

          {status?.googleConnected ? (
            <ConnectedRow
              label="Google"
              email={status.googleEmail}
              pending={busy}
              onSwitch={onConnectGoogle}
              onDisconnect={() =>
                void (async () => {
                  setBusy(true);
                  const result = await disconnectGoogleEmail();
                  setBusy(false);
                  if (!result.ok) {
                    setMessage(result.error);
                    return;
                  }
                  setMessage("Google disconnected.");
                  await loadStatus();
                })()
              }
            />
          ) : null}
          {status?.microsoftConnected ? (
            <ConnectedRow
              label="Microsoft"
              email={status.microsoftDisplayEmail ?? status.microsoftEmail}
              pending={busy}
              warn={
                status.microsoftIsGuest
                  ? "Guest account — disconnect and reconnect with a real Outlook mailbox."
                  : null
              }
              onSwitch={onConnectMicrosoft}
              onDisconnect={() =>
                void (async () => {
                  setBusy(true);
                  const result = await disconnectMicrosoftEmail();
                  setBusy(false);
                  if (!result.ok) {
                    setMessage(result.error);
                    return;
                  }
                  setMessage("Microsoft disconnected.");
                  await loadStatus();
                })()
              }
            />
          ) : null}
        </div>

        {social ? (
          <div className="mt-5 rounded-xl border border-border-default bg-surface p-5 sm:p-6">
            <p className="text-sm font-medium text-text-primary">
              Social publishing
            </p>
            <p className="mt-1 text-sm text-text-caption">
              Facebook and Instagram use MyAccounts social channels assigned to
              this CRM org. LinkedIn may use separate app connections. LinkedIn
              publish needs scopes{" "}
              <span className="font-mono text-xs">
                openid profile w_member_social
              </span>
              . CRM only reads the tokens — connect or reauth in MyAccounts if
              Publish is disabled.
            </p>
            <ul className="mt-4 space-y-2">
              {social.map((item) => (
                <li
                  key={item.platform}
                  className="flex items-center justify-between rounded-lg border border-border-default bg-subtle px-3 py-2 text-sm"
                >
                  <span className="capitalize">{item.platform}</span>
                  <span className="text-text-caption">
                    {item.connected
                      ? item.accountEmail || item.displayName || "Connected"
                      : item.needsReauth
                        ? "Needs reauth"
                        : "Not connected"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </ConfigurationShell>
  );

  return (
    <AgentModuleShell
      moduleId="configuration"
      title="Email"
      welcome="I'm your **configuration agent**. Ask me about connecting Google or Microsoft mail — the settings stay fully usable on the right."
      chips={[
        {
          id: "chip-help",
          label: "What can you help with?",
          prompt: "What can you help me do with email configuration?",
        },
      ]}
      surface="list"
      workspace={workspace}
      onAfterTool={() => void loadStatus()}
    />
  );
}

function ProviderTile({
  title,
  icon,
  accent,
  connected,
  disabled,
  onClick,
  subtitle,
}: {
  title: string;
  icon: ReactNode;
  accent: string;
  connected: boolean;
  disabled?: boolean;
  onClick: () => void;
  subtitle: string;
}) {
  return (
    <div className="flex w-full max-w-[200px] flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={connected ? `Switch or reconnect ${title}` : `Connect ${title}`}
        className="group flex size-[88px] items-center justify-center rounded-2xl border border-border-default bg-white shadow-[0_1px_2px_rgba(11,11,16,0.04)] transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ outlineColor: accent }}
      >
        {icon}
      </button>
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {connected ? (
        <span className={chipClass(TONE_SUCCESS, "gap-1")}>
          <CheckCircle2 className="size-3" />
          Connected
        </span>
      ) : (
        <span className="text-center text-[11px] text-text-caption">
          {subtitle}
        </span>
      )}
    </div>
  );
}

function ConnectedRow({
  label,
  email,
  pending,
  warn,
  onSwitch,
  onDisconnect,
}: {
  label: string;
  email: string | null;
  pending: boolean;
  warn?: string | null;
  onSwitch: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border-default bg-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">
          {label} connected as{" "}
          <span className="text-text-link">{email ?? "account"}</span>
        </p>
        {warn ? <p className="mt-1 text-xs text-text-caution">{warn}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={onSwitch}
        >
          Switch
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      </div>
    </div>
  );
}
