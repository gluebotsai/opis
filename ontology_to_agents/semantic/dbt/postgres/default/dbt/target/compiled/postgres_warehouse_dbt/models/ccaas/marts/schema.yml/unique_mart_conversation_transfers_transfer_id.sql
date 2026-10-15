
    
    

select
    transfer_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_conversation_transfers"
where transfer_id is not null
group by transfer_id
having count(*) > 1


