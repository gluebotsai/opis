

  create or replace view `webtracking_marts`.`mart_page_views` 
  
    
  
  
    
    
  as (
    select
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    page_path,
    page_title,
    referrer,
    time_on_page_sec,
    max_scroll_depth,
    device,
    country,
    utm_source,
    utm_medium,
    utm_campaign,
    sdk_version,
    created_at
from `webtracking_staging`.`stg_page_views`
    
  )
      
      
                    -- end_of_sql
                    
                    