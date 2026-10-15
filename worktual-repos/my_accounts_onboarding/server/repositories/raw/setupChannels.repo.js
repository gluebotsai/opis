function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

const EMAIL_JOIN = `
  SELECT cc.*,
         ec.id AS email_row_id,
         ec.provider_type,
         ec.third_party_mode,
         ec.oauth_provider,
         ec.ccaas_handler,
         ec.sender_email,
         ec.sender_name,
         ec.reply_to,
         ec.domain,
         ec.domain_verification_status,
         ec.domain_verification_token,
         ec.smtp_host,
         ec.smtp_port,
         ec.smtp_secure,
         ec.imap_host,
         ec.imap_port,
         ec.imap_secure,
         ec.oauth_connection_id,
         ec.requested_local_part,
         ec.hosted_domain,
         ec.provisioning_status,
         mo.account_email AS oauth_account_email,
         mo.account_name AS oauth_account_name
  FROM setup_channel_configs cc
  INNER JOIN setup_email_configs ec ON ec.channel_config_id = cc.id
  LEFT JOIN mail_oauth_connections mo ON mo.id = ec.oauth_connection_id
`;

export async function listEmailChannelConfigs(runner, organizationId) {
  const { rows } = await runnerQuery(runner).query(
    `${EMAIL_JOIN}
     WHERE cc.organization_id = $1 AND cc.channel_type = 'email'
     ORDER BY cc.created_at DESC`,
    [organizationId],
  );
  return rows;
}

export async function getEmailChannelConfigById(runner, organizationId, channelConfigId) {
  const { rows } = await runnerQuery(runner).query(
    `${EMAIL_JOIN}
     WHERE cc.organization_id = $1 AND cc.id = $2 AND cc.channel_type = 'email'`,
    [organizationId, channelConfigId],
  );
  return rows[0] || null;
}

export async function insertEmailChannelConfig(runner, organizationId, channelFields, emailFields) {
  const { rows: channelRows } = await runnerQuery(runner).query(
    `INSERT INTO setup_channel_configs (
       organization_id, channel_type, name, status, product_ids
     ) VALUES ($1, 'email', $2, $3, $4::jsonb)
     RETURNING *`,
    [
      organizationId,
      channelFields.name,
      channelFields.status || "pending",
      JSON.stringify(channelFields.productIds || []),
    ],
  );
  const channel = channelRows[0];
  await runnerQuery(runner).query(
    `INSERT INTO setup_email_configs (
       channel_config_id, provider_type, third_party_mode, oauth_provider, ccaas_handler,
       sender_email, sender_name, reply_to,
       domain, domain_verification_status, domain_verification_token,
       smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure,
       smtp_user_encrypted, smtp_pass_encrypted, imap_user_encrypted, imap_pass_encrypted,
       requested_local_part, hosted_domain, provisioning_status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
     )`,
    [
      channel.id,
      emailFields.providerType,
      emailFields.thirdPartyMode || null,
      emailFields.oauthProvider || null,
      emailFields.ccaasHandler ?? null,
      emailFields.senderEmail || null,
      emailFields.senderName || null,
      emailFields.replyTo || null,
      emailFields.domain || null,
      emailFields.domainVerificationStatus || null,
      emailFields.domainVerificationToken || null,
      emailFields.smtpHost || null,
      emailFields.smtpPort ?? null,
      emailFields.smtpSecure ?? null,
      emailFields.imapHost || null,
      emailFields.imapPort ?? null,
      emailFields.imapSecure ?? null,
      emailFields.smtpUserEncrypted || null,
      emailFields.smtpPassEncrypted || null,
      emailFields.imapUserEncrypted || null,
      emailFields.imapPassEncrypted || null,
      emailFields.requestedLocalPart || null,
      emailFields.hostedDomain || "vectone.tech",
      emailFields.provisioningStatus || null,
    ],
  );
  return getEmailChannelConfigById(runner, organizationId, channel.id);
}

