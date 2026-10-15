import type {
  ActivityDraftFields,
  AgentToolProposal,
} from "@/services/coworker";

const ACTIVITY_DRAFT_KEYS = [
  "contactId",
  "type",
  "subject",
  "body",
  "dueAt",
  "skippedOptional",
] as const satisfies ReadonlyArray<keyof ActivityDraftFields>;

export function pickActivityDraftPatch(
  raw: Record<string, unknown> | null | undefined,
): Partial<ActivityDraftFields> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<ActivityDraftFields> = {};
  for (const key of ACTIVITY_DRAFT_KEYS) {
    const val = raw[key];
    if (typeof val === "string") out[key] = val;
  }
  return out;
}

/** Merge server patch + patch_activity_draft tool args from a draft turn. */
export function mergeActivityDraftPatchFromTurn(input: {
  patch?: Partial<ActivityDraftFields> | null;
  toolProposals?: AgentToolProposal[] | null;
}): Partial<ActivityDraftFields> | undefined {
  const fromResult = pickActivityDraftPatch(
    input.patch as Record<string, unknown> | undefined,
  );
  const patchTool = input.toolProposals?.find(
    (t) => t.name === "patch_activity_draft",
  );
  const fromTool = patchTool
    ? pickActivityDraftPatch(patchTool.args)
    : {};
  const merged = { ...fromTool, ...fromResult };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
