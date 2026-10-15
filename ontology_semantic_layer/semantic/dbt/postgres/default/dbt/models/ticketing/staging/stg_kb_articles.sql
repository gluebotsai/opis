{{ config(materialized='view') }}

select
    cast(id as text)                as kb_article_id,
    cast(organization_id as text)   as organization_id,
    cast(title as text)             as kb_title,
    cast(title as text)             as title,
    cast(content as text)           as content,
    cast(external_id as text)       as kb_slug,
    cast(external_id as text)       as external_id,
    cast(category as text)          as kb_category,
    cast(category as text)          as category,
    cast(status as text)            as kb_article_status,
    cast(status as text)            as status,
    cast(author_id as text)         as author_id,
    cast(author_name as text)       as author_name,
    views                           as view_count,
    views,
    created_at,
    updated_at,
    (lower(cast(status as text)) = 'published') as is_published
from {{ source('ticketing', 'kb_articles') }}
