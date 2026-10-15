
    
    

select
    capacity_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_agent_capacity"
where capacity_id is not null
group by capacity_id
having count(*) > 1


