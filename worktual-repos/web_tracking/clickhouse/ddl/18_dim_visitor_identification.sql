-- DEPRECATED (repo): CDP Kafka CDC consumer removed. Table may remain on servers for history.
-- Identity for the dashboard uses dim_known_users + dim_sessions.user_id (identify events).
-- Original design: one row per (organization_id, cdp_id) from cdp.customer_profile / identity_keys.

CREATE TABLE IF NOT EXISTS web_tracking.dim_visitor_identification
(
    organization_id       UInt64,
    cdp_id                String,

    website_id            Nullable(UInt32),

    -- Pivoted identity keys (from cdp.identity_keys; prefer verified for primary_*)
    visitor_id            String DEFAULT '',
    anonymous_id          String DEFAULT '',
    webchat_visitor       String DEFAULT '',
    session_id            String DEFAULT '',
    device_id             String DEFAULT '',
    cookie                String DEFAULT '',
    user_id               String DEFAULT '',

    email                 String DEFAULT '',
    email_secondary       String DEFAULT '',
    phone                 String DEFAULT '',
    phone_secondary       String DEFAULT '',
    whatsapp_phone        String DEFAULT '',
    mobile                String DEFAULT '',
    telephone             String DEFAULT '',

    customer_id           String DEFAULT '',
    crm_id                String DEFAULT '',
    crm_contact_id        String DEFAULT '',
    salesforce_id         String DEFAULT '',
    hubspot_id            String DEFAULT '',

    ip_address            String DEFAULT '',
    ip                    String DEFAULT '',
    client_ip             String DEFAULT '',
    ipv4                  String DEFAULT '',
    ipv6                  String DEFAULT '',

    instagram_user        String DEFAULT '',
    facebook_user         String DEFAULT '',

    primary_email         String DEFAULT '',
    primary_phone         String DEFAULT '',

    keys_json             String DEFAULT '[]',

    -- cdp.customer_profile
    first_name            String DEFAULT '',
    last_name             String DEFAULT '',
    gender                String DEFAULT '',
    date_of_birth         Nullable(Date),
    company               String DEFAULT '',
    city                  String DEFAULT '',
    region                String DEFAULT '',
    country               String DEFAULT '',
    language              String DEFAULT '',
    timezone              String DEFAULT '',
    acquisition_channel   String DEFAULT '',
    acquisition_date      Nullable(Date),
    first_referrer        String DEFAULT '',
    profile_first_seen_at Nullable(DateTime64(3, 'UTC')),
    profile_last_seen_at  Nullable(DateTime64(3, 'UTC')),
    profile_created_at    Nullable(DateTime64(3, 'UTC')),
    profile_updated_at    Nullable(DateTime64(3, 'UTC')),
    custom_fields         String DEFAULT '{}',
    tenant_id             String DEFAULT 'default',
    preferences_json      String DEFAULT '{}',
    consent_json          String DEFAULT '{}',
    traits_json           String DEFAULT '{}',
    contact_type          String DEFAULT '',
    primary_product       String DEFAULT '',
    industry              String DEFAULT '',
    blocked               UInt8 DEFAULT 0,

    cdc_last_source       LowCardinality(String) DEFAULT '',
    cdc_last_op           LowCardinality(String) DEFAULT '',
    cdc_last_ts           DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at            DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (organization_id, cdp_id)
SETTINGS index_granularity = 8192;
