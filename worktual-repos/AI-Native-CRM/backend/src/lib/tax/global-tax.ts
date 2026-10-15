/**
 * Global tax configuration for Finance invoices.
 * India GST (CGST/SGST/IGST), UK VAT, US sales tax (jurisdiction components).
 */

export type TaxCountry = "IN" | "UK" | "US";

export type IndiaGstRate = 0 | 5 | 12 | 18 | 28;

export type UkVatCategory =
  | "standard"
  | "reduced"
  | "zero"
  | "exempt"
  | "outside_scope";

export type TaxComponent = {
  code: string;
  label: string;
  percent: number;
  amount: number;
};

export type TaxBreakdown = {
  country: TaxCountry;
  system: "GST" | "VAT" | "Sales Tax";
  /** Effective total tax rate applied to taxable amount. */
  effectivePercent: number;
  taxableAmount: number;
  taxAmount: number;
  components: TaxComponent[];
  meta: Record<string, string | number | boolean | null>;
  summaryLines: string[];
};

export const TAX_COUNTRY_OPTIONS: Array<{
  value: TaxCountry;
  label: string;
  system: string;
}> = [
  { value: "IN", label: "India", system: "GST" },
  { value: "UK", label: "United Kingdom", system: "VAT" },
  { value: "US", label: "United States", system: "Sales Tax" },
];

export const INDIA_GST_RATE_OPTIONS: Array<{
  value: string;
  label: string;
  rate: IndiaGstRate;
}> = [
  { value: "0", label: "0% — Nil / zero-rated", rate: 0 },
  { value: "5", label: "5% GST", rate: 5 },
  { value: "12", label: "12% GST", rate: 12 },
  { value: "18", label: "18% GST", rate: 18 },
  { value: "28", label: "28% GST", rate: 28 },
];

export const UK_VAT_OPTIONS: Array<{
  value: UkVatCategory;
  label: string;
  rate: number | null;
}> = [
  { value: "standard", label: "Standard VAT — 20%", rate: 20 },
  { value: "reduced", label: "Reduced VAT — 5%", rate: 5 },
  { value: "zero", label: "Zero-rated VAT — 0%", rate: 0 },
  { value: "exempt", label: "Exempt — no VAT charged", rate: null },
  {
    value: "outside_scope",
    label: "Outside scope — VAT not applicable",
    rate: null,
  },
];

/** Indian states & UTs used for intra vs inter-state GST. */
export const INDIA_STATES: Array<{ value: string; label: string; ut?: boolean }> =
  [
    { value: "AN", label: "Andaman and Nicobar Islands", ut: true },
    { value: "AP", label: "Andhra Pradesh" },
    { value: "AR", label: "Arunachal Pradesh" },
    { value: "AS", label: "Assam" },
    { value: "BR", label: "Bihar" },
    { value: "CH", label: "Chandigarh", ut: true },
    { value: "CT", label: "Chhattisgarh" },
    { value: "DH", label: "Dadra and Nagar Haveli and Daman and Diu", ut: true },
    { value: "DL", label: "Delhi", ut: true },
    { value: "GA", label: "Goa" },
    { value: "GJ", label: "Gujarat" },
    { value: "HR", label: "Haryana" },
    { value: "HP", label: "Himachal Pradesh" },
    { value: "JK", label: "Jammu and Kashmir", ut: true },
    { value: "JH", label: "Jharkhand" },
    { value: "KA", label: "Karnataka" },
    { value: "KL", label: "Kerala" },
    { value: "LA", label: "Ladakh", ut: true },
    { value: "LD", label: "Lakshadweep", ut: true },
    { value: "MP", label: "Madhya Pradesh" },
    { value: "MH", label: "Maharashtra" },
    { value: "MN", label: "Manipur" },
    { value: "ML", label: "Meghalaya" },
    { value: "MZ", label: "Mizoram" },
    { value: "NL", label: "Nagaland" },
    { value: "OD", label: "Odisha" },
    { value: "PY", label: "Puducherry", ut: true },
    { value: "PB", label: "Punjab" },
    { value: "RJ", label: "Rajasthan" },
    { value: "SK", label: "Sikkim" },
    { value: "TN", label: "Tamil Nadu" },
    { value: "TS", label: "Telangana" },
    { value: "TR", label: "Tripura" },
    { value: "UP", label: "Uttar Pradesh" },
    { value: "UK", label: "Uttarakhand" },
    { value: "WB", label: "West Bengal" },
  ];

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function moneyComponent(
  code: string,
  label: string,
  percent: number,
  taxableAmount: number,
): TaxComponent {
  return {
    code,
    label,
    percent,
    amount: roundMoney(taxableAmount * (percent / 100)),
  };
}

export type IndiaTaxInput = {
  country: "IN";
  gstRate: IndiaGstRate;
  sellerState: string;
  buyerState: string;
  taxableAmount: number;
};

export type UkTaxInput = {
  country: "UK";
  vatCategory: UkVatCategory;
  taxableAmount: number;
};

export type UsTaxInput = {
  country: "US";
  taxableAmount: number;
  statePercent?: number;
  countyPercent?: number;
  cityPercent?: number;
  specialDistrictPercent?: number;
};

export type GlobalTaxInput = IndiaTaxInput | UkTaxInput | UsTaxInput;

export function computeGlobalTax(input: GlobalTaxInput): TaxBreakdown {
  if (input.country === "IN") {
    return computeIndiaGst(input);
  }
  if (input.country === "UK") {
    return computeUkVat(input);
  }
  return computeUsSalesTax(input);
}

