/**
 * Tenant-shared recommendation board (Campaign SPA + CRM embed).
 */

import { apiGet, apiPut } from "@/services/api";

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

export async function fetchRecommendationCards(): Promise<unknown[]> {
  const { data } = await apiGet<ApiBody<{ items: unknown[] }>>(
    "/recommendations",
  );
  return Array.isArray(data.items) ? data.items : [];
}

export async function putRecommendationCards(
  cards: unknown[],
  opts?: { replaceActive?: boolean },
): Promise<unknown[]> {
  const { data } = await apiPut<ApiBody<{ items: unknown[] }>>(
    "/recommendations",
    {
      cards,
      replaceActive: Boolean(opts?.replaceActive),
    },
  );
  return Array.isArray(data.items) ? data.items : cards;
}
