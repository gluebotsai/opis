/**
 * Org-isolated V2 proposal generate flags. Default off; kill switch wins.
 * Does not change the role × module matrix.
 */

import { createHash } from "node:crypto";

export const PROPOSAL_PIPELINE_VERSION = 2;

export function isProposalPipelineV2Killed(): boolean {
  const kill = String(process.env.PROPOSAL_PIPELINE_V2_KILL || "")
    .trim()
    .toLowerCase();
  if (kill === "1" || kill === "true" || kill === "on" || kill === "kill") {
    return true;
  }
  const raw = String(process.env.PROPOSAL_PIPELINE_V2 || "")
    .trim()
    .toLowerCase();
  return raw === "off" || raw === "0" || raw === "false";
}

export function isProposalPipelineV2Enabled(organizationId: string): boolean {
  if (isProposalPipelineV2Killed()) return false;
  const orgs = String(process.env.PROPOSAL_PIPELINE_V2_ORGS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (orgs.includes("*")) return true;
  if (orgs.includes(String(organizationId))) return true;
  const global = String(process.env.PROPOSAL_PIPELINE_V2 || "")
    .trim()
    .toLowerCase();
  return global === "1" || global === "true" || global === "on";
}

export type ProposalOutlineMode = "frozen" | "conservative" | "dynamic";

export function proposalOutlineMode(): ProposalOutlineMode {
  const raw = String(process.env.PROPOSAL_OUTLINE_MODE || "frozen")
    .trim()
    .toLowerCase();
  if (raw === "conservative" || raw === "dynamic") return raw;
  return "frozen";
}

export function maxLeavesPerProposal(): number {
  const n = Number(process.env.PROPOSAL_MAX_LEAVES || 16);
  return Number.isFinite(n) && n >= 4 ? Math.min(32, Math.round(n)) : 16;
}

export function maxCustomSections(): number {
  const n = Number(process.env.PROPOSAL_MAX_CUSTOM_SECTIONS || 2);
  return Number.isFinite(n) && n >= 0 ? Math.min(4, Math.round(n)) : 2;
}

export function proposalRunStaleMs(): number {
  const n = Number(process.env.PROPOSAL_RUN_STALE_MS || 20 * 60 * 1000);
  return Number.isFinite(n) && n >= 60_000 ? n : 20 * 60 * 1000;
}

export function proposalLeafConcurrency(): number {
  const n = Number(process.env.PROPOSAL_LEAF_CONCURRENCY || 1);
  return Number.isFinite(n) && n >= 1 ? Math.min(4, Math.round(n)) : 1;
}

export function isDynamicOutlineEnabled(organizationId: string): boolean {
  if (proposalOutlineMode() !== "dynamic") return false;
  const orgs = String(process.env.PROPOSAL_DYNAMIC_OUTLINE_ORGS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (orgs.includes("*")) return true;
  return orgs.includes(String(organizationId));
}

export function hashProposalGenerateInput(parts: {
  dealId?: string | null;
  requirementText: string;
  playbookId?: string | null;
  promptVersion?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        dealId: parts.dealId || "",
        requirementText: String(parts.requirementText || "").trim(),
        playbookId: parts.playbookId || "",
        promptVersion: parts.promptVersion || "v2",
      }),
    )
    .digest("hex")
    .slice(0, 40);
}
