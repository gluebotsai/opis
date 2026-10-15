
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    



select disposition_entry_id
from "worktual_bigint"."ccass_staging_aiccaas"."stg_conversation_dispositions"
where disposition_entry_id is null



  
  
      
    ) dbt_internal_test