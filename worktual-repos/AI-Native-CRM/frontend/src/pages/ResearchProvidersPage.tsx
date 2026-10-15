import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfigurationShell } from "@/components/configuration/ConfigurationShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  fetchInternalDomains,
  fetchResearchProviders,
  patchInternalDomains,
  patchResearchIcp,
  type InternalDomainsState,
  type LeadIcpConfig,
  type ResearchProviderId,
  type ResearchProviderView,
} from "@/services/configuration";
import { PAGE_H1_CLASS } from "@/lib/ui-tones";

const PROVIDER_LABELS: Record<ResearchProviderId, string> = {
  apollo: "Apollo",
  zoominfo: "ZoomInfo",
  lusha: "Lusha",
  builtwith: "BuiltWith",
};

const ICP_FIELDS = [
  ["industries", "Target industries"],
  ["adjacent", "Adjacent industries"],
  ["sizeTiers", "Size tiers"],
  ["geos", "Serviceable geos"],
  ["competitorStacks", "Competitor / tech stacks"],
] as const;

type IcpForm = {
  industries: string;
  adjacent: string;
  sizeTiers: string;
  geos: string;
  competitorStacks: string;
};

const emptyIcp: IcpForm = {
  industries: "",
  adjacent: "",
  sizeTiers: "",
  geos: "",
  competitorStacks: "",
};

function csvFromList(values?: string[] | null): string {
  return (values ?? []).join(", ");
}

function listFromCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function icpFromData(
  leadIcp: LeadIcpConfig | null | undefined,
  competitorStacks: string[],
): IcpForm {
  const icp = leadIcp ?? {};
  return {
    industries: csvFromList(icp.targetIndustries),
    adjacent: csvFromList(icp.adjacentIndustries),
    sizeTiers: csvFromList(icp.sizeTiers),
    geos: csvFromList(icp.serviceableGeos),
    competitorStacks: csvFromList(competitorStacks),
  };
}

function hasIcpValues(form: IcpForm): boolean {
  return ICP_FIELDS.some(([key]) => Boolean(form[key]?.trim()));
}

function providerStatusLabel(p: ResearchProviderView): string {
  if (p.source === "accounts" && p.configured) {
    return p.accountEmail || p.displayName || p.apiKeyHint || "Connected in MyAccounts";
  }
  if (p.needsReauth) return "Needs reauth in MyAccounts";
  if (p.source === "crm_legacy" && p.configured) {
    return `Legacy key on file (${p.apiKeyHint ?? "••••"}) — move to MyAccounts`;
  }
  return "Not connected in MyAccounts";
}

