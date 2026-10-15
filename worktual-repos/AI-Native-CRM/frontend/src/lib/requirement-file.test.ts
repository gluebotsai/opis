/**
 * Lightweight unit checks (run: npx tsx src/lib/requirement-file.test.ts)
 */
import { isRequirementUploadFile } from "./requirement-file";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isRequirementUploadFile({ name: "MED Bite BRD.pdf" }), "pdf");
assert(isRequirementUploadFile({ name: "scope.docx" }), "docx");
assert(isRequirementUploadFile({ name: "notes.TXT" }), "txt");
assert(isRequirementUploadFile({ name: "brief.md" }), "md");
assert(!isRequirementUploadFile({ name: "scan.png" }), "reject image");
assert(!isRequirementUploadFile({ name: "legacy.doc" }), "reject legacy Word");
assert(!isRequirementUploadFile({ name: "page.html" }), "reject html");

console.log("requirement-file.test.ts ok");
