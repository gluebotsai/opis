import type { FastifyInstance } from "fastify";

import { withOrganizationContext } from "../lib/rls.js";
import {
  emitConversationQueued,
  emitConversationRejected,
  emitConversationRouted,
  emitTransferExpired,
  shouldScheduleOfferExpiration,
} from "./realtime.js";
import {
  releasePendingNonEmailOffersForAgent,
  routeOldestQueuedConversationForAgent,
} from "./conversations.js";
import { cancelOfferExpiration, notifyConversationRouted, scheduleOfferExpiration } from "./offer-lifecycle.js";
import { isRoutablePresenceState } from "./presence-cache.js";
import type { AgentPresenceRecord } from "./presence.js";

export async function applyPresenceRoutingEffects(
  app: FastifyInstance,
  organizationId: string,
  userId: string,
  presence: AgentPresenceRecord,
): Promise<void> {
  if (!isRoutablePresenceState(presence.state)) {
    const released = await withOrganizationContext(app.prisma, organizationId, (db) =>
      releasePendingNonEmailOffersForAgent(db, organizationId, presence.agentId),
    );
    for (const item of released) {
      cancelOfferExpiration(organizationId, item.conversation.id);
      emitConversationRejected(organizationId, item.conversation, userId);
      if (item.transfer) {
        emitTransferExpired(organizationId, item.transfer, userId, item.conversation);
      } else if (item.rerouted && item.nextUserId) {
        emitConversationRouted(organizationId, item.conversation, item.nextUserId);
        if (shouldScheduleOfferExpiration(item.conversation)) {
          await scheduleOfferExpiration(app, organizationId, item.conversation.id);
        }
      } else {
        emitConversationQueued(organizationId, item.conversation);
      }
    }
    return;
  }

  const routed = await withOrganizationContext(app.prisma, organizationId, (db) =>
    routeOldestQueuedConversationForAgent(db, organizationId, presence.agentId, {
      reason: "agent_available",
    }),
  );
  if (routed) {
    notifyConversationRouted(app, organizationId, routed.conversation, routed.userId);
  }
}
