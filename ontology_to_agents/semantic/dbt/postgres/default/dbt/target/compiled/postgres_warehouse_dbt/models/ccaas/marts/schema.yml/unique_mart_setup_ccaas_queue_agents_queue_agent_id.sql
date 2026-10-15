
    
    

select
    queue_agent_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_setup_ccaas_queue_agents"
where queue_agent_id is not null
group by queue_agent_id
having count(*) > 1


