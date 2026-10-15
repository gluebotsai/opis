import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { createLocation, updateLocation } from "@/services/companies";
import { PAGE_H1_CLASS } from "@/lib/ui-tones";

export type OwnerOption = {
  id: string;
  label: string;
};

export function LocationForm({
  mode,
  companyId,
  hasHq = false,
  location,
  assignableUsers = [],
  canAssignOwner = false,
  currentUserId = null,
}: {
  mode: "create" | "edit";
  companyId: string;
  /** True when the company already has an HQ (other than this location when editing). */
  hasHq?: boolean;
  location?: {
    id: string;
    name: string;
    type: "hq" | "branch";
    address: string | null;
    industry: string | null;
    ownerUserId: string | null;
  };
  assignableUsers?: OwnerOption[];
  canAssignOwner?: boolean;
  currentUserId?: string | null;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isEditingHq = location?.type === "hq";
  const canChooseHq = !hasHq || isEditingHq;

  const [name, setName] = useState(location?.name ?? "");
  const [type, setType] = useState<"hq" | "branch">(
    location?.type ?? "branch",
  );
  const [address, setAddress] = useState(location?.address ?? "");
  const [industry, setIndustry] = useState(location?.industry ?? "");

  const defaultOwnerId =
    location?.ownerUserId ?? currentUserId ?? assignableUsers[0]?.id ?? "";
  const [ownerUserId, setOwnerUserId] = useState(defaultOwnerId);
  const [ownerTouched, setOwnerTouched] = useState(false);

  // When create options load after the form is already open, fill the default owner.
  useEffect(() => {
    if (mode !== "create" || ownerTouched) return;
    const next = currentUserId ?? assignableUsers[0]?.id ?? "";
    if (next && next !== ownerUserId) {
      setOwnerUserId(next);
    }
  }, [mode, ownerTouched, currentUserId, assignableUsers, ownerUserId]);

  // If HQ already exists and we're creating, force branch.
  useEffect(() => {
    if (mode === "create" && hasHq && type === "hq") {
      setType("branch");
    }
  }, [mode, hasHq, type]);

  const ownerOptions = useMemo(() => {
    const options = assignableUsers.map((u) => ({
      value: u.id,
      label: u.label,
    }));
    const lockedId = ownerUserId || defaultOwnerId;
    if (lockedId && !options.some((o) => o.value === lockedId)) {
      options.unshift({ value: lockedId, label: "Current owner" });
    }
    return options;
  }, [assignableUsers, defaultOwnerId, ownerUserId]);
  const lockedOwnerLabel =
    ownerOptions.find((o) => o.value === (ownerUserId || defaultOwnerId))
      ?.label ?? (ownerUserId || defaultOwnerId ? "You" : "Unassigned");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Company location is required.");
      return;
    }
    setPending(true);
    const body = {
      name: name.trim(),
      type: canChooseHq ? type : ("branch" as const),
      address: address.trim() || null,
      industry: industry.trim() || null,
      ownerUserId: canAssignOwner
        ? ownerUserId || null
        : defaultOwnerId || ownerUserId || null,
    };
    const result =
      mode === "create"
        ? await createLocation(companyId, body)
        : await updateLocation(companyId, location!.id, body);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate(`/company/${companyId}/locations/${result.id}`);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-8"
    >
      <h1 className={PAGE_H1_CLASS}>
        {mode === "create" ? "Add location" : "Edit location"}
      </h1>
      <div className="mt-6 rounded-xl border border-border-default bg-surface p-6">
        <div className="grid gap-4">
          <Input
            label="Company location"
            name="name"
            required
            placeholder="e.g. Mumbai"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          {canChooseHq ? (
            <Select
              label="Type"
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as "hq" | "branch")}
              options={[
                { value: "hq", label: "HQ" },
                { value: "branch", label: "Branch" },
              ]}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text-primary">Type</span>
              <p className="flex h-11 items-center rounded-lg border border-border-default bg-neutral-200 px-3 text-sm text-text-secondary">
                Branch
                <span className="ml-2 text-xs text-text-caption">
                  (HQ already exists)
                </span>
              </p>
            </div>
          )}

          <Input
            label="Location address"
            name="address"
            placeholder="e.g. Nariman Point, Mumbai"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />

          <Input
            label="Industry Type"
            name="industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          />

          {canAssignOwner && ownerOptions.length > 0 ? (
            <Select
              label="Owner"
              name="ownerUserId"
              value={ownerUserId}
              onChange={(e) => {
                setOwnerTouched(true);
                setOwnerUserId(e.target.value);
              }}
              options={ownerOptions}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text-primary">Owner</span>
              <p className="flex h-11 items-center rounded-lg border border-border-default bg-neutral-200 px-3 text-sm text-text-secondary">
                {lockedOwnerLabel}
              </p>
            </div>
          )}
        </div>
        {error ? <p className="mt-4 text-sm text-text-danger">{error}</p> : null}
        <div className="mt-6 flex gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(-1)}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
