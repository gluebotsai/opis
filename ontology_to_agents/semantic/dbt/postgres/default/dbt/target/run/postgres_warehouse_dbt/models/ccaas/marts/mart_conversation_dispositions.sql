
  create view "worktual_bigint"."ccass_marts_aiccaas"."mart_conversation_dispositions__dbt_tmp"
    
    
  as (
    
-- Disposition entry grain with conversation channel and disposition label.
select
    d.*,
    c.channel,
    c.direction,
    disp.label as disposition_label
from "worktual_bigint"."ccass_staging_aiccaas"."stg_conversation_dispositions" d
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_conversations" c
    on d.conversation_id = c.conversation_id
    and d.organization_id = c.organization_id
left join "worktual_bigint"."ccass_staging_aiccaas"."stg_dispositions" disp
    on d.disposition_id = disp.disposition_id
    and d.organization_id = disp.organization_id
  );