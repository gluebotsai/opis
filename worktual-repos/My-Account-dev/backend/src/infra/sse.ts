import { EVENT_CHANNELS, subscribeToChannel } from "./events.js";
import { getSession } from "../modules/auth/sessions.js";
import { pool } from "../db/pool.js";
import * as partnerAuthRepo from "../repositories/raw/partnerAuth.repo.js";
import * as resellerAuthRepo from "../repositories/raw/resellerAuth.repo.js";

const clients = new Set();
const HEARTBEAT_MS = 25_000;

function writeSse(response: any, event: any, data: any) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function clientMatchesFilters(client: any, payload: any) {
  const filters = client.filters;
  if (!filters?.channels?.length) {
    return true;
  }

  if (!filters.channels.includes(payload.channel)) {
    return false;
  }

  if (filters.leadId && payload.leadId && filters.leadId !== payload.leadId) {
    return false;
  }

  if (filters.mailboxProfile && payload.mailboxProfile && filters.mailboxProfile !== payload.mailboxProfile) {
    return false;
  }

  // Customer sessions only receive cancellation events for their organization.
  if (
    client.auth?.type === "customer" &&
    payload.organizationId &&
    client.auth.session?.organizationId &&
    String(payload.organizationId) !== String(client.auth.session.organizationId)
  ) {
    return false;
  }

  if (client.auth?.type === "partner") {
    const partnerId = client.auth.session?.partnerId;
    if (!partnerId || !payload.partnerId || String(payload.partnerId) !== String(partnerId)) {
      return false;
    }
  }

  if (client.auth?.type === "reseller") {
    const resellerId = client.auth.session?.resellerId;
    if (!resellerId || !payload.resellerId || String(payload.resellerId) !== String(resellerId)) {
      return false;
    }
  }

  return true;
}

async function resolveStreamAuth(request: any) {
  const headerToken = request.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
  const queryToken = String(request.query.access_token || request.query.token || "").trim();
  const token = headerToken || queryToken;

  if (!token) {
    return null;
  }

  const session = await getSession(token);
  if (session) {
    return { type: "internal", session };
  }

  const { rows } = await pool.query(
    `SELECT customer_user_id, organization_id, email
     FROM customer_auth_sessions
     WHERE token = $1 AND expires_at > NOW()
     LIMIT 1`,
    [token],
  );

  if (rows[0]) {
    return {
      type: "customer",
      session: {
        customerUserId: rows[0].customer_user_id,
        organizationId: rows[0].organization_id,
        email: rows[0].email,
      },
    };
  }

  const partnerSession = await partnerAuthRepo.selectPartnerSession(token);
  if (partnerSession) {
    return {
      type: "partner",
      session: {
        partnerUserId: partnerSession.partner_user_id,
        partnerId: partnerSession.partner_id,
        email: partnerSession.email,
        companyName: partnerSession.company_name,
      },
    };
  }

  const resellerSession = await resellerAuthRepo.selectResellerSession(token);
  if (resellerSession) {
    return {
      type: "reseller",
      session: {
        resellerUserId: resellerSession.reseller_user_id,
        resellerId: resellerSession.reseller_id,
        email: resellerSession.email,
        companyName: resellerSession.company_name,
      },
    };
  }

  return null;
}

function parseChannelFilters(request: any) {
  const raw = String(request.query.channels || "quotations,payments,tickets,mail");
  const names = raw
    .split(",")
    .map((entry: any) => entry.trim())
    .filter(Boolean);

  const channelMap = {
    quotations: EVENT_CHANNELS.QUOTATIONS,
    payments: EVENT_CHANNELS.PAYMENTS,
    commissions: EVENT_CHANNELS.COMMISSIONS,
    tickets: EVENT_CHANNELS.TICKETS,
    mail: EVENT_CHANNELS.MAIL,
    cancellations: EVENT_CHANNELS.CANCELLATIONS,
    requests: EVENT_CHANNELS.REQUESTS,
  };

  return {
    channels: names.map((name: any) => (channelMap as Record<string, any>)[name]).filter(Boolean),
    leadId: request.query.leadId ? String(request.query.leadId) : null,
    mailboxProfile: request.query.mailboxProfile ? String(request.query.mailboxProfile) : null,
  };
}

export async function handleEventsStream(request: any, response: any) {
  const auth = await resolveStreamAuth(request);
  if (!auth) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const client = {
    response,
    auth,
    filters: parseChannelFilters(request),
  };

  clients.add(client);
  writeSse(response, "connected", { ok: true, at: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    writeSse(response, "heartbeat", { at: new Date().toISOString() });
  }, HEARTBEAT_MS);

  const fanOut = (payload: any) => {
    const envelope = {
      channel: payload.channel,
      event: payload.event,
      ...payload,
    };

    if (!clientMatchesFilters(client, envelope)) {
      return;
    }

    // Always use the generic SSE "message" type so clients receive every
    // event without maintaining a brittle named-event allowlist.
    writeSse(response, "message", envelope);
  };

  const unsubscribers: any = [];
  for (const channel of client.filters.channels) {
    const handler = (payload: any) => fanOut({ ...payload, channel });
    unsubscribers.push(await subscribeToChannel(channel, handler));
  }

  request.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(client);
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  });
}

export function getSseClientCount() {
  return clients.size;
}
