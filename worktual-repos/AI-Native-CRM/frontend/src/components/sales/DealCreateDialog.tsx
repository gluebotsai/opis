import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  DealDuplicateWarning,
  useDealDuplicateCheck,
} from "@/components/sales/DealDuplicateWarning";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { DEAL_STAGE_OPTIONS } from "@/lib/deal-stages";
import {
  createDeal,
  fetchDealFormOptions,
  type DealFormOptions,
} from "@/services/sales";

export function DealCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<DealFormOptions | null>(null);

  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("qualification");
  const [amount, setAmount] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [contactId, setContactId] = useState("");
  const [notes, setNotes] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");

  const {
    checking: checkingDup,
    duplicates,
    acknowledged: duplicateAck,
    setAcknowledged: setDuplicateAck,
    blocked: duplicateBlocked,
  } = useDealDuplicateCheck({
    enabled: true,
    companyId,
    contactId,
  });

  useEffect(() => {
    let cancelled = false;
    void fetchDealFormOptions()
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        const first = opts.companies[0];
        if (first) {
          setCompanyId(first.id);
          setLocationId(first.locations[0]?.id ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load form options.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const companies = options?.companies ?? [];
  const locations = useMemo(() => {
    const company = companies.find((c) => c.id === companyId);
    return company?.locations ?? [];
  }, [companies, companyId]);

  const contacts = useMemo(() => {
    if (!options) return [];
    return options.contacts.filter(
      (c) => !c.companyId || c.companyId === companyId,
    );
  }, [options, companyId]);

  useEffect(() => {
    if (!locationId) return;
    if (!locations.some((l) => l.id === locationId)) {
      setLocationId(locations[0]?.id ?? "");
    }
  }, [locations, locationId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (duplicateBlocked) {
      setError(
        "An open deal already exists for this company/contact. Click Continue anyway to create, or view the existing deal.",
      );
      return;
    }
    setSaving(true);
    const result = await createDeal({
      title,
      stage,
      amount: amount.trim() ? Number(amount) : null,
      companyId,
      locationId,
      contactId: contactId || null,
      notes: notes || null,
      expectedCloseDate: expectedCloseDate || null,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated?.(result.id);
    onClose();
  };

  if (loading) {
    return (
      <DialogShell title="New deal" onClose={onClose}>
        <p className="text-sm text-text-caption">Loading…</p>
      </DialogShell>
    );
  }

  if (companies.length === 0) {
    return (
      <DialogShell title="New deal" onClose={onClose}>
        <p className="text-sm text-text-caption">
          Create a company and location first, then add deals.
        </p>
        <Button
          className="mt-4"
          variant="primary"
          onClick={() => {
            onClose();
            navigate("/company/new");
          }}
        >
          Add company
        </Button>
      </DialogShell>
    );
  }

  return (
    <DialogShell title="New deal" onClose={onClose}>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <Select
          label="Company"
          required
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value);
            setContactId("");
          }}
          options={companies.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          label="Location"
          required
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          options={
            locations.length > 0
              ? locations.map((l) => ({
                  value: l.id,
                  label: `${l.name} (${l.type === "hq" ? "HQ" : "Branch"})`,
                }))
              : [{ value: "", label: "No locations — add one first" }]
          }
        />
        <Select
          label="Contact"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
          options={[
            { value: "", label: "No contact" },
            ...contacts.map((c) => ({
              value: c.id,
              label: `${c.displayName} · ${c.email}`,
            })),
          ]}
        />

        <DealDuplicateWarning
          checking={checkingDup}
          duplicates={duplicates}
          acknowledged={duplicateAck}
          onAcknowledge={() => {
            setDuplicateAck(true);
            setError(null);
          }}
          onNavigateAway={onClose}
        />

        <Select
          label="Stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          options={DEAL_STAGE_OPTIONS}
        />
        <Input
          label="Amount"
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          label="Expected close date"
          type="date"
          value={expectedCloseDate}
          onChange={(e) => setExpectedCloseDate(e.target.value)}
        />
        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {error ? <p className="text-sm text-text-danger">{error}</p> : null}
        <div className="flex gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={saving || checkingDup}
          >
            {saving ? "Saving…" : "Create deal"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
        <p className="text-xs text-text-caption">
          Prefer the full form?{" "}
          <Link
            to="/sales/new"
            className="font-medium text-text-link hover:underline"
            onClick={onClose}
          >
            Open new deal page
          </Link>
        </p>
      </form>
    </DialogShell>
  );
}

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deal-dialog-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border-default bg-surface p-5 shadow-lg sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="deal-dialog-title"
          className="text-base font-semibold text-text-primary"
        >
          {title}
        </h3>
        <p className="mt-1 text-sm text-text-caption">
          Add an opportunity to the pipeline without leaving this page.
        </p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
