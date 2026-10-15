function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

const WEBCHAT_JOIN = `
  SELECT cc.*,
         wc.webchat_id,
         wc.title AS webchat_title,
         wc.alias_title,
         wc.description AS webchat_description,
         wc.greeting_message,
         wc.trigger_message,
         wc.personalisation
  FROM setup_channel_configs cc
  INNER JOIN setup_webchat_configs wc ON wc.channel_config_id = cc.id
`;

export async function listWebchatChannelConfigs(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `${WEBCHAT_JOIN}
     WHERE cc.organization_id = $1 AND cc.channel_type = 'web_chat'
     ORDER BY cc.created_at DESC`,
    [organizationId],
  );
  return rows;
}

export async function getWebchatChannelConfigById(runner, organizationId, channelConfigId) {
  const { rows } = await runnerQuery(runner).query(
    `${WEBCHAT_JOIN}
     WHERE cc.organization_id = $1 AND cc.id = $2 AND cc.channel_type = 'web_chat'`,
    [organizationId, channelConfigId],
  );
  return rows[0] || null;
}

export async function insertWebchatChannelConfig(
  runner,
  organizationId,
  channelFields,
  webchatFields,
) {
  const { rows: channelRows } = await runnerQuery(runner).query(
    `INSERT INTO setup_channel_configs (
       organization_id, channel_type, name, status, product_ids
     ) VALUES ($1, 'web_chat', $2, $3, $4::jsonb)
     RETURNING *`,
    [
      organizationId,
      channelFields.name,
      channelFields.status || "pending",
      JSON.stringify(channelFields.productIds || ["contact-center"]),
    ],
  );
  const channel = channelRows[0];
  await runnerQuery(runner).query(
    `INSERT INTO setup_webchat_configs (
       channel_config_id, webchat_id, title, alias_title, description,
       greeting_message, trigger_message, personalisation
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      channel.id,
      webchatFields.webchatId,
      webchatFields.title,
      webchatFields.aliasTitle,
      webchatFields.description || null,
      webchatFields.greetingMessage,
      webchatFields.triggerMessage || null,
      JSON.stringify(webchatFields.personalisation || {}),
    ],
  );
  return getWebchatChannelConfigById(runner, organizationId, channel.id);
}

export async function updateWebchatChannelConfig(
  runner,
  organizationId,
  channelConfigId,
  channelFields,
  webchatFields,
) {
  if (channelFields && Object.keys(channelFields).length) {
    await runnerQuery(runner).query(
      `UPDATE setup_channel_configs SET
         name = COALESCE($3, name),
         status = COALESCE($4, status),
         product_ids = COALESCE($5::jsonb, product_ids),
         updated_at = NOW()
       WHERE organization_id = $1 AND id = $2 AND channel_type = 'web_chat'`,
      [
        organizationId,
        channelConfigId,
        channelFields.name ?? null,
        channelFields.status ?? null,
        channelFields.productIds === undefined ? null : JSON.stringify(channelFields.productIds),
      ],
    );
  }
  if (webchatFields && Object.keys(webchatFields).length) {
    const hasDescription = Object.prototype.hasOwnProperty.call(webchatFields, "description");
    const hasTrigger = Object.prototype.hasOwnProperty.call(webchatFields, "triggerMessage");
    const hasPersonalisation = Object.prototype.hasOwnProperty.call(webchatFields, "personalisation");
    await runnerQuery(runner).query(
      `UPDATE setup_webchat_configs SET
         title = COALESCE($2, title),
         alias_title = COALESCE($3, alias_title),
         description = CASE WHEN $7 THEN $4 ELSE description END,
         greeting_message = COALESCE($5, greeting_message),
         trigger_message = CASE WHEN $8 THEN $6 ELSE trigger_message END,
         personalisation = CASE WHEN $10 THEN $9::jsonb ELSE personalisation END,
         updated_at = NOW()
       WHERE channel_config_id = $1`,
      [
        channelConfigId,
        webchatFields.title ?? null,
        webchatFields.aliasTitle ?? null,
        hasDescription ? webchatFields.description : null,
        webchatFields.greetingMessage ?? null,
        hasTrigger ? webchatFields.triggerMessage : null,
        hasDescription,
        hasTrigger,
        hasPersonalisation ? JSON.stringify(webchatFields.personalisation || {}) : null,
        hasPersonalisation,
      ],
    );
  }
  return getWebchatChannelConfigById(runner, organizationId, channelConfigId);
}

export async function deleteWebchatChannelConfig(runner, organizationId, channelConfigId) {
  const { rowCount } = await runnerQuery(runner).query(
    `DELETE FROM setup_channel_configs
     WHERE organization_id = $1 AND id = $2 AND channel_type = 'web_chat'`,
    [organizationId, channelConfigId],
  );
  return rowCount > 0;
}
