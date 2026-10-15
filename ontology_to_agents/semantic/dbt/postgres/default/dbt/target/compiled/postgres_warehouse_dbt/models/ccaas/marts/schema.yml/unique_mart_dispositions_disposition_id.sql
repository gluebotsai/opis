
    
    

select
    disposition_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_dispositions"
where disposition_id is not null
group by disposition_id
having count(*) > 1