export async function updateEmailChannelConfig(
  runner,
  organizationId,
  channelConfigId,
  channelFields,
  emailFields,
) {
  if (channelFields && Object.keys(channelFields).length) {
    await runnerQuery(runner).query(
      `UPDATE setup_channel_configs SET
         name = COALESCE($3, name),
         status = COALESCE($4, status),
         product_ids = COALESCE($5::jsonb, product_ids),
         updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [
        organizationId,
        channelConfigId,
        channelFields.name ?? null,
        channelFields.status ?? null,
        channelFields.productIds === undefined ? null : JSON.stringify(channelFields.productIds),
      ],
    );
  }
  if (emailFields && Object.keys(emailFields).length) {
    await runnerQuery(runner).query(
      `UPDATE setup_email_configs SET
         sender_email = COALESCE($2, sender_email),
         sender_name = COALESCE($3, sender_name),
         reply_to = COALESCE($4, reply_to),
         domain = COALESCE($5, domain),
         domain_verification_status = COALESCE($6, domain_verification_status),
         domain_verification_token = COALESCE($7, domain_verification_token),
         smtp_host = COALESCE($8, smtp_host),
         smtp_port = COALESCE($9, smtp_port),
         smtp_secure = COALESCE($10, smtp_secure),
         imap_host = COALESCE($11, imap_host),
         imap_port = COALESCE($12, imap_port),
         imap_secure = COALESCE($13, imap_secure),
         smtp_user_encrypted = COALESCE($14, smtp_user_encrypted),
         smtp_pass_encrypted = COALESCE($15, smtp_pass_encrypted),
         imap_user_encrypted = COALESCE($16, imap_user_encrypted),
         imap_pass_encrypted = COALESCE($17, imap_pass_encrypted),
         third_party_mode = COALESCE($18, third_party_mode),
         oauth_provider = COALESCE($19, oauth_provider),
         requested_local_part = COALESCE($20, requested_local_part),
         hosted_domain = COALESCE($21, hosted_domain),
         provisioning_status = COALESCE($22, provisioning_status),
         oauth_connection_id = COALESCE($23::uuid, oauth_connection_id),
         updated_at = NOW()
       WHERE channel_config_id = $1`,
      [
        channelConfigId,
        emailFields.senderEmail ?? null,
        emailFields.senderName ?? null,
        emailFields.replyTo ?? null,
        emailFields.domain ?? null,
        emailFields.domainVerificationStatus ?? null,
        emailFields.domainVerificationToken ?? null,
        emailFields.smtpHost ?? null,
        emailFields.smtpPort ?? null,
        emailFields.smtpSecure ?? null,
        emailFields.imapHost ?? null,
        emailFields.imapPort ?? null,
        emailFields.imapSecure ?? null,
        emailFields.smtpUserEncrypted ?? null,
        emailFields.smtpPassEncrypted ?? null,
        emailFields.imapUserEncrypted ?? null,
        emailFields.imapPassEncrypted ?? null,
        emailFields.thirdPartyMode ?? null,
        emailFields.oauthProvider ?? null,
        emailFields.requestedLocalPart ?? null,
        emailFields.hostedDomain ?? null,
        emailFields.provisioningStatus ?? null,
        emailFields.oauthConnectionId ?? null,
      ],
    );
    if (Object.prototype.hasOwnProperty.call(emailFields, "ccaasHandler")) {
      await runnerQuery(runner).query(
        `UPDATE setup_email_configs SET ccaas_handler = $2, updated_at = NOW()
         WHERE channel_config_id = $1`,
        [channelConfigId, emailFields.ccaasHandler],
      );
    }
  }
  return getEmailChannelConfigById(runner, organizationId, channelConfigId);
}

export async function deleteEmailChannelConfig(runner, organizationId, channelConfigId) {
  const { rowCount } = await runnerQuery(runner).query(
    `DELETE FROM setup_channel_configs
     WHERE organization_id = $1 AND id = $2 AND channel_type = 'email'`,
    [organizationId, channelConfigId],
  );
  return rowCount > 0;
}

export async function linkOAuthToEmailConfig(runner, channelConfigId, oauthConnectionId, senderEmail) {
  await runnerQuery(runner).query(
    `UPDATE setup_email_configs SET
       oauth_connection_id = $2,
       sender_email = COALESCE($3, sender_email),
       third_party_mode = 'oauth',
       updated_at = NOW()
     WHERE channel_config_id = $1`,
    [channelConfigId, oauthConnectionId, senderEmail || null],
  );
  await runnerQuery(runner).query(
    `UPDATE setup_channel_configs SET status = 'active', updated_at = NOW() WHERE id = $1`,
    [channelConfigId],
  );
}
