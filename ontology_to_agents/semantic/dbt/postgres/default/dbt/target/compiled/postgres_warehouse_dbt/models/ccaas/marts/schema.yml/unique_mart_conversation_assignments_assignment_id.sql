
    
    

select
    assignment_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_conversation_assignments"
where assignment_id is not null
group by assignment_id
having count(*) > 1


