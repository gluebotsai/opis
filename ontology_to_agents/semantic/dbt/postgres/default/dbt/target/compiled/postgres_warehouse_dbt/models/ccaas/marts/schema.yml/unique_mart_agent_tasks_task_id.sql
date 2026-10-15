
    
    

select
    task_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_agent_tasks"
where task_id is not null
group by task_id
having count(*) > 1


