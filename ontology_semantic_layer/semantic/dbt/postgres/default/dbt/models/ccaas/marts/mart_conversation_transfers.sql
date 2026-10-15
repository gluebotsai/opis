{{ config(materialized='view') }}
select *
from {{ ref('stg_conversation_transfers') }}
