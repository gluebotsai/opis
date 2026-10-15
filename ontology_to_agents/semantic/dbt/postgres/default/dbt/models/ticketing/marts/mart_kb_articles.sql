{{ config(materialized='view') }}
select
    kb_article_id,
    organization_id,
    external_id,
    title,
    content,
    category,
    author_name,
    author_id,
    kb_article_status   as status,
    (lower(kb_article_status) = 'published') as is_published,
    view_count,
    created_at,
    updated_at
from {{ ref('stg_kb_articles') }}
