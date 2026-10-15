
    
    

select
    disposition_entry_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_staging_aiccaas"."stg_conversation_dispositions"
where disposition_entry_id is not null
group by disposition_entry_id
having count(*) > 1


