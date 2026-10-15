import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  createCompany,
  fetchCompany,
  fetchCompanyFormOptions,
  updateCompany,
} from "@/services/companies";
import { CompanyFormFieldsSkeleton } from "./CompanyFormPageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { COWORKER_WORKSPACE_SCROLL } from "@/components/coworker/coworker-layout";

export function CompanyFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  // Edit: skeleton fields until company data arrives. Create: form immediately.
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationType, setLocationType] = useState<"hq" | "branch">("hq");
  const [channelRole, setChannelRole] = useState("standard");
  const [parentCompanyId, setParentCompanyId] = useState("");
  const [assignableUsers, setAssignableUsers] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [canAssignOwner, setCanAssignOwner] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isEdit) setLoading(true);
      setError(null);
      try {
        if (id) {
          const result = await fetchCompany(id);
          if (cancelled) return;
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setName(result.company.name);
          setDomain(result.company.domain ?? "");
          setIndustry(result.company.industry ?? "");
          setEmployeeCount(
            result.company.employeeCount != null
              ? String(result.company.employeeCount)
              : "",
          );
          setLinkedinUrl(result.company.linkedinUrl ?? "");
          setOwnerUserId(result.company.ownerUserId ?? "");
          setChannelRole(result.company.channelRole ?? "standard");
          setParentCompanyId(result.company.parentCompanyId ?? "");
          setCanAssignOwner(result.canAssignOwner);
          setAssignableUsers(result.assignableUsers);
        } else {
          const result = await fetchCompanyFormOptions();
          if (cancelled) return;
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setCanAssignOwner(result.canAssignOwner);
          setAssignableUsers(result.assignableUsers);
          setCurrentUserId(result.currentUserId);
          setOwnerUserId(result.currentUserId ?? "");
        }
      } catch {
        if (!cancelled) setError("Failed to load company.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  const ownerOptions = useMemo(() => {
    const options = assignableUsers.map((u) => ({
      value: u.id,
      label: u.label,
    }));
    if (ownerUserId && !options.some((o) => o.value === ownerUserId)) {
      options.unshift({ value: ownerUserId, label: "Current owner" });
    }
    return options;
  }, [assignableUsers, ownerUserId]);

  const lockedOwnerLabel =
    ownerOptions.find((o) => o.value === ownerUserId)?.label ??
    (ownerUserId
      ? ownerUserId === currentUserId
        ? "You"
        : "Current owner"
      : "Unassigned");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const parsedEmployeeCount = employeeCount.trim()
      ? Number(employeeCount)
      : null;
    const result =
      isEdit && id
        ? await updateCompany(id, {
            name,
            domain: domain || null,
            industry: industry || null,
            employeeCount: parsedEmployeeCount,
            linkedinUrl: linkedinUrl || null,
            ownerUserId: ownerUserId || null,
            channelRole,
            parentCompanyId: parentCompanyId || null,
          })
        : await createCompany({
            name,
            domain: domain || null,
            industry: industry || null,
            employeeCount: parsedEmployeeCount,
            linkedinUrl: linkedinUrl || null,
            ownerUserId: ownerUserId || null,
            channelRole,
            parentCompanyId: parentCompanyId || null,
            locationName,
            locationAddress: locationAddress || null,
            locationType,
          });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate(`/company/${result.id}`);
  };

  const formContent = (
    <form
      onSubmit={onSubmit}
      className={`crm-fade-in w-full px-5 py-6 sm:px-8 sm:py-8 ${COWORKER_WORKSPACE_SCROLL}`}
    >
      <h1 className="text-xl font-semibold tracking-tight text-text-primary">
        {isEdit ? "Edit company" : "Add company"}
      </h1>
      <p className="mt-1 text-sm text-text-caption">
        {isEdit
          ? "Update the account name, owner, and how it sits in your organization."
          : "Name the account and its first location. Other details can wait."}
      </p>

      <div className="mt-6 w-full rounded-xl border border-border-default bg-white p-5 sm:p-6">
        {isEdit && loading ? (
          <CompanyFormFieldsSkeleton />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  label="Company name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              {!isEdit ? (
                <Select
                  label="Type"
                  value={locationType}
                  onChange={(e) =>
                    setLocationType(e.target.value as "hq" | "branch")
                  }
                  options={[
                    { value: "hq", label: "HQ" },
                    { value: "branch", label: "Branch" },
                  ]}
                />
              ) : null}

              <Select
                label="Channel role"
                value={channelRole}
                onChange={(e) => setChannelRole(e.target.value)}
                options={[
                  { value: "standard", label: "Standard account" },
                  { value: "franchise", label: "Franchise" },
                  { value: "owned_store", label: "Owned store" },
                  { value: "brand_hq", label: "Brand HQ" },
                ]}
              />

              <Input
                label="Company domain name"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="acme.com"
              />

              {!isEdit ? (
                <>
                  <Input
                    label="Company location"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    required
                    placeholder="Mumbai"
                  />
                  <div className="sm:col-span-2">
                    <Input
                      label="Location address"
                      value={locationAddress}
                      onChange={(e) => setLocationAddress(e.target.value)}
                      placeholder="Street, city"
                    />
                  </div>
                </>
              ) : null}

              <Input
                label="Industry Type"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Software"
              />

              <Input
                label="Company size"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder="250"
                value={employeeCount}
                onChange={(e) => setEmployeeCount(e.target.value)}
              />

              <Input
                label="LinkedIn URL"
                placeholder="linkedin.com/company/acme"
                value={linkedinUrl}
                onChange={(e) => setLinkedinUrl(e.target.value)}
              />

              {canAssignOwner && ownerOptions.length > 0 ? (
                <Select
                  label="Owner"
                  value={ownerUserId}
                  onChange={(e) => setOwnerUserId(e.target.value)}
                  options={ownerOptions}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    Owner
                  </span>
                  <p className="flex h-[38px] items-center rounded-lg border border-border-default bg-neutral-200 px-3 text-sm text-text-secondary">
                    {lockedOwnerLabel}
                  </p>
                </div>
              )}

              <div className="sm:col-span-2">
                <Input
                  label="Parent company"
                  value={parentCompanyId}
                  onChange={(e) => setParentCompanyId(e.target.value)}
                  placeholder="Optional company id"
                />
                <p className="mt-1.5 text-xs text-text-caption">
                  Only for a franchise or store under another company in this organization.
                </p>
              </div>
            </div>

            {error ? (
              <p className="mt-4 text-sm text-text-danger">{error}</p>
            ) : null}

            <div className="mt-6 flex gap-3">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(-1)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </form>
  );

  if (!isEdit) return formContent;

  return (
    <AgentModuleShell
      moduleId="company"
      title={`Edit ${name || "company"}`}
      welcome={`I'm your **company agent** for **${name || "this company"}**. Ask me about the account while you edit the form on the right.`}
      chips={[
        {
          id: "chip-add-location",
          label: "Add a location",
          prompt: "Help me add a location to this company",
        },
      ]}
      surface="detail"
      entityId={id ?? null}
      workspace={formContent}
    />
  );
}
