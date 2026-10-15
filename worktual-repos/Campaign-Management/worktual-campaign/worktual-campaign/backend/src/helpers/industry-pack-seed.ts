/**
 * Day-1 seed catalog for a tenant pack from mode + industry_type.
 * Soft hints only — never a forced create checklist.
 */

export type PackFieldAsk = "optional" | "recommended";
export type PackFieldType = "string" | "number";
export type PackFieldSource = "seed" | "learned" | "user";
export type PackFieldStatus = "active" | "suggested";

export type PackField = {
  key: string;
  label: string;
  type: PackFieldType;
  ask: PackFieldAsk;
  source: PackFieldSource;
  status: PackFieldStatus;
};

export type PackRuleSource = "seed" | "user" | "agent";

export type PackRule = {
  id: string;
  text: string;
  source: PackRuleSource;
  createdAt: string;
  updatedAt?: string;
};

export type IndustryPackPayload = {
  version: 1;
  mode: "b2b" | "b2c";
  seedIndustryType: string;
  fields: PackField[];
  rules: PackRule[];
};

type SeedField = Omit<PackField, "source" | "status">;

const B2B_BASE: SeedField[] = [
  { key: "job_title", label: "job title", ask: "recommended", type: "string" },
];

const B2C_BASE: SeedField[] = [
  { key: "segment", label: "customer segment", ask: "optional", type: "string" },
  {
    key: "product_interest",
    label: "product interest",
    ask: "optional",
    type: "string",
  },
];

const VERTICALS: Array<{ needles: string[]; fields: SeedField[] }> = [
  {
    needles: ["financ", "fintech", "bank", "lending", "insur"],
    fields: [
      { key: "income", label: "income", ask: "optional", type: "number" },
      { key: "score", label: "score", ask: "optional", type: "number" },
      { key: "age", label: "age", ask: "optional", type: "number" },
    ],
  },
  {
    needles: ["health", "hospital", "clinic", "pharma", "medical"],
    fields: [{ key: "age", label: "age", ask: "optional", type: "number" }],
  },
  {
    needles: ["real estate", "realestate", "property", "housing"],
    fields: [
      { key: "age", label: "age", ask: "optional", type: "number" },
      { key: "income", label: "income", ask: "optional", type: "number" },
    ],
  },
  {
    needles: ["retail", "e-commerce", "ecommerce", "commerce", "shop"],
    fields: [
      {
        key: "product_interest",
        label: "product interest",
        ask: "optional",
        type: "string",
      },
      {
        key: "loyalty_tier",
        label: "loyalty tier",
        ask: "optional",
        type: "string",
      },
    ],
  },
  {
    needles: ["technolog", "software", "saas", "it services"],
    fields: [
      { key: "job_title", label: "job title", ask: "optional", type: "string" },
    ],
  },
];

function normalizeVertical(industryType: string): string {
  return String(industryType || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function mergeSeedFields(...groups: SeedField[][]): PackField[] {
  const byKey = new Map<string, PackField>();
  for (const group of groups) {
    for (const row of group) {
      const key = String(row.key || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
      if (!key) continue;
      const prev = byKey.get(key);
      byKey.set(key, {
        key,
        label: String(row.label || prev?.label || key.replace(/_/g, " ")),
        type: (row.type || prev?.type || "string") as PackFieldType,
        ask: (row.ask || prev?.ask || "optional") as PackFieldAsk,
        source: "seed",
        status: "active",
      });
    }
  }
  return [...byKey.values()];
}

function verticalSeedFields(industryType: string): SeedField[] {
  const blob = normalizeVertical(industryType);
  if (!blob) return [];
  const matched: SeedField[] = [];
  for (const row of VERTICALS) {
    if (row.needles.some((n) => blob.includes(n))) {
      matched.push(...row.fields);
    }
  }
  return matched;
}

export function buildSeedPayload(input: {
  mode: "b2b" | "b2c";
  industryType?: string | null;
}): IndustryPackPayload {
  const mode = input.mode === "b2c" ? "b2c" : "b2b";
  const seedIndustryType = String(input.industryType || "").trim();
  const base = mode === "b2c" ? B2C_BASE : B2B_BASE;
  return {
    version: 1,
    mode,
    seedIndustryType,
    fields: mergeSeedFields(base, verticalSeedFields(seedIndustryType)),
    rules: [],
  };
}

export function emptyPayload(input: {
  mode: "b2b" | "b2c";
  industryType?: string | null;
}): IndustryPackPayload {
  return {
    version: 1,
    mode: input.mode === "b2c" ? "b2c" : "b2b",
    seedIndustryType: String(input.industryType || "").trim(),
    fields: [],
    rules: [],
  };
}

export function normalizePayload(raw: unknown): IndustryPackPayload {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const mode = obj.mode === "b2c" ? "b2c" : "b2b";
  const fieldsRaw = Array.isArray(obj.fields) ? obj.fields : [];
  const rulesRaw = Array.isArray(obj.rules) ? obj.rules : [];
  const fields: PackField[] = [];
  const seen = new Set<string>();
  for (const row of fieldsRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const key = String(r.key || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fields.push({
      key,
      label: String(r.label || key.replace(/_/g, " ")).trim() || key,
      type: r.type === "number" ? "number" : "string",
      ask: r.ask === "recommended" ? "recommended" : "optional",
      source:
        r.source === "learned" || r.source === "user" ? r.source : "seed",
      status: r.status === "suggested" ? "suggested" : "active",
    });
  }
  const rules: PackRule[] = [];
  for (const row of rulesRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id || "").trim();
    const text = String(r.text || "").trim();
    if (!id || !text) continue;
    rules.push({
      id,
      text,
      source:
        r.source === "agent" || r.source === "seed" ? r.source : "user",
      createdAt: String(r.createdAt || new Date().toISOString()),
      ...(r.updatedAt ? { updatedAt: String(r.updatedAt) } : {}),
    });
  }
  return {
    version: 1,
    mode,
    seedIndustryType: String(obj.seedIndustryType || "").trim(),
    fields,
    rules,
  };
}

export function newRuleId(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function slugFieldKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}
