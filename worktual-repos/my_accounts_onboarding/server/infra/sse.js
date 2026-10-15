import { EVENT_CHANNELS, subscribeToChannel } from "./events.js";
import { getSession } from "../sessions.js";
import { pool } from "../db/pool.js";

const clients = new Set();
const HEARTBEAT_MS = 25_000;

function writeSse(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function clientMatchesFilters(client, payload) {
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

  return true;
}

async function resolveStreamAuth(request) {
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

  return null;
}

function parseChannelFilters(request) {
  const raw = String(request.query.channels || "quotations,payments,tickets,mail");
  const names = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const channelMap = {
    quotations: EVENT_CHANNELS.QUOTATIONS,
    payments: EVENT_CHANNELS.PAYMENTS,
    tickets: EVENT_CHANNELS.TICKETS,
    mail: EVENT_CHANNELS.MAIL,
  };

  return {
    channels: names.map((name) => channelMap[name]).filter(Boolean),
    leadId: request.query.leadId ? String(request.query.leadId) : null,
    mailboxProfile: request.query.mailboxProfile ? String(request.query.mailboxProfile) : null,
  };
}

export async function handleEventsStream(request, response) {
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

  const fanOut = (payload) => {
    const envelope = {
      channel: payload.channel,
      event: payload.event,
      ...payload,
    };

    if (!clientMatchesFilters(client, envelope)) {
      return;
    }

    writeSse(response, payload.event || "message", envelope);
  };

  const unsubscribers = [];
  for (const channel of client.filters.channels) {
    const handler = (payload) => fanOut({ ...payload, channel });
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
