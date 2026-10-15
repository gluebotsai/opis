{{ config(materialized='view', alias='stg_organizations') }}

select
    org.organization_id,
    cast(org.company_name as text)                      as organization_name,
    org.business_type,
    org.industry_type,
    org.lifecycle_status                                as organization_status,
    cast(coalesce(s.ticket_prefix, '#') as text)        as ticket_prefix,
    cast(coalesce(s.display_timezone, 'UTC') as text)   as display_timezone,
    cast(coalesce(s.portal_auth_mode, 'password') as text) as portal_auth_mode,
    cast(s.portal_slug as text)                         as organization_slug,
    org.created_at,
    org.updated_at
from {{ ref('stg_accounts_organizations') }} org
left join {{ source('ticketing', 'org_settings') }} s
    on org.organization_id = cast(s.organization_id as text)
