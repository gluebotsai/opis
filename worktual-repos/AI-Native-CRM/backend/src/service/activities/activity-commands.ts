/**
 * Framework-agnostic activity feed commands for Fastify Wave 8.
 */

import type { ActivityType } from "@prisma/client";
import type { PaginatedResult } from "@/lib/pagination";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  getActivityStats,
  listUserActivities,
  type ActivityFeedItem,
  type ActivityOwnerScope,
  type ActivityStats,
} from "@/dao/activities/activity-feed-service";
import type { ActivityFeedStatus } from "@/service/activities/types";
import { canViewAllRecords } from "@/service/auth/rbac";
import { getCurrentUserRole } from "@/service/auth/require-role";
import { updateTaskStatusCommand } from "@/service/contacts/contact-commands";

async function resolveOwnerScope(
  requested?: ActivityOwnerScope,
): Promise<ActivityOwnerScope> {
  const role = await getCurrentUserRole();
  if (requested === "all" && canViewAllRecords(role)) return "all";
  return "mine";
}

export async function listActivitiesPageCommand(filters: {
  page?: number;
  type?: ActivityType | "all";
  status?: ActivityFeedStatus | "all";
  search?: string;
  ownerScope?: ActivityOwnerScope;
}): Promise<
  PaginatedResult<ActivityFeedItem> & {
    ownerScope: ActivityOwnerScope;
    canViewAll: boolean;
  }
> {
  const userId = await getServerUserId();
  const role = await getCurrentUserRole();
  const canViewAll = canViewAllRecords(role);
  if (!userId) {
    return {
      items: [],
      pagination: {
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      },
      ownerScope: "mine",
      canViewAll,
    };
  }

  const ownerScope = await resolveOwnerScope(filters.ownerScope);
  const result = await listUserActivities({
    userId,
    page: filters.page ?? 1,
    type: filters.type ?? "all",
    status: filters.status ?? "all",
    search: filters.search,
    ownerScope,
  });
  return { ...result, ownerScope, canViewAll };
}

export async function getActivityStatsCommand(filters?: {
  ownerScope?: ActivityOwnerScope;
}): Promise<ActivityStats & { ownerScope: ActivityOwnerScope; canViewAll: boolean }> {
  const userId = await getServerUserId();
  const role = await getCurrentUserRole();
  const canViewAll = canViewAllRecords(role);
  if (!userId) {
    return {
      total: 0,
      upcoming: 0,
      overdue: 0,
      logged: 0,
      ownerScope: "mine",
      canViewAll,
    };
  }
  const ownerScope = await resolveOwnerScope(filters?.ownerScope);
  const stats = await getActivityStats({ userId, ownerScope });
  return { ...stats, ownerScope, canViewAll };
}

export async function completeActivityTaskCommand(activityId: string) {
  return updateTaskStatusCommand(activityId, "completed");
}
