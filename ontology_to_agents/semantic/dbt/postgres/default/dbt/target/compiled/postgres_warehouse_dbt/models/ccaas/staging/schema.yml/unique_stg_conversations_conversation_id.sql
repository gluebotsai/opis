
    
    

select
    conversation_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_staging_aiccaas"."stg_conversations"
where conversation_id is not null
group by conversation_id
having count(*) > 1


