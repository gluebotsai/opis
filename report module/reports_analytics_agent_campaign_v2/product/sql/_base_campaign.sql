SELECT
  c.id,
  c.organization_id,
  c.branch_id,
  c.name,
  c.description,
  c.status,
  c.starts_at,
  c.ends_at,
  c.source_channel,
  c.created_by_user_id,
  c.created_at,
  c.updated_at,
  c.goal,
  c.objective,
  c.session_id,
  c.audience_summary,
  c.audience_count,
  c.launch_plan,
  c.launch_local_date,
  c.launch_local_time,
  c.timezone
FROM campaign.campaigns c
WHERE c.organization_id = {{org_id}}
  AND c.branch_id = {{branch_id}}
