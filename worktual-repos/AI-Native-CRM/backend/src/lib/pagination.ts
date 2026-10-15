/** Production list defaults — never load unbounded result sets. */

export const DEFAULT_PAGE_SIZE = 50;
/** Company and contact modules open with a short page. Other modules stay on DEFAULT_PAGE_SIZE. */
export const COMPANY_LIST_PAGE_SIZE = 20;
export const CONTACT_LIST_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/** Max cards shown per pipeline stage column on the board. */
export const BOARD_STAGE_LIMIT = 40;

export type PaginationInput = {
  page?: number;
  pageSize?: number;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type PaginatedResult<T> = {
  items: T[];
  pagination: PaginationMeta;
};

/** Cursor (keyset) pagination — preferred at lakhs+ rows over large OFFSET. */
export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasNext: boolean;
};

export function clampPageSize(
  value: number | undefined,
  fallback = DEFAULT_PAGE_SIZE,
): number {
  if (!Number.isFinite(value) || value == null || value < 1) return fallback;
  return Math.min(Math.floor(value), MAX_PAGE_SIZE);
}

export function clampPage(value: number | undefined): number {
  if (!Number.isFinite(value) || value == null || value < 1) return 1;
  return Math.floor(value);
}

export function parsePaginationParams(params: {
  page?: string;
  pageSize?: string;
}): { page: number; pageSize: number; skip: number; take: number } {
  const page = clampPage(params.page ? Number.parseInt(params.page, 10) : 1);
  const pageSize = clampPageSize(
    params.pageSize ? Number.parseInt(params.pageSize, 10) : undefined,
  );
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function buildPaginationMeta(
  total: number,
  page: number,
  pageSize: number,
): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  return {
    page: safePage,
    pageSize,
    total,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

export function paginatedResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResult<T> {
  return {
    items,
    pagination: buildPaginationMeta(total, page, pageSize),
  };
}

/** Encode opaque cursor from updatedAt + id. */
export function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(
  cursor: string | null | undefined,
): { updatedAt: Date; id: string } | null {
  if (!cursor?.trim()) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [iso, id] = raw.split("|");
    if (!iso || !id) return null;
    const updatedAt = new Date(iso);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

/**
 * Build a cursor page from take+1 fetch pattern.
 * Caller must fetch `take + 1` items ordered by updatedAt desc, id desc.
 */
export function toCursorPage<T extends { id: string; updatedAt: Date }>(
  rows: T[],
  take: number,
): CursorPage<T> {
  const hasNext = rows.length > take;
  const items = hasNext ? rows.slice(0, take) : rows;
  const last = items[items.length - 1];
  return {
    items,
    hasNext,
    nextCursor: hasNext && last ? encodeCursor(last.updatedAt, last.id) : null,
  };
}
