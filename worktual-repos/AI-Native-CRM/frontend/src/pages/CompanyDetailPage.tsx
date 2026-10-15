import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LocationGrid } from "@/components/companies/LocationGrid";
import { CompanyContractsPanel } from "@/components/companies/CompanyContractsPanel";
import { CompanyBuyingGroupPanel } from "@/components/companies/CompanyBuyingGroupPanel";
import { CompanyDealsPanel } from "@/components/companies/CompanyDealsPanel";
import {
  emptyLocationDraft,
  LocationCreateDraftPanel,
} from "@/components/companies/LocationCreateDraftPanel";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  hydrateDraftFromMemory,
  readDraftSessionMemory,
} from "@/lib/coworker/use-draft-session-memory";
import { fetchCompanyLocations, fetchCompany, updateCompany, deleteCompany } from "@/services/companies";
import type {
  AgentToolProposal,
  LocationDraftFields,
} from "@/services/coworker";
import { BackLink } from "@/components/ui/BackLink";

export type CompanyDetailLocationState = {
  companyName?: string;
  locationCount?: number;
};

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const seed = (routerLocation.state ?? null) as CompanyDetailLocationState | null;

  const workspaceMode =
    searchParams.get("view") === "create" ? "create" : "detail";

  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Extract<
    Awaited<ReturnType<typeof fetchCompanyLocations>>,
    { ok: true }
  > | null>(null);
  const [createDraft, setCreateDraft] = useState<LocationDraftFields>(() =>
    hydrateDraftFromMemory(
      emptyLocationDraft(),
      readDraftSessionMemory("shell:company"),
      "locationDraft",
    ),
  );
  const draftPatchRef = useRef<
    ((patch: Partial<LocationDraftFields>) => void) | null
  >(null);

  const setWorkspace = useCallback(
    (mode: "detail" | "create", opts?: { form?: boolean }) => {
      const next = new URLSearchParams(searchParams);
      if (mode === "create") {
        next.set("view", "create");
        if (opts?.form) next.set("form", "1");
        else next.delete("form");
      } else {
        next.delete("view");
        next.delete("form");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const createPanelMode =
    searchParams.get("form") === "1" ? "form" : "guided";

  const onDraftPatch = useCallback((patch: Partial<LocationDraftFields>) => {
    if (draftPatchRef.current) {
      draftPatchRef.current(patch);
      return;
    }
    setCreateDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const hasHq = Boolean(data?.locations.some((loc) => loc.type === "hq"));

  const onWorkspaceCommand = useCallback(
    (tool: AgentToolProposal) => {
      if (tool.name !== "set_workspace") return false;
      const mode = String(tool.args.mode || "");
      if (mode === "create") {
        setCreateDraft(emptyLocationDraft(hasHq));
        setWorkspace("create");
        return true;
      }
      if (mode === "list" || mode === "detail") {
        setWorkspace("detail");
        return true;
      }
      return false;
    },
    [hasHq, setWorkspace],
  );

  const reload = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const result = await fetchCompanyLocations(id);
      if (!result.ok) {
        setError(result.error);
        setData(null);
      } else {
        setData(result);
      }
    } catch {
      setError("Failed to load company.");
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    setError(null);
    void reload();
  }, [reload]);

  if (!id) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-text-danger">Not found</p>
        <BackLink to="/company" className="mt-3">
          Back to companies
        </BackLink>
      </div>
    );
  }

  if (error && !data && !seed?.companyName) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-text-danger">{error}</p>
        <BackLink to="/company" className="mt-3">
          Back to companies
        </BackLink>
      </div>
    );
  }

  const ready = Boolean(data);
  const companyName = data?.companyName ?? seed?.companyName ?? "Company";

  const openLocationCreate = () => {
    setCreateDraft(emptyLocationDraft(hasHq));
    setWorkspace("create", { form: true });
  };

  const listWorkspace = (
    <div className="crm-fade-in">
      {error && !data ? (
        <p className="mx-auto max-w-6xl px-4 pt-4 text-sm text-text-danger sm:px-6">
          {error}
        </p>
      ) : null}
      <LocationGrid
        companyId={data?.companyId ?? id}
        companyName={companyName}
        locations={data?.locations ?? []}
        contacts={data?.contacts ?? []}
        contactTotal={data?.contactTotal ?? 0}
        locationCount={
          data ? data.locations.length : seed?.locationCount
        }
        ready={ready}
        onAddLocation={openLocationCreate}
        expansionSignal={data?.expansionSignal ?? null}
        expansionReason={data?.expansionReason ?? null}
        expansionDraft={data?.expansionDraft ?? null}
        expansionLastRunAt={data?.expansionLastRunAt ?? null}
      />
      {id ? (
        <>
          <section className="mx-auto mt-8 max-w-6xl px-4 sm:px-6">
            <CompanyDealsPanel companyId={id} />
          </section>
          <section className="mx-auto mt-8 max-w-6xl px-4 sm:px-6">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">Contracts</h2>
            <CompanyContractsPanel companyId={id} />
          </section>
          <section className="mx-auto mt-8 max-w-6xl px-4 sm:px-6">
            <CompanyBuyingGroupPanel companyId={id} />
          </section>
        </>
      ) : null}
    </div>
  );

  const shellWorkspace =
    workspaceMode === "create" ? (
      <LocationCreateDraftPanel
        companyId={id}
        draft={createDraft}
        onDraftChange={setCreateDraft}
        hasHq={hasHq}
        patchRef={draftPatchRef}
        mode={createPanelMode}
        onCancel={() => setWorkspace("detail")}
        onCreated={(locationId) => {
          setCreateDraft(emptyLocationDraft(hasHq));
          setWorkspace("detail");
          void reload().then(() => {
            navigate(
              `/company/${id}?highlight=${encodeURIComponent(locationId)}`,
              { replace: true },
            );
          });
        }}
      />
    ) : (
      listWorkspace
    );

  return (
    <AgentModuleShell
      key={`${id}-${workspaceMode}`}
      moduleId="company"
      title={
        workspaceMode === "create"
          ? `New location · ${companyName}`
          : companyName
      }
      welcome={
        workspaceMode === "create"
          ? `I'm with you on **${companyName}**. Tell me the location name, type, or address — or fill the draft on the right.`
          : `I'm your **company agent** for **${companyName}**. Ask me to add a location or a new contact — the company record stays fully usable on the right.`
      }
      chips={
        workspaceMode === "create"
          ? [
              {
                id: "chip-branch",
                label: "Add a branch",
                prompt: "Add a branch location",
              },
              {
                id: "chip-address",
                label: "Set an address",
                prompt: "Set the address to ",
              },
            ]
          : [
              {
                id: "chip-new-location",
                label: "Add a location",
                prompt: `Help me add a new location to ${companyName}`,
              },
              {
                id: "chip-new-contact",
                label: "Add a contact",
                prompt: `Help me add a new contact for ${companyName}`,
              },
            ]
      }
      surface={workspaceMode}
      workspaceMode={workspaceMode}
      entityId={id}
      draft={workspaceMode === "create" ? createDraft : null}
      workspace={shellWorkspace}
      onWorkspaceCommand={onWorkspaceCommand}
      onDraftPatch={(patch) =>
        onDraftPatch(patch as Partial<LocationDraftFields>)
      }
      onToolConfirm={async (tool) => {
        if (tool.name === "propose_update_company") {
          const companyId = String(tool.args.companyId || id || "");
          if (!companyId) return false;
          const detail = await fetchCompany(companyId);
          if (!detail.ok) return false;
          const company = detail.company;
          const patchKeys = [
            "name",
            "domain",
            "industry",
            "linkedinUrl",
            "ownerUserId",
            "channelRole",
            "parentCompanyId",
          ] as const;
          const patch: Record<string, string> = {};
          for (const key of patchKeys) {
            const val = tool.args[key];
            if (typeof val === "string" && val.trim()) {
              patch[key] = val.trim();
            }
          }
          let employeeCount = company.employeeCount;
          if (
            typeof tool.args.employeeCount === "string" &&
            tool.args.employeeCount.trim()
          ) {
            const n = Number(tool.args.employeeCount);
            if (Number.isFinite(n)) employeeCount = n;
          }
          if (
            Object.keys(patch).length === 0 &&
            employeeCount === company.employeeCount
          ) {
            return false;
          }
          const result = await updateCompany(companyId, {
            name: patch.name ?? company.name,
            domain:
              patch.domain !== undefined ? patch.domain : company.domain,
            industry:
              patch.industry !== undefined ? patch.industry : company.industry,
            employeeCount,
            linkedinUrl:
              patch.linkedinUrl !== undefined
                ? patch.linkedinUrl
                : company.linkedinUrl,
            ownerUserId:
              patch.ownerUserId !== undefined
                ? patch.ownerUserId
                : company.ownerUserId,
            channelRole:
              patch.channelRole !== undefined
                ? patch.channelRole
                : company.channelRole,
            parentCompanyId:
              patch.parentCompanyId !== undefined
                ? patch.parentCompanyId
                : company.parentCompanyId,
          });
          if (!result.ok) return false;
          void reload();
          return true;
        }
        if (tool.name === "propose_delete_company") {
          const companyId = String(tool.args.companyId || id || "");
          if (!companyId) return false;
          const result = await deleteCompany(companyId);
          if (!result.ok) return false;
          navigate("/company");
          return true;
        }
        return false;
      }}
      onAfterTool={() => {
        if (workspaceMode !== "create") void reload();
      }}
    />
  );
}
