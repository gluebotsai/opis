SELECT
    {{dimension_select}}
    COUNT(*)::bigint AS notifications_unread
FROM campaign.app_notifications
WHERE organization_id = {{org_id}}
  AND read_at IS NULL
  AND (user_id IS NULL OR user_id = {{user_id}})
{{group_by_sql}}
{{limit_sql}}
