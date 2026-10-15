
    
    

select
    agent_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_agents"
where agent_id is not null
group by agent_id
having count(*) > 1


