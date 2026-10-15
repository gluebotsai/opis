import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ConfigurationShell } from "@/components/configuration/ConfigurationShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  fetchLeadNurtureSettings,
  patchLeadNurtureSettings,
  type LeadNurtureSettings,
} from "@/services/configuration";
import { canEditOrgSettings, normalizeRole } from "@/lib/rbac";
import { useAppSelector } from "@/store";
import { PAGE_H1_CLASS } from "@/lib/ui-tones";

export function LeadNurtureSettingsPage() {
  const role = normalizeRole(useAppSelector((s) => s.auth.user?.role));
  const [settings, setSettings] = useState<LeadNurtureSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchLeadNurtureSettings();
      setSettings(data);
      setEnabled(data.nurtureCallEnabled);
      setDelayMinutes(data.nurtureCallDelayMinutes);
    } catch (err) {
      const raw =
        err instanceof Error ? err.message : "Failed to load nurture settings.";
      setError(
        raw === "No data found"
          ? "Lead nurture API is unavailable (404). Restart the CRM API server with the latest code, run the org_nurture_settings migration, then refresh this page."
          : raw.includes("org_nurture_settings")
            ? "Database table missing. Run Prisma migrate for org_nurture_settings, then refresh."
            : raw,
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canEditOrgSettings(role)) {
    return <Navigate to="/configuration/email" replace />;
  }

  const onSave = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await patchLeadNurtureSettings({
        nurtureCallEnabled: enabled,
        nurtureCallDelayMinutes: Number(delayMinutes),
      });
      if (!result.ok) {
        setError(result.error || "Save failed.");
        return;
      }
      setSettings(result.settings);
      setEnabled(result.settings.nurtureCallEnabled);
      setDelayMinutes(result.settings.nurtureCallDelayMinutes);
      setEditing(false);
      setMessage("Lead nurture settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const workspace = (
    <ConfigurationShell>
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className={PAGE_H1_CLASS}>Lead nurture</h1>
        <p className="mt-2 text-sm text-text-caption">
          When voice nurture is enabled, below-gate unowned leads with a phone
          number receive an autonomous cc-core voice bot call after the delay.
          Email via Campaign remains primary when voice is off or when the
          contact has no phone. Voice calls stop once the lead shows buying
          intent (demo, meeting, scheduling reply, etc.).
        </p>

        {error ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {message && !editing ? (
          <p className="mt-4 text-sm text-emerald-700">{message}</p>
        ) : null}

        {!settings && !error ? (
          <p className="mt-8 text-sm text-text-caption">Loading…</p>
        ) : settings ? (
          <div className="mt-8 space-y-6 rounded-lg border border-border-default bg-surface p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-text-primary">
                Voice nurture
              </h2>
              {!editing ? (
                <Button
                  type="button"
                  variant="brand"
                  size="md"
                  onClick={() => {
                    setError(null);
                    setMessage(null);
                    setEnabled(settings.nurtureCallEnabled);
                    setDelayMinutes(settings.nurtureCallDelayMinutes);
                    setEditing(true);
                  }}
                >
                  Update
                </Button>
              ) : null}
            </div>

            {editing ? (
              <>
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-border-default"
                  />
                  <span className="text-sm font-medium text-text-primary">
                    Enable nurture voice calls
                  </span>
                </label>

                <div>
                  <label
                    htmlFor="nurture-call-delay"
                    className="mb-1 block text-sm font-medium text-text-primary"
                  >
                    Delay before first call (minutes)
                  </label>
                  <Input
                    id="nurture-call-delay"
                    type="number"
                    min={1}
                    max={10080}
                    value={delayMinutes}
                    onChange={(e) => setDelayMinutes(Number(e.target.value))}
                    disabled={!enabled}
                  />
                  <p className="mt-1 text-xs text-text-caption">
                    Measured from when the nurture job is first ready to send.
                    Email timing is unchanged.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="brand"
                    onClick={() => void onSave()}
                    disabled={busy}
                  >
                    {busy ? "Saving…" : "Save settings"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEnabled(settings.nurtureCallEnabled);
                      setDelayMinutes(settings.nurtureCallDelayMinutes);
                      setError(null);
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-text-caption">Voice calls</dt>
                  <dd className="mt-0.5 text-sm font-medium text-text-primary">
                    {settings.nurtureCallEnabled ? "Enabled" : "Disabled"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-text-caption">
                    Delay before first call
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-text-primary">
                    {settings.nurtureCallEnabled
                      ? `${settings.nurtureCallDelayMinutes} minutes`
                      : "Not used while voice calls are off"}
                  </dd>
                </div>
              </dl>
            )}

            {settings && !settings.ccCoreVoiceConfigured ? (
              <p className="text-sm text-amber-700">
                cc-core voice is not configured on this CRM deployment (
                <code className="text-xs">CC_CORE_API_BASE_URL</code> and{" "}
                <code className="text-xs">CC_CORE_INTERNAL_SERVICE_KEY</code>).
                Calls will not dial until those env vars are set.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </ConfigurationShell>
  );

  return (
    <AgentModuleShell
      moduleId="configuration"
      title="Lead nurture"
      welcome="I'm your **configuration agent**. Ask me about lead nurture voice settings — the controls stay fully usable on the right."
      surface="list"
      workspace={workspace}
    />
  );
}
