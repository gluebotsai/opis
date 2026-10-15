{{ config(materialized='table') }}

select
    cast(day as date) as date_day
from generate_series(
    '2020-01-01'::date,
    '2035-12-31'::date,
    interval '1 day'
) as day
