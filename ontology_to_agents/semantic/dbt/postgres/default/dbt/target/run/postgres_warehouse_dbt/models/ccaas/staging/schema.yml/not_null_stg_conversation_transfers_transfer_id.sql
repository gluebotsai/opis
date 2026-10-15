
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    



select transfer_id
from "worktual_bigint"."ccass_staging_aiccaas"."stg_conversation_transfers"
where transfer_id is null



  
  
      
    ) dbt_internal_test