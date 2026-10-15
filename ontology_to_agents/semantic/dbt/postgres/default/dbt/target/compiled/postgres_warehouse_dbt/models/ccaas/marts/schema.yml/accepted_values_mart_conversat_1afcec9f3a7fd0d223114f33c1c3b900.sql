
    
    

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


