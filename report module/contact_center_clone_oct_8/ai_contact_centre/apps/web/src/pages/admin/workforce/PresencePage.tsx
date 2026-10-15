import { useEffect, useState } from "react";
import { apiV1 } from "@/config/api-paths";
import { LoaderCircle } from "lucide-react";

import { StatusBanner } from "@/components/ui/status-banner";
import { ccCoreHttp } from "@/services/http";

type PresenceAgent = {
  id: string;
  name: string;
  email: string;
  queueName: string | null;
  presence: "offline" | "available" | "busy";
};

export default function PresencePage() {
  const [agents, setAgents] = useState<PresenceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data } = await ccCoreHttp.get<{ agents: PresenceAgent[] }>(
          apiV1("/setup/workforce/presence"),
        );
        setAgents(data.agents);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load presence");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Presence</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Live agent availability will connect to runtime presence once the agent workspace is live.
        </p>
      </div>

      {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-neutral-600">
          <LoaderCircle className="size-4 animate-spin" />
          Loading presence…
        </div>
      ) : (
        <div className="overflow-x-auto bg-white xl:overflow-hidden xl:rounded-2xl xl:border-[0.6px] xl:border-[#bfbfbf]">
          <table className="w-full text-left text-sm">
            <thead className="border-b-[0.6px] border-[#bfbfbf] bg-neutral-50 text-xs text-neutral-600">
              <tr>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Queue</th>
                <th className="px-4 py-3 font-medium">Presence</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-b-[0.6px] border-[#bfbfbf] last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-900">{agent.name}</p>
                    <p className="text-xs text-neutral-600">{agent.email}</p>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{agent.queueName ?? "—"}</td>
                  <td className="px-4 py-3 capitalize text-neutral-600">{agent.presence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
