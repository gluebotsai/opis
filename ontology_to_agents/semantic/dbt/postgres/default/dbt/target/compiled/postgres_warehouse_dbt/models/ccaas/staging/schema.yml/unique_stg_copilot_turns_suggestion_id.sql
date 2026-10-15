
    
    

select
    suggestion_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_staging_aiccaas"."stg_copilot_turns"
where suggestion_id is not null
group by suggestion_id
having count(*) > 1


