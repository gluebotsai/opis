{{ config(materialized='view') }}
select *
from {{ ref('stg_agent_capacity') }}
