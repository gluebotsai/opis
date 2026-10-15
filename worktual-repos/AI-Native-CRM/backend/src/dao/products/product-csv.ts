import type { ProductStatus } from "@prisma/client";

export type CatalogProductRow = {
  name: string;
  sku?: string | null;
  price?: number | null;
  currency?: string;
  status?: ProductStatus;
  category?: string | null;
  brand?: string | null;
  subcategory?: string | null;
  stockOnHand?: number | null;
  tags?: string | null;
  tagline?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  productUrl?: string | null;
};

export const MAX_IMPORT_ROWS = 500;

export function parseStatus(raw: string | undefined | null): ProductStatus {
  const v = raw?.trim().toLowerCase();
  if (v === "available" || v === "active" || v === "publish") return "active";
  if (v === "unavailable" || v === "inactive" || v === "archived") {
    return "archived";
  }
  return "draft";
}

export function parsePrice(raw: string | undefined | null): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const n = Number.parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Whole units. Empty = not tracked. Throws if the cell is present but invalid. */
export function parseStockOnHand(raw: string | undefined | null): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("Stock on hand must be a whole number ≥ 0.");
  }
  return n;
}

/** Minimal CSV parser: handles quoted fields and commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === "" && rows.length === 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      pushCell();
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      if (ch === "\r") i++;
      pushCell();
      pushRow();
      continue;
    }
    if (ch === "\r") {
      pushCell();
      pushRow();
      continue;
    }
    cell += ch;
  }
  pushCell();
  if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
    pushRow();
  }
  return rows;
}

const HEADER_ALIASES: Record<string, keyof CatalogProductRow | "skip"> = {
  name: "name",
  title: "name",
  product: "name",
  product_name: "name",
  sku: "sku",
  code: "sku",
  price: "price",
  amount: "price",
  currency: "currency",
  status: "status",
  category: "category",
  tags: "tags",
  tagline: "tagline",
  description: "description",
  image: "imageUrl",
  image_url: "imageUrl",
  imageurl: "imageUrl",
  product_url: "productUrl",
  producturl: "productUrl",
  pdp_url: "productUrl",
  brand: "brand",
  subcategory: "subcategory",
  sub_category: "subcategory",
  stock: "stockOnHand",
  stock_on_hand: "stockOnHand",
  inventory: "stockOnHand",
  active: "skip",
};

export function csvToCatalogRows(csvText: string): {
  rows: CatalogProductRow[];
  errors: Array<{ row: number; message: string }>;
} {
  const table = parseCsv(csvText.trim());
  if (table.length === 0) {
    return { rows: [], errors: [{ row: 0, message: "CSV is empty." }] };
  }

  const headers = table[0].map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, "_"),
  );
  const mapped = headers.map((h) => HEADER_ALIASES[h] ?? null);
  if (!mapped.includes("name")) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message:
            "CSV needs a name/title column. Optional: sku, brand, category, subcategory, stock, product_url, price, currency, status, active, tags, tagline, description, image_url.",
        },
      ],
    };
  }

  const rows: CatalogProductRow[] = [];
  const errs: Array<{ row: number; message: string }> = [];

  for (let i = 1; i < table.length; i++) {
    if (rows.length >= MAX_IMPORT_ROWS) {
      errs.push({
        row: i + 1,
        message: `Stopped at ${MAX_IMPORT_ROWS} data rows (max).`,
      });
      break;
    }
    const line = table[i];
    if (line.every((c) => !c.trim())) continue;

    const draft: Record<string, string> = {};
    mapped.forEach((key, col) => {
      if (!key || key === "skip") return;
      draft[key] = (line[col] ?? "").trim();
    });

    const name = draft.name?.trim();
    if (!name) {
      errs.push({ row: i + 1, message: "Missing name." });
      continue;
    }

    const activeIdx = headers.indexOf("active");
    const activeRaw =
      activeIdx >= 0 ? (line[activeIdx] ?? "").trim().toLowerCase() : "";
    const inactive =
      activeRaw === "false" ||
      activeRaw === "0" ||
      activeRaw === "no" ||
      activeRaw === "off";

    let stockOnHand: number | null = null;
    try {
      stockOnHand = parseStockOnHand(draft.stockOnHand);
    } catch {
      errs.push({
        row: i + 1,
        message: "Stock on hand must be a whole number ≥ 0.",
      });
      continue;
    }

    rows.push({
      name,
      sku: draft.sku || null,
      price: parsePrice(draft.price),
      currency: draft.currency || "USD",
      status: inactive ? "archived" : parseStatus(draft.status),
      category: draft.category || null,
      brand: draft.brand || null,
      subcategory: draft.subcategory || null,
      stockOnHand,
      tags: draft.tags || null,
      tagline: draft.tagline || null,
      description: draft.description || null,
      imageUrl: draft.imageUrl || null,
      productUrl: draft.productUrl || null,
    });
  }

  return { rows, errors: errs };
}
