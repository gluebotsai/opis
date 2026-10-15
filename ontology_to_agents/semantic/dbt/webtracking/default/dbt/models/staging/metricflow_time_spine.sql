{{ config(materialized='table') }}

select
    cast(toDate('2020-01-01') + number as date) as date_day
from numbers(5844)
