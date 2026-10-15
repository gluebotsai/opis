
    
    

select
    queue_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_setup_ccaas_queues"
where queue_id is not null
group by queue_id
having count(*) > 1


