/**
 * run: npx tsx src/lib/proposal-outline.test.ts
 */
import { frozenOutlineFromSkeleton, validateProposalOutline } from "./proposal-outline";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const playbook = [
  { key: "overview", title: "Overview" },
  { key: "commercials", title: "Commercials" },
];

const frozen = frozenOutlineFromSkeleton(playbook);
assert(frozen.mode === "frozen", "frozen mode");
assert(frozen.sections.length === 2, "playbook slots");

const conservative = validateProposalOutline({
  organizationId: "1",
  playbookLeaves: playbook,
  proposed: [
    ...playbook,
    { key: "architecture", title: "Architecture" },
    { key: "rollout", title: "Rollout" },
    { key: "sla", title: "SLA" },
  ],
  mode: "conservative",
});
assert(
  conservative.sections.every((s) => s.key === "overview" || s.key === "commercials"),
  "no BRD TOC explosion",
);
assert(conservative.overrides.some((o) => o.action === "drop"), "drops recorded");

console.log("proposal-outline tests ok");
