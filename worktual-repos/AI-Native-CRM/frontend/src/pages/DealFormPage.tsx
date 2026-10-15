import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { COWORKER_WORKSPACE_SCROLL } from "@/components/coworker/coworker-layout";
import {
  DealDuplicateWarning,
  useDealDuplicateCheck,
} from "@/components/sales/DealDuplicateWarning";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { BackLink } from "@/components/ui/BackLink";
import { Textarea } from "@/components/ui/Textarea";
import { DEAL_STAGE_LABELS, DEAL_STAGES } from "@/lib/deal-stages";
import {
  createDeal,
  fetchDeal,
  fetchDealFormOptions,
  updateDeal,
  type DealFormOptions,
} from "@/services/sales";
import { DealFormPageSkeleton } from "./DealFormPageSkeleton";

export function DealFormPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const isEdit = Boolean(dealId);
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
    enabled: !isEdit,
    companyId,
    contactId,
  });

  const locations = useMemo(() => {
    const company = options?.companies.find((c) => c.id === companyId);
    return company?.locations ?? [];
  }, [options, companyId]);

  const contacts = useMemo(() => {
    if (!options) return [];
    if (!companyId) return options.contacts;
    return options.contacts.filter(
      (c) => !c.companyId || c.companyId === companyId,
    );
  }, [options, companyId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const opts = await fetchDealFormOptions();
        if (cancelled) return;
        setOptions(opts);
        if (dealId) {
          const result = await fetchDeal(dealId);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          const d = result.deal;
          setTitle(d.title);
          setStage(d.stage);
          setAmount(d.amount ?? "");
          setCompanyId(d.companyId);
          setLocationId(d.locationId);
          setContactId(d.contactId ?? "");
          setNotes(d.notes ?? "");
          setExpectedCloseDate(
            d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : "",
          );
        }
      } catch {
        if (!cancelled) setError("Failed to load form.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

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
    const body = {
      title,
      stage,
      amount: amount.trim() ? Number(amount) : null,
      companyId,
      locationId,
      contactId: contactId || null,
      notes: notes || null,
      expectedCloseDate: expectedCloseDate || null,
    };
    const result =
      isEdit && dealId ? await updateDeal(dealId, body) : await createDeal(body);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate(`/sales/${result.id}`);
  };

  if (loading) {
    return (
      <AgentModuleShell
        moduleId="sales"
        title={isEdit ? "Edit deal" : "New deal"}
        welcome="I'm your **deal agent**. Ask about stage changes while the form loads on the right."
        surface="detail"
        entityId={dealId ?? null}
        workspace={<DealFormPageSkeleton />}
      />
    );
  }

  const workspace = (
    <div
      className={`crm-fade-in mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 ${COWORKER_WORKSPACE_SCROLL}`}
    >
      <BackLink to="/sales">Back to sales</BackLink>
      <h1 className="mt-2 text-xl font-semibold text-text-primary">
        {isEdit ? "Edit deal" : "New deal"}
      </h1>

      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-4 rounded-xl border border-border-default bg-surface p-5"
      >
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Stage"
            options={DEAL_STAGES.map((s) => ({
              value: s,
              label: DEAL_STAGE_LABELS[s],
            }))}
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          />
          <Input
            label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Select
            label="Company"
            options={[
              { value: "", label: "Select company" },
              ...(options?.companies.map((c) => ({
                value: c.id,
                label: c.name,
              })) ?? []),
            ]}
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setLocationId("");
            }}
            required
          />
          <Select
            label="Location"
            options={[
              { value: "", label: "Select location" },
              ...locations.map((l) => ({
                value: l.id,
                label: `${l.name} (${l.type})`,
              })),
            ]}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            required
          />
          <Select
            label="Contact"
            options={[
              { value: "", label: "No contact" },
              ...contacts.map((c) => ({
                value: c.id,
                label: `${c.displayName} (${c.email})`,
              })),
            ]}
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
          />
          <Input
            label="Expected close"
            type="date"
            value={expectedCloseDate}
            onChange={(e) => setExpectedCloseDate(e.target.value)}
          />
        </div>

        <DealDuplicateWarning
          checking={checkingDup}
          duplicates={duplicates}
          acknowledged={duplicateAck}
          onAcknowledge={() => {
            setDuplicateAck(true);
            setError(null);
          }}
        />

        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {error ? <p className="text-sm text-text-danger">{error}</p> : null}

        <div className="flex gap-3">
          <Button type="submit" disabled={saving || checkingDup}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create deal"}
          </Button>
          <Link to={isEdit && dealId ? `/sales/${dealId}` : "/sales"}>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );

  if (!isEdit) return workspace;

  return (
    <AgentModuleShell
      moduleId="sales"
      title={title.trim() ? `Edit ${title}` : "Edit deal"}
      welcome={`I'm your **deal agent** for **${title || "this deal"}**. Ask about stage changes or next steps while you edit the form on the right.`}
      chips={[
        {
          id: "chip-stage",
          label: "Move to Propose",
          prompt: "Propose moving this deal to Propose stage",
        },
        {
          id: "chip-quote",
          label: "Create a quote",
          prompt: "Help me create a new quote for this deal",
        },
      ]}
      surface="detail"
      entityId={dealId ?? null}
      workspace={workspace}
    />
  );
}
