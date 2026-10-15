
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    



select assignment_id
from "worktual_bigint"."ccass_staging_aiccaas"."stg_conversation_assignments"
where assignment_id is null



  
  
      
    ) dbt_internal_test