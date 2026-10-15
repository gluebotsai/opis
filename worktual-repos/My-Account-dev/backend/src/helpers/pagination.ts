import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface Pagination {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

export function parsePagination(input: unknown): Pagination {
  const { page, pageSize } = paginationSchema.parse(input);
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export function paginated<T>(
  items: T[],
  total: number,
  pagination: Pagination,
) {
  return {
    data: items,
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      pageCount: Math.ceil(total / pagination.pageSize),
    },
  };
}
