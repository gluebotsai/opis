
    
    select
      count(*) as failures,
      count(*) != 0 as should_warn,
      count(*) != 0 as should_error
    from (
      
    
  
    
    

with all_values as (

    select
        direction as value_field,
        count(*) as n_records

    from "worktual_bigint"."ccass_marts_aiccaas"."mart_conversations"
    group by direction

)

select *
from all_values
where value_field not in (
    'inbound','outbound'
)



  
  
      
    ) dbt_internal_test