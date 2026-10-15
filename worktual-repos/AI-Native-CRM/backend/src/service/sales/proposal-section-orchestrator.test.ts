/**
 * run: npx tsx src/service/sales/proposal-section-orchestrator.test.ts
 */
import {
  partitionSkeletonForGeneration,
  sectionDraftNeedsRetry,
} from "@/lib/proposal-content-playbook";
import { generateProposalSectionsFromContentPlaybook } from "./proposal-section-orchestrator";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function longBody(label: string): string {
  return Array.from({ length: 800 }, (_, i) => `${label}-${i}`).join(" ");
}

const skeleton = [
  { key: "executive_summary", title: "Executive Summary" },
  { key: "scope_of_work", title: "Scope of work" },
  { key: "commercials", title: "Commercials" },
  { key: "cover", title: "Cover letter" },
];
const { generationOrder } = partitionSkeletonForGeneration(skeleton);
assert(
  generationOrder[0]?.key === "scope_of_work",
  "first generated section is a body section",
);
assert(
  generationOrder[generationOrder.length - 1]?.key === "cover",
  "cover is last",
);
assert(
  generationOrder.findIndex((s) => s.key === "executive_summary") >
    generationOrder.findIndex((s) => s.key === "commercials"),
  "executive summary runs after body sections",
);

assert(
  sectionDraftNeedsRetry({ source: "ai", body: "", targetWords: 180 }),
  "empty section retries once",
);
assert(
  !sectionDraftNeedsRetry({
    source: "ai",
    body: Array.from({ length: 80 }, () => "word").join(" "),
    targetWords: 80,
  }),
  "passing draft stops after first attempt",
);

const calls: string[] = [];
const recapByKey = new Map<string, string[]>();
const closedFact =
  "alpha-widget-batch-417 nightly operator roster for weekend coverage";
process.env.PROPOSAL_CONTENT_QA_MODE = "shadow";

const result = await generateProposalSectionsFromContentPlaybook(
  {
    organizationId: "1",
    skeleton: [
      { key: "executive_summary", title: "Executive Summary", body: "" },
      { key: "scope_of_work", title: "Scope of work", body: "" },
      { key: "approach", title: "Approach", body: "" },
    ],
    contentPlaybook: {
      id: "cp1",
      caseStudyCount: 4,
      confidenceLevel: "low",
      sectionSpecsJson: {
        scope_of_work: { targetWordRange: [80, 200], purpose: "scope" },
        approach: { targetWordRange: [80, 200], purpose: "how" },
        executive_summary: { targetWordRange: [80, 160], purpose: "summary" },
      },
      lengthModelJson: { fallback: "proportional" },
      exemplarBankJson: [],
    },
    caseStudies: [
      {
        id: "cs1",
        sectionAnalysis: [
          {
            sectionKey: "scope_of_work",
            sourceRequirementRefs: ["integration api"],
          },
        ],
      },
    ],
    profile: { themes: ["integration"], summary: "Need API integration" },
    requirementText: "Customer needs API integration for 50 seats.",
    requirementWordCount: 8,
    allowedProducts: ["CRM"],
    products: [],
  },
  {
    callAgent: async (agent, body) => {
      calls.push(agent);
      if (agent === "proposal-kb-retrieve") {
        return { source: "ai", knowledgeBase: "CRM APIs, SLAs, and architecture." };
      }
      if (agent === "proposal-content-qa") {
        return {
          source: "ai",
          failedSectionKeys: ["approach"],
          mismatches: [{ sectionKey: "approach", reason: "thin" }],
        };
      }
      const rec = (body || {}) as Record<string, unknown>;
      const key = String(rec.sectionKey || "");
      recapByKey.set(key, Array.isArray(rec.rollingRecap) ? rec.rollingRecap.map(String) : []);
      if (key === "scope_of_work") {
        return { source: "ai", section: { heading: "Scope", body: "Too short." } };
      }
      return {
        source: "ai",
        section: {
          heading: key,
          body: `${longBody(key)} ${closedFact}`,
          kind: "prose",
        },
      };
    },
  },
);

