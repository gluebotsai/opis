import { useEffect, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import {
  PanelExpandButton,
  PanelRefreshButton,
  useCopilotWorkspacePanels,
} from "@/components/assistant/copilot-workspace";
import { Button } from "@/components/ui/button";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { StatusBanner } from "@/components/ui/status-banner";
import { QueueModuleTabs, type QueueModuleTab } from "@/components/workforce/queue-module-tabs";
import { organizationSettingsApi } from "@/features/workforce/organization-settings/api";
import type { OrganizationRoutingType } from "@/features/workforce/organization-settings/types";
import { isSessionError } from "@/store/slices/auth-slice";
import { contentPanelClassName, contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

const LONG_WAIT_TYPE_ID = 1;

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-5 py-5">
      <div>
        <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
        <p className="mt-1 text-sm text-neutral-600">{description}</p>
      </div>
      <div className="mt-4 w-full">{children}</div>
    </section>
  );
}

export function RoutingProfilePanel({
  onModuleTabChange,
}: {
  onModuleTabChange: (tab: QueueModuleTab) => void;
}) {
  const copilotMinimized = Boolean(useCopilotWorkspacePanels()?.copilotMinimized);
  const [types, setTypes] = useState<OrganizationRoutingType[]>([]);
  const [routingTypeId, setRoutingTypeId] = useState(3);
  const [longWaitSeconds, setLongWaitSeconds] = useState(300);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const { profile, types: nextTypes } = await organizationSettingsApi.getRoutingProfile();
      setTypes(nextTypes);
      setRoutingTypeId(profile.routingTypeId);
      setLongWaitSeconds(profile.longWaitSeconds ?? 300);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load routing profile";
      if (!isSessionError(message)) setError(message);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { profile, types: nextTypes } = await organizationSettingsApi.saveRoutingProfile({
        routingTypeId,
        longWaitSeconds: routingTypeId === LONG_WAIT_TYPE_ID ? longWaitSeconds : null,
      });
      setTypes(nextTypes);
      setRoutingTypeId(profile.routingTypeId);
      setLongWaitSeconds(profile.longWaitSeconds ?? 300);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save routing profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={contentPanelClassName}>
      {copilotMinimized ? null : (
        <div className={`shrink-0 px-4 py-3.5 ${contentPanelHeaderBorderClassName}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[18px] font-semibold text-neutral-900">Routing</h2>
              <p className="mt-0.5 text-sm text-neutral-600">
                Choose how conversations are assigned across this organization
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <PanelRefreshButton onClick={() => void load()} refreshing={loading} />
              <PanelExpandButton side="right" />
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 px-4 pt-3">
        <QueueModuleTabs value="routing" onChange={onModuleTabChange} />
      </div>

      <PanelScrollArea className="min-h-0 flex-1 px-4 py-4">
        {error ? (
          <StatusBanner tone="error" className="mb-4">
            {error}
          </StatusBanner>
        ) : null}
        {saved ? (
          <StatusBanner tone="success" className="mb-4">
            Routing profile saved for this organization.
          </StatusBanner>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-neutral-600">
            <LoaderCircle className="size-4 animate-spin" />
            Loading routing profile…
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <FormSection
              title="Routing type"
              description="This setting applies to the whole organization. Queue intent profiles and offer timeouts stay unchanged."
            >
              <div className="grid gap-3">
                {types.map((type) => {
                  const selected = type.id === routingTypeId;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setRoutingTypeId(type.id)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border-[0.6px] px-4 py-3 text-left transition",
                        selected
                          ? "border-neutral-900 bg-neutral-50"
                          : "border-[#bfbfbf] bg-white hover:bg-neutral-50",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold",
                          selected
                            ? "bg-neutral-900 text-white"
                            : "bg-neutral-100 text-neutral-800",
                        )}
                      >
                        {type.id}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-neutral-900">
                          {type.name}
                        </span>
                        <span className="mt-0.5 block text-sm text-neutral-600">
                          {type.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {routingTypeId === LONG_WAIT_TYPE_ID ? (
                <label className="mt-4 block">
                  <span className="text-sm font-medium text-neutral-900">Long wait threshold</span>
                  <span className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={86400}
                      value={longWaitSeconds}
                      onChange={(event) => setLongWaitSeconds(Number(event.target.value) || 1)}
                      className="h-[38px] w-32 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm text-neutral-800 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                    />
                    <span className="text-sm text-neutral-600">seconds</span>
                  </span>
                </label>
              ) : null}

              <div className="mt-5">
                <Button type="button" disabled={saving} onClick={() => void handleSave()}>
                  {saving ? "Saving…" : "Save routing"}
                </Button>
              </div>
            </FormSection>

            <FormSection
              title="Type reference"
              description="The organization stores the type number. These labels are the global lookup."
            >
              <div className="overflow-x-auto rounded-lg border-[0.6px] border-[#bfbfbf]">
                <table className="w-full text-left text-sm">
                  <thead className="border-b-[0.6px] border-[#bfbfbf] bg-neutral-50 text-xs text-neutral-600">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">ID</th>
                      <th className="px-3 py-2.5 font-medium">Type</th>
                      <th className="px-3 py-2.5 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {types.map((type) => (
                      <tr
                        key={type.id}
                        className="border-b-[0.6px] border-[#bfbfbf] last:border-0"
                      >
                        <td className="px-3 py-2.5 font-medium tabular-nums text-neutral-900">
                          {type.id}
                        </td>
                        <td className="px-3 py-2.5 text-neutral-900">{type.name}</td>
                        <td className="px-3 py-2.5 text-neutral-600">{type.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FormSection>
          </div>
        )}
      </PanelScrollArea>
    </div>
  );
}
