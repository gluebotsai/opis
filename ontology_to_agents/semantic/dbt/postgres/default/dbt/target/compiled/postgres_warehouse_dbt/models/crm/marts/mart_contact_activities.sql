

select
    ca.contact_activity_id,
    ca.contact_id,
    ca.organization_id,
    org.business_type,
    ca.activity_type,
    ca.subject,
    ca.due_at,
    ca.completed_at,
    ca.folder,
    ca.task_status,
    ca.is_completed,
    ca.is_task,
    ca.created_by_user_id,
    u.full_name          as created_by_name,
    c.lifecycle_stage     as contact_lifecycle_stage,
    c.company_id,
    c.owner_user_id        as contact_owner_user_id,
    ca.created_at,
    ca.updated_at
from "worktual_bigint"."crm_staging"."stg_contact_activities" ca
left join "worktual_bigint"."crm_marts"."mart_contacts" c
    on ca.contact_id = c.contact_id
    and ca.organization_id = c.organization_id
left join "worktual_bigint"."crm_staging"."stg_setup_users" u
    on ca.created_by_user_id = u.user_id
    and ca.organization_id = u.organization_id
left join "worktual_bigint"."crm_staging"."stg_organizations" org
    on ca.organization_id = org.organization_id