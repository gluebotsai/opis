SELECT COUNT(*)::bigint AS unread_notifications
FROM ticketing.notifications
WHERE organization_id = {{org_id}}
  AND is_read = false
  AND {{scope_sql}}
  AND {{time_sql}}
  AND {{filters_sql}}
