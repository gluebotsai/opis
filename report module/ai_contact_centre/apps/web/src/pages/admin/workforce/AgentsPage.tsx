import { useEffect, useState } from "react";
import { apiV1 } from "@/config/api-paths";
import { LoaderCircle, Save } from "lucide-react";

import { StatusBanner } from "@/components/ui/status-banner";
import { ccCoreHttp } from "@/services/http";
import { Button } from "@/components/ui/button";

type WorkforceAgent = {
  id: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  teamName: string | null;
  skills: string[];
  status: "active" | "inactive";
  queueName: string | null;
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<WorkforceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [skillsInput, setSkillsInput] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await ccCoreHttp.get<{ agents: WorkforceAgent[] }>(
        apiV1("/setup/workforce/agents"),
      );
      setAgents(data.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveSkills(agentId: string) {
    setSaving(true);
    try {
      const skills = skillsInput
        .split(",")
        .map((skill) => skill.trim())
        .filter(Boolean);
      await ccCoreHttp.patch(`${apiV1(`/setup/workforce/agents/${agentId}/skills`)}`, { skills });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save skills");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Agents</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Manage agent skills used for queue assignment and routing.
        </p>
      </div>

      {error ? (
        <StatusBanner tone="error">{error}</StatusBanner>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-neutral-600">
          <LoaderCircle className="size-4 animate-spin" />
          Loading agents…
        </div>
      ) : (
        <div className="overflow-x-auto bg-white xl:overflow-hidden xl:rounded-2xl xl:border-[0.6px] xl:border-[#bfbfbf]">
          <table className="w-full text-left text-sm">
            <thead className="border-b-[0.6px] border-[#bfbfbf] bg-neutral-50 text-xs text-neutral-600">
              <tr>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Team</th>
                <th className="px-4 py-3 font-medium">Queue</th>
                <th className="px-4 py-3 font-medium">Skills</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-b-[0.6px] border-[#bfbfbf] last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-900">
                      {agent.firstName} {agent.lastName}
                    </p>
                    <p className="text-xs text-neutral-600">{agent.workEmail}</p>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{agent.teamName ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-600">{agent.queueName ?? "—"}</td>
                  <td className="px-4 py-3">
                    {editingId === agent.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={skillsInput}
                          onChange={(e) => setSkillsInput(e.target.value)}
                          className="h-8 min-w-[12rem] rounded-lg border-[0.6px] border-[#bfbfbf] px-2 text-xs"
                          placeholder="billing, refunds"
                        />
                        <Button
                          variant="primaryIcon"
                          disabled={saving}
                          onClick={() => void saveSkills(agent.id)}
                        >
                          <Save className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(agent.id);
                          setSkillsInput(agent.skills.join(", "));
                        }}
                        className="text-left text-neutral-700 hover:text-neutral-900"
                      >
                        {agent.skills.length > 0 ? agent.skills.join(", ") : "Add skills"}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 capitalize text-neutral-600">{agent.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
