
    
    

select
    sla_state_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_conversation_sla_state"
where sla_state_id is not null
group by sla_state_id
having count(*) > 1


