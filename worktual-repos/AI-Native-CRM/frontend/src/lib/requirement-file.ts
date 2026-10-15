/** Customer BRD / requirement uploads for proposal create. */

export const REQUIREMENT_FILE_EXTS = [".pdf", ".docx", ".txt", ".md"] as const;

export const REQUIREMENT_FILE_ACCEPT = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
].join(",");

export const REQUIREMENT_FILE_MAX_BYTES = 12 * 1024 * 1024;

export const REQUIREMENT_FILE_TYPES_LABEL = "PDF, Word, or text";

export function isRequirementUploadFile(file: { name: string }): boolean {
  const name = file.name.toLowerCase();
  return REQUIREMENT_FILE_EXTS.some((ext) => name.endsWith(ext));
}
