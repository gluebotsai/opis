-- Grain: organization_id + channel_name + rejected_reason. Only rejected templates.
-- Kept separate from mart_template_approval (which is org+channel grain) because
-- rejected_reason is a free-form field — pivoting it into columns isn't safe, and
-- mixing grains in one mart breaks measure additivity in the semantic layer.
select
    organization_id,
    channel_name,
    coalesce(rejected_reason, 'unspecified') as rejected_reason,
    min(submitted_at) as first_rejected_template_submitted_at,
    count(*) as rejected_template_count
from "worktual_bigint"."campaign_staging"."stg_regulated_channel_templates"
where is_rejected_flag
group by 1, 2, 3