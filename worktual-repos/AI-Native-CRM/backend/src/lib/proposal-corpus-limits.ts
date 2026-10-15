/** Max learned corpus documents (requirement + proposal files) per organization. */
export function proposalCorpusMaxDocsPerOrg(): number {
  const raw = Number(process.env.PROPOSAL_CORPUS_MAX_DOCS_PER_ORG ?? 50);
  if (!Number.isFinite(raw) || raw < 1) return 50;
  return Math.floor(raw);
}

export function corpusUploadExceedsOrgCap(input: {
  existingCount: number;
  incomingCount: number;
  cap?: number;
}): boolean {
  const cap = input.cap ?? proposalCorpusMaxDocsPerOrg();
  return input.existingCount + input.incomingCount > cap;
}
