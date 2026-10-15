import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfigurationShell } from "@/components/configuration/ConfigurationShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  fetchFinanceBillingSettings,
  patchFinanceBillingSettings,
  type FinanceBillingSettings,
} from "@/services/configuration";
import { PAGE_H1_CLASS } from "@/lib/ui-tones";

const emptyBank = {
  accountName: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  iban: "",
  swift: "",
  notes: "",
};

type BankForm = typeof emptyBank;

const BANK_FIELDS = [
  ["accountName", "Account name"],
  ["bankName", "Bank name"],
  ["accountNumber", "Account number"],
  ["ifsc", "IFSC / routing"],
  ["iban", "IBAN"],
  ["swift", "SWIFT"],
] as const;

function bankFromSettings(settings: FinanceBillingSettings): BankForm {
  return {
    accountName: settings.bankDetails?.accountName ?? "",
    bankName: settings.bankDetails?.bankName ?? "",
    accountNumber: settings.bankDetails?.accountNumber ?? "",
    ifsc: settings.bankDetails?.ifsc ?? "",
    iban: settings.bankDetails?.iban ?? "",
    swift: settings.bankDetails?.swift ?? "",
    notes: settings.bankDetails?.notes ?? "",
  };
}

function hasBankDetails(bank: BankForm): boolean {
  return BANK_FIELDS.some(([key]) => Boolean(bank[key]?.trim()));
}

export function FinanceBillingSettingsPage() {
  const [settings, setSettings] = useState<FinanceBillingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedBank, setSavedBank] = useState<BankForm>({ ...emptyBank });
  const [bank, setBank] = useState<BankForm>({ ...emptyBank });

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchFinanceBillingSettings();
      const next = bankFromSettings(data.settings);
      setSettings(data.settings);
      setSavedBank(next);
      setBank(next);
      return next;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load billing settings.",
      );
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saved = useMemo(() => hasBankDetails(savedBank), [savedBank]);

  const startEdit = () => {
    setError(null);
    setMessage(null);
    setBank({ ...savedBank });
    setEditing(true);
  };

  const cancelEdit = () => {
    setError(null);
    setBank({ ...savedBank });
    setEditing(false);
  };

  const onSave = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await patchFinanceBillingSettings({
        bankDetails: {
          accountName: bank.accountName.trim(),
          bankName: bank.bankName.trim(),
          accountNumber: bank.accountNumber.trim(),
          ifsc: bank.ifsc.trim(),
          iban: bank.iban.trim(),
          swift: bank.swift.trim(),
          notes: bank.notes.trim(),
        },
      });
      if (!result || result.ok === false) {
        setError(
          result && "error" in result && result.error
            ? result.error
            : "Failed to save bank details.",
        );
        return;
      }
      const next = result.settings
        ? bankFromSettings(result.settings)
        : {
            accountName: bank.accountName.trim(),
            bankName: bank.bankName.trim(),
            accountNumber: bank.accountNumber.trim(),
            ifsc: bank.ifsc.trim(),
            iban: bank.iban.trim(),
            swift: bank.swift.trim(),
            notes: bank.notes.trim(),
          };
      if (result.settings) setSettings(result.settings);
      setSavedBank(next);
      setBank(next);
      setEditing(false);
      setMessage("Bank details saved.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save bank details.",
      );
    } finally {
      setBusy(false);
    }
  };

  const workspace = (
    <ConfigurationShell>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className={PAGE_H1_CLASS}>Billing & payments</h1>
        <p className="mt-2 text-sm text-text-caption">
          Bank details for offline invoice payments. Product billing (one-time vs
          recurring) is set on each product. Payment gateway credentials are
          managed in My Account.
        </p>

        {error ? (
          <p className="mt-4 text-sm text-text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {message && !editing ? (
          <p className="mt-4 text-sm text-emerald-700">{message}</p>
        ) : null}

        {!settings && !error ? (
          <p className="mt-8 text-sm text-text-caption">Loading…</p>
        ) : settings ? (
          <div className="mt-8 space-y-4">
            <section className="space-y-3 rounded-lg border border-border-default p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-text-primary">
                  Bank details (offline PDF)
                </h2>
                {!editing ? (
                  <Button
                    type="button"
                    variant="brand"
                    size="md"
                    onClick={startEdit}
                  >
                    {saved ? "Update bank details" : "Add bank details"}
                  </Button>
                ) : null}
              </div>

              {editing ? (
                <>
                  {BANK_FIELDS.map(([key, label]) => (
                    <Input
                      key={key}
                      label={label}
                      value={bank[key]}
                      onChange={(e) =>
                        setBank((b) => ({ ...b, [key]: e.target.value }))
                      }
                    />
                  ))}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      variant="brand"
                      disabled={busy}
                      onClick={() => void onSave()}
                    >
                      {busy ? "Saving…" : "Save bank details"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={cancelEdit}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : saved ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {BANK_FIELDS.map(([key, label]) => {
                    const value = savedBank[key]?.trim();
                    if (!value) return null;
                    return (
                      <div key={key} className="min-w-0">
                        <dt className="text-xs text-text-caption">{label}</dt>
                        <dd className="mt-0.5 break-all text-sm font-medium text-text-primary">
                          {value}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : (
                <p className="text-sm text-text-caption">
                  No bank details yet. Add them so offline invoice PDFs show your
                  account for payment.
                </p>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </ConfigurationShell>
  );

  return (
    <AgentModuleShell
      moduleId="configuration"
      title="Configuration"
      welcome="Set the bank account printed on offline invoices."
      surface="list"
      workspace={workspace}
    />
  );
}
