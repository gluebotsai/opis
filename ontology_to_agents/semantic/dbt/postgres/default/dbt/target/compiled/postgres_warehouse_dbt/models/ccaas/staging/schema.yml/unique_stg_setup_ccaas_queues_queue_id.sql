
    
    

select
    queue_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_staging_aiccaas"."stg_setup_ccaas_queues"
where queue_id is not null
group by queue_id
having count(*) > 1