assert(
  JSON.stringify(result.sections.map((s) => s.key)) ===
    JSON.stringify([
      "executive_summary",
      "scope_of_work",
      "approach",
    ]),
  "assembled output keeps playbook skeleton order",
);
assert(
  result.shortSectionKeys.includes("scope_of_work"),
  "short leaf is reported instead of rewritten",
);
assert(
  (recapByKey.get("executive_summary") || []).length >= 2,
  "exec summary sees prior body recap",
);
assert(
  calls.filter((c) => c === "proposal-generate-section").length === 3,
  "one paid write per playbook leaf; no outline expansion or retry loop",
);
assert(!calls.includes("proposal-outline"), "outline expansion is skipped");
assert(calls.includes("proposal-kb-retrieve"), "org KB is retrieved once");
assert(calls.includes("proposal-content-qa"), "shadow QA still runs the LLM agent");
assert(result.qaFailedKeys.includes("approach"), "QA failures are returned");
assert(
  result.plannedLengths && Object.keys(result.plannedLengths).length === 3,
  "logs/returns planned word targets per playbook section",
);
const plannedTotal = Object.values(result.plannedLengths).reduce(
  (n, w) => n + w,
  0,
);
assert(
  plannedTotal <= 500 &&
    result.plannedLengths.scope_of_work <= 200 &&
    result.plannedLengths.approach <= 200 &&
    result.plannedLengths.executive_summary <= 200,
  "orchestrator planned lengths stay on playbook spec/gold, not a 4x budget",
);
assert(
  result.warnings.some((w) => /approach/i.test(w) && /shadow/i.test(w)),
  "shadow mode records QA warning",
);

console.log("proposal-section-orchestrator.test.ts ok");

const geminiCalls: string[] = [];
const stopped = await generateProposalSectionsFromContentPlaybook(
  {
    organizationId: "1",
    skeleton: [
      { key: "scope_of_work", title: "Scope of work", body: "" },
      { key: "approach", title: "Approach", body: "" },
    ],
    contentPlaybook: {
      id: "cp1",
      caseStudyCount: 4,
      confidenceLevel: "low",
      sectionSpecsJson: {
        scope_of_work: { targetWordRange: [80, 200], purpose: "scope" },
        approach: { targetWordRange: [80, 200], purpose: "how" },
      },
      lengthModelJson: { fallback: "proportional" },
      exemplarBankJson: [],
    },
    caseStudies: [],
    profile: { themes: ["integration"], summary: "Need API integration" },
    requirementText: "Customer needs API integration for 50 seats.",
    requirementWordCount: 8,
    allowedProducts: ["CRM"],
    products: [],
  },
  {
    callAgent: async (agent) => {
      geminiCalls.push(agent);
      if (agent === "proposal-outline") {
        return {
          source: "ai",
          sections: [
            { key: "scope_of_work", title: "Scope", purpose: "scope only" },
            { key: "approach", title: "Approach", purpose: "delivery only" },
          ],
        };
      }
      if (agent === "proposal-kb-retrieve") {
        return { source: "ai", knowledgeBase: "CRM APIs" };
      }
      if (agent === "proposal-generate-section") {
        return {
          source: "heuristic",
          reason: "gemini_unavailable",
          section: { heading: "Scope", body: "" },
        };
      }
      return { source: "ai" };
    },
  },
);
assert(stopped.reason === "gemini_unavailable", "503 stops the job");
assert(
  geminiCalls.filter((c) => c === "proposal-generate-section").length === 1,
  "remaining leaves are not sent to Gemini after 503",
);

console.log("proposal-section-orchestrator gemini-unavailable ok");

const timeoutCalls: string[] = [];
let timeoutSectionAttempts = 0;
const timedOut = await generateProposalSectionsFromContentPlaybook(
  {
    organizationId: "1",
    skeleton: [
      { key: "scope_of_work", title: "Scope of work", body: "" },
      { key: "approach", title: "Approach", body: "" },
    ],
    contentPlaybook: {
      id: "cp1",
      caseStudyCount: 4,
      confidenceLevel: "low",
      sectionSpecsJson: {
        scope_of_work: { targetWordRange: [80, 200], purpose: "scope" },
        approach: { targetWordRange: [80, 200], purpose: "how" },
      },
      lengthModelJson: { fallback: "proportional" },
      exemplarBankJson: [],
    },
    caseStudies: [],
    profile: { themes: ["integration"], summary: "Need API integration" },
    requirementText: "Customer needs API integration for 50 seats.",
    requirementWordCount: 8,
    allowedProducts: ["CRM"],
    products: [],
  },
  {
    callAgent: async (agent) => {
      timeoutCalls.push(agent);
      if (agent === "proposal-kb-retrieve") {
        return { source: "ai", knowledgeBase: "CRM APIs" };
      }
      if (agent === "proposal-generate-section") {
        timeoutSectionAttempts += 1;
        return null;
      }
      return { source: "ai" };
    },
  },
);
assert(timedOut.reason === "gemini_unavailable", "section timeout becomes gemini_unavailable");
assert(
  timeoutSectionAttempts === 2,
  "timed-out section is retried once, not the whole proposal",
);
assert(
  timeoutCalls.filter((c) => c === "proposal-generate-section").length === 2,
  "later sections are not started after section timeout",
);

console.log("proposal-section-orchestrator section-timeout ok");
