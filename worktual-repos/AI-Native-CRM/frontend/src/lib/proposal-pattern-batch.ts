import type { ProposalCorpusBatchSummary } from "@/services/configuration";

export function batchFiles(batch: ProposalCorpusBatchSummary) {
  return Array.isArray(batch.files) ? batch.files : [];
}

export function batchTitle(batch: ProposalCorpusBatchSummary) {
  if (batch.name?.trim()) return batch.name.trim();
  const files = batchFiles(batch);
  const proposal = files.find((f) => f.kind === "proposal")?.filename?.trim();
  if (proposal) return proposal;
  const requirement = files.find((f) => f.kind === "requirement")?.filename?.trim();
  if (requirement) return requirement;
  const when = batch.createdAt ? new Date(batch.createdAt) : null;
  if (when && !Number.isNaN(when.getTime())) {
    return `Upload ${when.toLocaleDateString()}`;
  }
  return "Upload";
}

export function batchFileLine(batch: ProposalCorpusBatchSummary) {
  const files = batchFiles(batch);
  if (!files.length) {
    return batch.itemCount ? `${batch.itemCount} files` : "";
  }
  const req = files
    .filter((f) => f.kind === "requirement")
    .map((f) => f.filename)
    .filter(Boolean);
  const prop = files
    .filter((f) => f.kind === "proposal")
    .map((f) => f.filename)
    .filter(Boolean);
  const bits: string[] = [];
  if (req.length) bits.push(`Requirement: ${req.join(", ")}`);
  if (prop.length) bits.push(`Proposal: ${prop.join(", ")}`);
  if (!bits.length) {
    return files.map((f) => f.filename).filter(Boolean).join(" · ");
  }
  return bits.join(" · ");
}
