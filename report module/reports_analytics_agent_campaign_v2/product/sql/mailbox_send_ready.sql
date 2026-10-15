SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS mailbox_rows,
    COUNT(*) FILTER (WHERE o.needs_reauth IS TRUE)::bigint AS needs_reauth
FROM accounts.setup_channel_configs c
JOIN accounts.setup_email_configs e ON e.channel_config_id = c.id
LEFT JOIN accounts.mail_oauth_connections o ON o.id = e.oauth_connection_id
WHERE c.organization_id = {{org_id}}
{{group_by_sql}}
{{limit_sql}}
