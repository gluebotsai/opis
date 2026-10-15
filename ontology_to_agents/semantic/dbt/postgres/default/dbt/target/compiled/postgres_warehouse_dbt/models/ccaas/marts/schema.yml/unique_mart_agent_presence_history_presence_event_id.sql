
    
    

select
    presence_event_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_agent_presence_history"
where presence_event_id is not null
group by presence_event_id
having count(*) > 1


