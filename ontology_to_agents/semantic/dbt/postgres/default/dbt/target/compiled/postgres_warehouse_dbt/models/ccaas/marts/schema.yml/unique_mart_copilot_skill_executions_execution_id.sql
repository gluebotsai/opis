
    
    

select
    execution_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_copilot_skill_executions"
where execution_id is not null
group by execution_id
having count(*) > 1


