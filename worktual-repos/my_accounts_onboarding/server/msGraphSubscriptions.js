import { pool } from "./db/pool.js";
import { getAppUrl } from "./msGraphConfig.js";
import { getValidAccessTokenForProfile } from "./msGraphTokens.js";
import { enqueueMailSync } from "./infra/queues.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function webhookUrl() {
  const appUrl = process.env.MAIL_API_PUBLIC_URL?.trim() || getAppUrl().replace(":5173", ":3002");
  return `${appUrl.replace(/\/$/, "")}/api/mail/graph/webhook`;
}

export async function createGraphMailSubscription(mailboxProfile) {
  const connection = await getValidAccessTokenForProfile(mailboxProfile);
  if (!connection?.accessToken) {
    return null;
  }

  const expiresAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch(`${GRAPH_BASE}/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      changeType: "created,updated",
      notificationUrl: webhookUrl(),
      resource: "/me/mailFolders('Inbox')/messages",
      expirationDateTime: expiresAt,
      clientState: `worktual-${mailboxProfile}`,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || "Could not create Graph mail subscription.");
  }

  await pool.query(
    `INSERT INTO graph_mail_subscriptions (
      subscription_id, mailbox_profile, resource, client_state, expires_at
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (subscription_id) DO UPDATE SET
      mailbox_profile = EXCLUDED.mailbox_profile,
      resource = EXCLUDED.resource,
      client_state = EXCLUDED.client_state,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()`,
    [
      payload.id,
      mailboxProfile,
      payload.resource,
      payload.clientState || `worktual-${mailboxProfile}`,
      payload.expirationDateTime,
    ],
  );

  return payload;
}

export async function renewGraphSubscriptions() {
  const { rows } = await pool.query(
    `SELECT subscription_id, mailbox_profile
     FROM graph_mail_subscriptions
     WHERE expires_at < NOW() + INTERVAL '12 hours'`,
  );

  const renewed = [];
  for (const row of rows) {
    try {
      const created = await createGraphMailSubscription(row.mailbox_profile);
      if (created) {
        renewed.push(created.id);
      }
    } catch (error) {
      console.warn(
        `[graph] Subscription renewal failed for ${row.mailbox_profile}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { renewed };
}

export async function handleGraphWebhookNotification(body) {
  const notifications = body?.value || [];
  const processed = [];

  for (const notification of notifications) {
    const clientState = String(notification.clientState || "");
    const mailboxProfile = clientState.replace(/^worktual-/, "") || "sales";

    await enqueueMailSync({
      profile: mailboxProfile,
      folder: "inbox",
      subscriptionId: notification.subscriptionId,
    });

    processed.push(notification.subscriptionId);
  }

  return { processed: processed.length };
}

export async function deleteGraphSubscription(subscriptionId, mailboxProfile) {
  const connection = await getValidAccessTokenForProfile(mailboxProfile);
  if (connection?.accessToken) {
    await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${connection.accessToken}` },
    }).catch(() => undefined);
  }

  await pool.query(`DELETE FROM graph_mail_subscriptions WHERE subscription_id = $1`, [
    subscriptionId,
  ]);
}
