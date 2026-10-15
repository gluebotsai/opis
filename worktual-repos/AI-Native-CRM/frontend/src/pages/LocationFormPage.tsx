import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LocationForm } from "@/components/companies/LocationForm";
import { fetchLocationFormOptions } from "@/services/companies";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { COWORKER_WORKSPACE_SCROLL } from "@/components/coworker/coworker-layout";
import { BackLink } from "@/components/ui/BackLink";

export function LocationFormPage() {
  const { id, locationId } = useParams<{ id: string; locationId?: string }>();
  const isEdit = Boolean(locationId);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Extract<
    Awaited<ReturnType<typeof fetchLocationFormOptions>>,
    { ok: true }
  > | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      if (isEdit) setLoading(true);
      setError(null);
      try {
        const result = await fetchLocationFormOptions(id, locationId);
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          if (isEdit) setData(null);
          return;
        }
        setData(result);
      } catch {
        if (!cancelled) setError("Failed to load form.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, locationId, isEdit]);

  if (!id) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-text-danger">Company not found.</p>
        <BackLink to="/company" className="mt-3">
          Back to companies
        </BackLink>
      </div>
    );
  }

  // Create: show the form immediately — options fill in when ready.
  if (!isEdit) {
    return (
      <div className="crm-fade-in">
        {error ? (
          <p className="mx-auto max-w-xl px-4 pt-4 text-sm text-text-danger sm:px-6">
            {error}
          </p>
        ) : null}
        <LocationForm
          mode="create"
          companyId={id}
          hasHq={data?.hasHq ?? false}
          canAssignOwner={data?.canAssignOwner ?? false}
          currentUserId={data?.currentUserId ?? null}
          assignableUsers={data?.assignableUsers ?? []}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-6 py-10 text-sm text-text-caption">Loading…</div>
    );
  }

  if (!data) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
        <BackLink to="/company" className="mt-3">
          Back to companies
        </BackLink>
      </div>
    );
  }

  if (!data.location) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-text-danger">Location not found.</p>
        <BackLink to={`/company/${id}`} className="mt-3">
          Back to company
        </BackLink>
      </div>
    );
  }

  const workspace = (
    <div className={`crm-fade-in ${COWORKER_WORKSPACE_SCROLL}`}>
      <LocationForm
        mode="edit"
        companyId={id}
        hasHq={data.hasHq}
        canAssignOwner={data.canAssignOwner}
        currentUserId={data.currentUserId}
        assignableUsers={data.assignableUsers}
        location={data.location}
      />
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="company"
      title={`Edit ${data.location.name}`}
      welcome={`I'm your **location agent** for **${data.location.name}**. Ask me about this location while you edit the form on the right.`}
      chips={[
        {
          id: "chip-help",
          label: "What can you help with?",
          prompt: "What can you help me do while editing this location?",
        },
      ]}
      surface="detail"
      entityId={locationId ?? null}
      workspace={workspace}
    />
  );
}
