
    
    

select
    disposition_entry_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_conversation_dispositions"
where disposition_entry_id is not null
group by disposition_entry_id
having count(*) > 1


