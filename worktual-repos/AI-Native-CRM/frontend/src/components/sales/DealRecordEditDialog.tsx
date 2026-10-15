import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { DEAL_STAGE_OPTIONS } from "@/lib/deal-stages";
import { fetchContactDetail, updateContact } from "@/services/contacts";
import type { ContactInput } from "@/services/contact-types";
import { fetchCompany, updateCompany, updateLocation } from "@/services/companies";
import {
  updateDeal,
  updateDealStage,
  type ClosedWonExtras,
} from "@/services/sales";

type DealEditSnapshot = {
  id: string;
  title: string;
  stage: string;
  amount: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  expectedCloseDate: string | null;
  companyId: string;
  companyName: string;
  locationId: string;
  locationName: string;
  locationType?: string;
};

type CompanyEditSnapshot = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
};

export function DealRecordEditDialog({
  deal,
  company,
  onClose,
  onSaved,
  onWonExtras,
}: {
  deal: DealEditSnapshot;
  company: CompanyEditSnapshot;
  onClose: () => void;
  onSaved: () => void;
  onWonExtras?: (extras: ClosedWonExtras) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingContact, setLoadingContact] = useState(Boolean(deal.contactId));
  const [contactBase, setContactBase] = useState<ContactInput | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);

  const [loadingCompany, setLoadingCompany] = useState(true);
  const [companyExtra, setCompanyExtra] = useState<{
    linkedinUrl: string | null;
    ownerUserId: string | null;
  } | null>(null);
  const [locationExtra, setLocationExtra] = useState<{
    type: string;
    address: string | null;
    city: string | null;
    industry: string | null;
    ownerUserId: string | null;
  } | null>(null);

  const [dealName, setDealName] = useState(deal.title);
  const [amount, setAmount] = useState(deal.amount ?? "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(
    deal.expectedCloseDate ? deal.expectedCloseDate.slice(0, 10) : "",
  );
  const [stage, setStage] = useState(deal.stage);
  const [lostReason, setLostReason] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(deal.contactEmail ?? "");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");

  const [companyName, setCompanyName] = useState(company.name);
  const [domain, setDomain] = useState(company.domain ?? "");
  const [industry, setIndustry] = useState(company.industry ?? "");
  const [employeeCount, setEmployeeCount] = useState(
    company.employeeCount != null ? String(company.employeeCount) : "",
  );
  const [locationName, setLocationName] = useState(deal.locationName);

  useEffect(() => {
    if (!deal.contactId) {
      setLoadingContact(false);
      return;
    }
    let cancelled = false;
    setLoadingContact(true);
    void fetchContactDetail(deal.contactId).then((result) => {
      if (cancelled) return;
      setLoadingContact(false);
      if (!result.ok) {
        setError("Could not load contact details.");
        return;
      }
      const person = result.contact.person;
      setContactId(result.contact.id);
      setContactBase({
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        phone: person.phone,
        secondaryEmails: person.secondaryEmails ?? [],
        secondaryPhones: person.secondaryPhones ?? [],
        title: person.title,
        addressLine: person.addressLine,
        city: person.city,
        country: person.country,
        companyId: person.companyId,
        locationId: person.locationId,
        ownerUserId: person.ownerUserId,
        contactType: person.contactType ?? undefined,
        leadSource: person.leadSource,
        leadStatus: person.leadStatus,
        disqualifyReason: person.disqualifyReason,
        bantBudget: person.bantBudget,
        bantAuthority: person.bantAuthority,
        bantNeed: person.bantNeed,
        bantTimeline: person.bantTimeline,
        tags: person.tags ?? [],
        status: person.status ?? undefined,
        notes: person.notes,
      });
      setFirstName(person.firstName);
      setLastName(person.lastName);
      setEmail(person.email);
      setPhone(person.phone ?? "");
      setTitle(person.title ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [deal.contactId]);

  useEffect(() => {
    let cancelled = false;
    setLoadingCompany(true);
    void fetchCompany(company.id).then((result) => {
      if (cancelled) return;
      setLoadingCompany(false);
      if (!result.ok) {
        setError((prev) => prev ?? "Could not load company details.");
        return;
      }
      setCompanyExtra({
        linkedinUrl: result.company.linkedinUrl,
        ownerUserId: result.company.ownerUserId,
      });
      const loc = result.company.locations.find((l) => l.id === deal.locationId);
      if (loc) {
        setLocationExtra({
          type: loc.type,
          address: loc.address,
          city: loc.city,
          industry: loc.industry,
          ownerUserId: loc.ownerUserId,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [company.id, deal.locationId]);

  const onSave = () => {
    setError(null);

    if (!dealName.trim()) {
      setError("Deal name is required.");
      return;
    }
    if (stage === "closed_lost" && stage !== deal.stage && !lostReason.trim()) {
      setError("Add a lost reason when marking Closed lost.");
      return;
    }

    void (async () => {
      setPending(true);
      const stageChanged = stage !== deal.stage;

      const dealResult = await updateDeal(deal.id, {
        title: dealName.trim(),
        companyId: deal.companyId,
        locationId: deal.locationId,
        contactId: deal.contactId,
        // Keep the current stage here so closed-won / closed-lost side effects
        // run only through updateDealStage (same as the left-rail dropdown).
        stage: deal.stage,
        amount: amount || null,
        notes: deal.notes,
        expectedCloseDate: expectedCloseDate || null,
      });
      if (!dealResult.ok) {
        setPending(false);
        setError(dealResult.error);
        return;
      }

      if (stageChanged) {
        const stageResult = await updateDealStage(
          deal.id,
          stage,
          stage === "closed_lost" ? lostReason.trim() : undefined,
        );
        if (!stageResult.ok) {
          setPending(false);
          setError(stageResult.error);
          return;
        }
        if (stageResult.wonExtras) {
          onWonExtras?.(stageResult.wonExtras);
        }
      }

      if (contactId && contactBase) {
        const contactResult = await updateContact(contactId, {
          ...contactBase,
          firstName,
          lastName,
          email,
          phone,
          title,
        });
        if (!contactResult.ok) {
          setPending(false);
          setError(contactResult.error);
          return;
        }
      }

      const companyResult = await updateCompany(company.id, {
        name: companyName,
        domain: domain || null,
        industry: industry || null,
        employeeCount: employeeCount ? Number(employeeCount) : null,
        linkedinUrl: companyExtra?.linkedinUrl ?? null,
        ownerUserId: companyExtra?.ownerUserId ?? null,
      });
      if (!companyResult.ok) {
        setPending(false);
        setError(companyResult.error);
        return;
      }

      if (locationName.trim() && locationName.trim() !== deal.locationName) {
        const locationType: "hq" | "branch" =
          (locationExtra?.type ?? deal.locationType) === "hq" ? "hq" : "branch";
        const locResult = await updateLocation(deal.companyId, deal.locationId, {
          name: locationName.trim(),
          type: locationType,
          address: locationExtra?.address ?? null,
          city: locationExtra?.city ?? null,
          industry: locationExtra?.industry ?? null,
          ownerUserId: locationExtra?.ownerUserId ?? null,
        });
        if (!locResult.ok) {
          setPending(false);
          setError(locResult.error);
          return;
        }
      }

      setPending(false);
      onSaved();
      onClose();
    })();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deal-record-edit-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border-default bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default px-5 py-4">
          <div>
            <h2
              id="deal-record-edit-title"
              className="text-base font-semibold text-text-primary"
            >
              Edit deal details
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              Update deal, contact, and company details — including amount and
              stage
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-text-caption hover:text-text-primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">
              Deal details
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Deal name"
                className="sm:col-span-2"
                value={dealName}
                onChange={(e) => setDealName(e.target.value)}
                required
              />
              <Input
                label="Deal amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Input
                label="Expected close"
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
              />
              <Select
                label="Stage"
                className="sm:col-span-2"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                options={DEAL_STAGE_OPTIONS}
              />
              {stage === "closed_lost" && stage !== deal.stage ? (
                <Textarea
                  className="sm:col-span-2"
                  label="Lost reason"
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  rows={3}
                  required
                />
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">
              Contact details
            </h3>
            {!deal.contactId ? (
              <p className="text-sm text-text-caption">
                No contact linked to this deal.
              </p>
            ) : loadingContact ? (
              <p className="text-sm text-text-caption">Loading contact…</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
                <Input
                  label="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
                <Input
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Input
                  label="Phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <Input
                  label="Title"
                  className="sm:col-span-2"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-text-primary">
              Company details
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
              <Input
                label="Domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
              <Input
                label="Industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
              <Input
                label="Employees"
                type="number"
                min={0}
                value={employeeCount}
                onChange={(e) => setEmployeeCount(e.target.value)}
              />
              <Input
                label="Location"
                className="sm:col-span-2"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
              />
            </div>
          </section>

          {error ? (
            <p className="text-sm text-text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-border-default px-5 py-4">
          <Button
            type="button"
            variant="primary"
            disabled={pending || loadingContact || loadingCompany}
            onClick={onSave}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