export function ResearchProvidersPage() {
  const [providers, setProviders] = useState<ResearchProviderView[]>([]);
  const [savedIcp, setSavedIcp] = useState<IcpForm>({ ...emptyIcp });
  const [icp, setIcp] = useState<IcpForm>({ ...emptyIcp });
  const [editingIcp, setEditingIcp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [domainsState, setDomainsState] = useState<InternalDomainsState | null>(
    null,
  );
  const [manualDomainsInput, setManualDomainsInput] = useState("");
  const [overrideEmailsInput, setOverrideEmailsInput] = useState("");
  const [editingDomains, setEditingDomains] = useState(false);
  const [editingOverrides, setEditingOverrides] = useState(false);
  const [domainsBusy, setDomainsBusy] = useState(false);
  const [domainsError, setDomainsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchResearchProviders();
      setProviders(data.providers);
      const next = icpFromData(data.leadIcp, data.competitorStacks);
      setSavedIcp(next);
      setIcp(next);
      return next;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load research settings.",
      );
      return null;
    }
  }, []);

  const loadDomains = useCallback(async () => {
    setDomainsError(null);
    try {
      const data = await fetchInternalDomains();
      setDomainsState(data.state);
      setManualDomainsInput(data.state.domains.join(", "));
      setOverrideEmailsInput(data.state.overrideEmails.join(", "));
    } catch (err) {
      setDomainsError(
        err instanceof Error
          ? err.message
          : "Failed to load internal domains.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
    void loadDomains();
  }, [load, loadDomains]);

  const saveManualDomains = async () => {
    setDomainsBusy(true);
    setDomainsError(null);
    try {
      const result = await patchInternalDomains({
        domains: listFromCsv(manualDomainsInput),
      });
      if (!result || result.ok === false) {
        setDomainsError(
          result && "error" in result
            ? result.error
            : "Failed to save internal domains.",
        );
        return;
      }
      setDomainsState(result.state);
      setEditingDomains(false);
    } catch (err) {
      setDomainsError(
        err instanceof Error ? err.message : "Failed to save internal domains.",
      );
    } finally {
      setDomainsBusy(false);
    }
  };

  const saveOverrideEmails = async () => {
    setDomainsBusy(true);
    setDomainsError(null);
    try {
      const result = await patchInternalDomains({
        overrideEmails: listFromCsv(overrideEmailsInput),
      });
      if (!result || result.ok === false) {
        setDomainsError(
          result && "error" in result
            ? result.error
            : "Failed to save overrides.",
        );
        return;
      }
      setDomainsState(result.state);
      setEditingOverrides(false);
    } catch (err) {
      setDomainsError(
        err instanceof Error ? err.message : "Failed to save overrides.",
      );
    } finally {
      setDomainsBusy(false);
    }
  };

  const icpSaved = useMemo(() => hasIcpValues(savedIcp), [savedIcp]);

  const startEditIcp = () => {
    setError(null);
    setMessage(null);
    setIcp({ ...savedIcp });
    setEditingIcp(true);
  };

  const cancelEditIcp = () => {
    setError(null);
    setIcp({ ...savedIcp });
    setEditingIcp(false);
  };

  const saveIcp = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await patchResearchIcp({
        leadIcp: {
          targetIndustries: listFromCsv(icp.industries),
          adjacentIndustries: listFromCsv(icp.adjacent),
          sizeTiers: listFromCsv(icp.sizeTiers),
          serviceableGeos: listFromCsv(icp.geos),
        },
        competitorStacks: listFromCsv(icp.competitorStacks),
      });
      if (!result || result.ok === false) {
        setError(
          result && "error" in result ? result.error : "Failed to save ICP.",
        );
        return;
      }
      const next = icpFromData(result.leadIcp, result.competitorStacks);
      setSavedIcp(next);
      setIcp(next);
      setEditingIcp(false);
      setMessage("ICP and competitor stacks saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save ICP.");
    } finally {
      setBusy(false);
    }
  };

  const workspace = (
    <ConfigurationShell>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className={PAGE_H1_CLASS}>Research providers</h1>
        <p className="mt-2 text-sm text-text-caption">
          Apollo, Lusha, and BuiltWith keys live in MyAccounts. ZoomInfo uses the
          Worktual gateway (search free; enrich costs 1 data credit) when
          ZOOMINFO_GATEWAY_TOKEN is set — connect ZoomInfo for the org in
          MyAccounts. Contact chat can pull prospects and enrich an open contact.
          ICP defaults below still live in CRM and feed scoring and qualify.
        </p>

        {error ? (
          <p className="mt-4 text-sm text-text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {message && !editingIcp ? (
          <p className="mt-4 text-sm text-emerald-700">{message}</p>
        ) : null}

        <div className="mt-8 space-y-6">
          <section className="space-y-3 rounded-lg border border-border-default p-4">
            <h2 className="text-sm font-semibold text-text-primary">
              Provider connections (MyAccounts)
            </h2>
            <p className="text-sm text-text-caption">
              Connect or rotate keys in MyAccounts. This page does not store
              provider API keys.
            </p>
            <ul className="space-y-2">
              {providers.map((p) => (
                <li
                  key={p.provider}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-subtle px-3 py-2 text-sm"
                >
                  <span className="font-medium text-text-primary">
                    {PROVIDER_LABELS[p.provider]}
                  </span>
                  <span className="text-right text-text-caption">
                    {providerStatusLabel(p)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3 rounded-lg border border-border-default p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-text-primary">
                ICP defaults (Fit scoring + qualify)
              </h2>
              {!editingIcp ? (
                <Button
                  type="button"
                  variant="brand"
                  size="md"
                  onClick={startEditIcp}
                >
                  {icpSaved ? "Update ICP" : "Add ICP"}
                </Button>
              ) : null}
            </div>

            {editingIcp ? (
              <>
                <Input
                  label="Target industries (comma-separated)"
                  value={icp.industries}
                  onChange={(e) =>
                    setIcp((prev) => ({ ...prev, industries: e.target.value }))
                  }
                />
                <Input
                  label="Adjacent industries"
                  value={icp.adjacent}
                  onChange={(e) =>
                    setIcp((prev) => ({ ...prev, adjacent: e.target.value }))
                  }
                />
                <Input
                  label="Size tiers (e.g. 51-200, 201-1000)"
                  value={icp.sizeTiers}
                  onChange={(e) =>
                    setIcp((prev) => ({ ...prev, sizeTiers: e.target.value }))
                  }
                />
                <Input
                  label="Serviceable geos (e.g. IN, US)"
                  value={icp.geos}
                  onChange={(e) =>
                    setIcp((prev) => ({ ...prev, geos: e.target.value }))
                  }
                />
                <Input
                  label="Competitor / tech stacks (BuiltWith filters)"
                  value={icp.competitorStacks}
                  onChange={(e) =>
                    setIcp((prev) => ({
                      ...prev,
                      competitorStacks: e.target.value,
                    }))
                  }
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="brand"
                    disabled={busy}
                    onClick={() => void saveIcp()}
                  >
                    {busy ? "Saving…" : "Save ICP"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={cancelEditIcp}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : icpSaved ? (
              <dl className="grid gap-3 sm:grid-cols-2">
                {ICP_FIELDS.map(([key, label]) => {
                  const value = savedIcp[key]?.trim();
                  if (!value) return null;
                  return (
                    <div key={key} className="min-w-0">
                      <dt className="text-xs text-text-caption">{label}</dt>
                      <dd className="mt-0.5 break-words text-sm font-medium text-text-primary">
                        {value}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="text-sm text-text-caption">
                No ICP defaults yet. Add industries, size tiers, and geos so
                lead scoring and prospect pull can use them.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-border-default p-4">
            <h2 className="text-sm font-semibold text-text-primary">
              Internal domains (Meeting Assist)
            </h2>
            <p className="text-sm text-text-caption">
              Which email domains count as "your team" — used to tell
              internal meetings apart from customer calls. Auto-derived from
              your team's sign-in emails; free providers (Gmail, Yahoo,
              Outlook, ...) are never treated as internal.
            </p>

            {domainsError ? (
              <p className="text-sm text-text-danger" role="alert">
                {domainsError}
              </p>
            ) : null}

            {domainsState?.mode === "needs_manual" ? (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">
                  We couldn't auto-detect a company domain — everyone signs in
                  with a free email provider. Enter your domain(s) so internal
                  meetings can be recognized correctly.
                </p>
                <Input
                  label="Internal domain(s), comma-separated (e.g. worktual.com)"
                  value={manualDomainsInput}
                  onChange={(e) => setManualDomainsInput(e.target.value)}
                />
                <Button
                  type="button"
                  variant="brand"
                  disabled={domainsBusy}
                  onClick={() => void saveManualDomains()}
                >
                  {domainsBusy ? "Saving…" : "Save domain(s)"}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-text-primary">
                    {domainsState?.domains.length
                      ? domainsState.domains.join(", ")
                      : "None detected yet"}
                    <span className="ml-2 text-xs text-text-caption">
                      ({domainsState?.mode === "manual" ? "admin-entered" : "auto-detected"})
                    </span>
                  </p>
                  {!editingDomains ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      onClick={() => setEditingDomains(true)}
                    >
                      Override
                    </Button>
                  ) : null}
                </div>
                {editingDomains ? (
                  <>
                    <Input
                      label="Internal domain(s), comma-separated"
                      value={manualDomainsInput}
                      onChange={(e) => setManualDomainsInput(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        variant="brand"
                        disabled={domainsBusy}
                        onClick={() => void saveManualDomains()}
                      >
                        {domainsBusy ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={domainsBusy}
                        onClick={() => {
                          setEditingDomains(false);
                          setManualDomainsInput(
                            (domainsState?.domains ?? []).join(", "),
                          );
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            )}

            <div className="space-y-2 border-t border-border-default pt-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium text-text-primary">
                  Treat these specific addresses as internal
                </p>
                {!editingOverrides ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={() => setEditingOverrides(true)}
                  >
                    {domainsState?.overrideEmails.length ? "Edit" : "Add"}
                  </Button>
                ) : null}
              </div>
              <p className="text-sm text-text-caption">
                For teammates who sign in with a personal or alias email
                instead of the company domain above.
              </p>
              {editingOverrides ? (
                <>
                  <Input
                    label="Specific email(s), comma-separated"
                    value={overrideEmailsInput}
                    onChange={(e) => setOverrideEmailsInput(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      variant="brand"
                      disabled={domainsBusy}
                      onClick={() => void saveOverrideEmails()}
                    >
                      {domainsBusy ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={domainsBusy}
                      onClick={() => {
                        setEditingOverrides(false);
                        setOverrideEmailsInput(
                          (domainsState?.overrideEmails ?? []).join(", "),
                        );
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : domainsState?.overrideEmails.length ? (
                <p className="text-sm text-text-primary">
                  {domainsState.overrideEmails.join(", ")}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </ConfigurationShell>
  );

  return (
    <AgentModuleShell
      moduleId="configuration"
      title="Research providers"
      welcome="I'm your **configuration agent**. Research API keys come from MyAccounts; ICP defaults stay editable here."
      workspace={workspace}
    />
  );
}
