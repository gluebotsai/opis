{{ config(materialized='view') }}
select *
from {{ ref('stg_ccaas_setup_users') }}
