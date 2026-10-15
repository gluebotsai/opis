import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  BranchDetail,
  BranchDetailSkeleton,
} from "@/components/companies/BranchDetail";
import { fetchLocation } from "@/services/companies";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { BackLink } from "@/components/ui/BackLink";

export function LocationDetailPage() {
  const { id, locationId } = useParams<{ id: string; locationId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Extract<
    Awaited<ReturnType<typeof fetchLocation>>,
    { ok: true }
  > | null>(null);

  useEffect(() => {
    if (!id || !locationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchLocation(id, locationId);
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setData(result);
      } catch {
        if (!cancelled) setError("Failed to load location.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, locationId]);

  if (loading) {
    return (
      <AgentModuleShell
        moduleId="company"
        title="Location"
        welcome="I'm your **location agent**. Ask about contacts at this location while it loads on the right."
        surface="detail"
        entityId={locationId ?? null}
        workspace={<BranchDetailSkeleton companyId={id ?? ""} />}
      />
    );
  }

  if (!data) {
    return (
      <AgentModuleShell
        moduleId="company"
        title="Location"
        welcome="I'm your **location agent**. Ask about contacts while you use the workspace on the right."
        surface="detail"
        entityId={locationId ?? null}
        workspace={
          <div className="px-6 py-10">
            <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
            <BackLink to="/company" className="mt-3">
              Back to companies
            </BackLink>
          </div>
        }
      />
    );
  }

  const workspace = (
    <BranchDetail
      companyId={data.companyId}
      companyName={data.companyName}
      location={data.location}
      contacts={data.contacts}
    />
  );

  return (
    <AgentModuleShell
      moduleId="company"
      title={data.location.name}
      welcome={`I'm your **location agent** for **${data.location.name}**. Ask me to add a contact at this location — the location record stays fully usable on the right.`}
      chips={[
        {
          id: "chip-new-contact",
          label: "Add a contact",
          prompt: `Help me add a new contact for ${data.location.name}`,
        },
      ]}
      surface="detail"
      entityId={locationId ?? null}
      workspace={workspace}
    />
  );
}
