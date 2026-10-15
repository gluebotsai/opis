

  create or replace view `webtracking_staging`.`stg_web_sessions` 
  
    
  
  
    
    
  as (
    select
    session_id,
    visitor_id,
    website_id,
    coalesce(organization_id, 0) as organization_id,
    user_id,
    started_at,
    ended_at,
    duration_seconds,
    entry_page,
    exit_page,
    entry_url,
    exit_url,
    pageview_count as dim_pageview_count_stale,
    is_bounce as dim_is_bounce_stale,
    referrer,
    referrer_domain,
    -- Prefer dim UTM columns; fall back to query params on entry_page (common in this dataset).
    if(
        utm_source != '',
        utm_source,
        extractURLParameter(entry_page, 'utm_source')
    ) as utm_source,
    if(
        utm_medium != '',
        utm_medium,
        extractURLParameter(entry_page, 'utm_medium')
    ) as utm_medium,
    if(
        utm_campaign != '',
        utm_campaign,
        extractURLParameter(entry_page, 'utm_campaign')
    ) as utm_campaign,
    if(
        utm_term != '',
        utm_term,
        extractURLParameter(entry_page, 'utm_term')
    ) as utm_term,
    if(
        utm_content != '',
        utm_content,
        extractURLParameter(entry_page, 'utm_content')
    ) as utm_content,
    wt_organization_id,
    wt_campaign_id,
    wt_contact_id,
    device,
    browser,
    browser_version,
    platform,
    country,
    city,
    region,
    latitude,
    longitude,
    ip_hash,
    user_agent,
    language,
    sdk_version,
    if(
        utm_campaign != ''
        or wt_campaign_id is not null
        or extractURLParameter(entry_page, 'utm_campaign') != ''
        or extractURLParameter(entry_page, 'utm_source') != ''
        or positionCaseInsensitive(entry_page, 'utm_campaign=') > 0
        or positionCaseInsensitive(entry_page, 'utm_source=') > 0,
        1,
        0
    ) as is_campaign_attributed,
    if(user_id != '' or wt_contact_id is not null, 1, 0) as is_identified,
    created_at,
    updated_at
from `web_tracking`.`dim_sessions` FINAL
    
  )
      
      
                    -- end_of_sql
                    
                    