function computeIndiaGst(input: IndiaTaxInput): TaxBreakdown {
  const rate = input.gstRate;
  const taxableAmount = Math.max(0, Number(input.taxableAmount) || 0);
  const seller = input.sellerState.trim().toUpperCase();
  const buyer = input.buyerState.trim().toUpperCase();
  const intraState = Boolean(seller && buyer && seller === buyer);
  const buyerStateMeta = INDIA_STATES.find((s) => s.value === buyer);
  const useUtgst = intraState && Boolean(buyerStateMeta?.ut);

  const half = rate / 2;
  let components: TaxComponent[] = [];
  let summaryLines: string[] = [];

  if (rate === 0) {
    components = [];
    summaryLines = ["GST 0% (nil / zero-rated)"];
  } else if (intraState) {
    if (useUtgst) {
      components = [
        moneyComponent("CGST", "CGST", half, taxableAmount),
        moneyComponent("UTGST", "UTGST", half, taxableAmount),
      ];
      summaryLines = [
        `Intra-UT supply · GST ${rate}%`,
        `CGST ${half}% + UTGST ${half}%`,
      ];
    } else {
      components = [
        moneyComponent("CGST", "CGST", half, taxableAmount),
        moneyComponent("SGST", "SGST", half, taxableAmount),
      ];
      summaryLines = [
        `Intra-state supply · GST ${rate}%`,
        `CGST ${half}% + SGST ${half}%`,
      ];
    }
  } else {
    components = [moneyComponent("IGST", "IGST", rate, taxableAmount)];
    summaryLines = [
      `Inter-state supply · GST ${rate}%`,
      `IGST ${rate}%`,
    ];
  }

  const taxAmount = roundMoney(
    components.reduce((sum, c) => sum + c.amount, 0),
  );

  return {
    country: "IN",
    system: "GST",
    effectivePercent: rate,
    taxableAmount,
    taxAmount,
    components,
    meta: {
      gstRate: rate,
      sellerState: seller || null,
      buyerState: buyer || null,
      supplyType: rate === 0 ? "nil" : intraState ? "intra" : "inter",
      usesUtgst: useUtgst,
    },
    summaryLines,
  };
}

function computeUkVat(input: UkTaxInput): TaxBreakdown {
  const taxableAmount = Math.max(0, Number(input.taxableAmount) || 0);
  const option = UK_VAT_OPTIONS.find((o) => o.value === input.vatCategory);
  const rate = option?.rate ?? null;
  const charged = rate != null;

  const components: TaxComponent[] =
    charged && rate > 0
      ? [moneyComponent("VAT", `VAT (${option?.label ?? "VAT"})`, rate, taxableAmount)]
      : [];

  const summaryLines =
    input.vatCategory === "exempt"
      ? ["Exempt — VAT not charged"]
      : input.vatCategory === "outside_scope"
        ? ["Outside scope — VAT not applicable"]
        : input.vatCategory === "zero"
          ? ["Zero-rated VAT — 0%"]
          : [`${option?.label ?? "VAT"}`];

  const taxAmount = roundMoney(
    components.reduce((sum, c) => sum + c.amount, 0),
  );

  return {
    country: "UK",
    system: "VAT",
    effectivePercent: charged ? rate ?? 0 : 0,
    taxableAmount,
    taxAmount,
    components,
    meta: {
      vatCategory: input.vatCategory,
      vatCharged: charged,
    },
    summaryLines,
  };
}

function computeUsSalesTax(input: UsTaxInput): TaxBreakdown {
  const taxableAmount = Math.max(0, Number(input.taxableAmount) || 0);
  const state = Math.max(0, Number(input.statePercent) || 0);
  const county = Math.max(0, Number(input.countyPercent) || 0);
  const city = Math.max(0, Number(input.cityPercent) || 0);
  const district = Math.max(0, Number(input.specialDistrictPercent) || 0);

  const components: TaxComponent[] = [];
  if (state > 0) {
    components.push(
      moneyComponent("STATE", "State sales tax", state, taxableAmount),
    );
  }
  if (county > 0) {
    components.push(
      moneyComponent("COUNTY", "County sales tax", county, taxableAmount),
    );
  }
  if (city > 0) {
    components.push(
      moneyComponent("CITY", "City sales tax", city, taxableAmount),
    );
  }
  if (district > 0) {
    components.push(
      moneyComponent(
        "DISTRICT",
        "Special district sales tax",
        district,
        taxableAmount,
      ),
    );
  }

  const effectivePercent = roundMoney(state + county + city + district);
  const taxAmount = roundMoney(
    components.reduce((sum, c) => sum + c.amount, 0),
  );

  return {
    country: "US",
    system: "Sales Tax",
    effectivePercent,
    taxableAmount,
    taxAmount,
    components,
    meta: {
      statePercent: state,
      countyPercent: county,
      cityPercent: city,
      specialDistrictPercent: district,
    },
    summaryLines:
      effectivePercent === 0
        ? ["No sales tax applies (0%)"]
        : [
            `Combined sales tax ${effectivePercent}%`,
            "Rates are jurisdiction-dependent; not all components always apply.",
          ],
  };
}

/** Effective single percent to stamp on invoice lines (for line-level tax). */
export function effectiveTaxPercent(breakdown: TaxBreakdown): number {
  return breakdown.effectivePercent;
}
