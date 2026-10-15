/**
 * TypeScript outline validators for V2. LLM may propose leaves once;
 * code records overrides. Frozen mode is always the playbook skeleton.
 */

import {
  canonicalizeSectionKey,
  MAX_PROPOSAL_OUTLINE_LEAVES,
} from "@/lib/proposal-content-playbook";
import {
  isDynamicOutlineEnabled,
  maxCustomSections,
  maxLeavesPerProposal,
  proposalOutlineMode,
  type ProposalOutlineMode,
} from "@/lib/proposal-pipeline-v2";

export type OutlineLeaf = {
  key: string;
  title: string;
  purpose?: string;
  kind?: string;
};

export type OutlineOverride = {
  action: "drop" | "cap" | "rename" | "keep_playbook";
  key: string;
  reason: string;
};

export function frozenOutlineFromSkeleton(skeleton: OutlineLeaf[]): {
  schemaVersion: 1;
  mode: "frozen";
  sections: OutlineLeaf[];
  overrides: OutlineOverride[];
} {
  return {
    schemaVersion: 1,
    mode: "frozen",
    sections: skeleton.slice(0, maxLeavesPerProposal()),
    overrides: [],
  };
}

export function validateProposalOutline(input: {
  organizationId: string;
  playbookLeaves: OutlineLeaf[];
  proposed?: OutlineLeaf[] | null;
  mode?: ProposalOutlineMode;
}): {
  schemaVersion: 1;
  mode: ProposalOutlineMode;
  sections: OutlineLeaf[];
  overrides: OutlineOverride[];
} {
  const mode = input.mode || proposalOutlineMode();
  const playbook = input.playbookLeaves.filter((leaf) =>
    String(leaf.key || "").trim(),
  );
  if (mode === "frozen" || !input.proposed?.length) {
    return {
      schemaVersion: 1,
      mode: "frozen",
      sections: playbook.slice(0, maxLeavesPerProposal()),
      overrides: input.proposed?.length
        ? [
            {
              action: "keep_playbook",
              key: "*",
              reason: "frozen outline uses playbook sectionsJson only",
            },
          ]
        : [],
    };
  }

  const allowedCustom =
    mode === "dynamic" && isDynamicOutlineEnabled(input.organizationId)
      ? maxCustomSections()
      : Math.min(2, maxCustomSections());
  const playbookKeys = new Set(
    playbook.map((leaf) => canonicalizeSectionKey(leaf.key)),
  );
  const overrides: OutlineOverride[] = [];
  const out: OutlineLeaf[] = [];
  let custom = 0;
  const cap = Math.min(maxLeavesPerProposal(), MAX_PROPOSAL_OUTLINE_LEAVES);

  for (const raw of input.proposed) {
    const key = canonicalizeSectionKey(raw.key);
    if (!key) continue;
    if (out.length >= cap) {
      overrides.push({
        action: "cap",
        key,
        reason: `maxLeavesPerProposal=${cap}`,
      });
      continue;
    }
    if (playbookKeys.has(key)) {
      const canonical = playbook.find(
        (leaf) => canonicalizeSectionKey(leaf.key) === key,
      );
      out.push({
        key: canonical?.key || raw.key,
        title: canonical?.title || raw.title,
        purpose: raw.purpose || canonical?.purpose,
        kind: raw.kind || canonical?.kind || "prose",
      });
      continue;
    }
    if (mode === "conservative" || custom >= allowedCustom) {
      overrides.push({
        action: "drop",
        key,
        reason:
          mode === "conservative"
            ? "conservative outline does not expand BRD TOC"
            : "maxCustomSections",
      });
      continue;
    }
    custom += 1;
    out.push({
      key: raw.key,
      title: raw.title || raw.key,
      purpose: raw.purpose,
      kind: raw.kind || "prose",
    });
  }

  if (!out.length) {
    return {
      schemaVersion: 1,
      mode,
      sections: playbook.slice(0, cap),
      overrides: [
        ...overrides,
        {
          action: "keep_playbook",
          key: "*",
          reason: "empty proposed outline",
        },
      ],
    };
  }

  return { schemaVersion: 1, mode, sections: out, overrides };
}
