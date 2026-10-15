{{ config(materialized='view') }}
select *
from {{ ref('stg_setup_ccaas_queues') }}
