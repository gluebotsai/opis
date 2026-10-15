
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    

select
    conversation_id as unique_field,
    count(*) as n_records

from "worktual_bigint"."ccass_marts_aiccaas"."mart_conversations"
where conversation_id is not null
group by conversation_id
having count(*) > 1



  
  
      
    ) dbt_internal_test