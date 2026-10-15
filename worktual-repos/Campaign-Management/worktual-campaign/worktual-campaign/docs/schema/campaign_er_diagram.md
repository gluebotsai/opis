# Campaign DB — ER diagram

Source of truth: [`backend/prisma/schema.prisma`](../../backend/prisma/schema.prisma)  
Database: PostgreSQL `campaign_db` (`DATABASE_URL`).

**External refs (not in this DB):** `tenant_id`, `created_by_user_id`, and `contact_id` point at **my_account_qa** / CDP — users and contacts are not stored here.

## Campaign management flow

1. **Draft** — `campaign_agent_sessions` → audience refs + channel templates + template messages  
2. **Save / launch** — `campaigns` + `campaign_channels` + `campaign_audience`  
3. **Send** — `campaign_send_batches` → `campaign_send_recipients`  
4. **Config gates** — email / push / SMS settings + `channel_sending_profiles`  
5. **Engagement** — `campaign_contact_engagement` + `email_suppressions`

## ER diagram

```mermaid
erDiagram
  Branch ||--o{ OrganizationProduct : has
  Branch ||--o{ Campaign : has
  Branch ||--o{ CampaignAgentSession : has

  Campaign ||--o{ CampaignChannel : has
  Campaign ||--o{ CampaignAudience : freezes
  Campaign ||--o{ CampaignSendBatch : plans
  CampaignSendBatch ||--o{ CampaignSendRecipient : contains

  CampaignAgentSession ||--o{ CampaignAudienceRef : refs
  CampaignAgentSession ||--o{ CampaignChannelTemplate : drafts
  CampaignChannelTemplate ||--o{ CampaignTemplateMessage : chat

  Branch {
    uuid id PK
    uuid tenant_id
    string name
    boolean is_default
  }

  OrganizationProduct {
    uuid id PK
    uuid tenant_id
    uuid branch_id FK
    enum product_code
    enum status
  }

  Campaign {
    uuid id PK
    uuid tenant_id
    uuid branch_id FK
    uuid session_id UK
    string name
    enum status
    jsonb launch_plan
    int audience_count
  }

  CampaignChannel {
    uuid id PK
    uuid campaign_id FK
    string channel
    uuid template_id
    string status
  }

  CampaignAudience {
    uuid campaign_id PK_FK
    uuid contact_id PK
  }

  CampaignAgentSession {
    uuid id PK
    uuid tenant_id
    uuid branch_id FK
    string module
    string stage
    jsonb payload
  }

  CampaignAudienceRef {
    uuid session_id PK_FK
    uuid contact_id PK
  }

  CampaignChannelTemplate {
    uuid id PK
    uuid session_id FK
    string channel
    jsonb fields
  }

  CampaignTemplateMessage {
    uuid id PK
    uuid template_id FK
    int seq
    string kind
    jsonb payload
  }

  CampaignSendBatch {
    uuid id PK
    uuid campaign_id FK
    string channel
    int seq
    string status
    timestamptz scheduled_for
  }

  CampaignSendRecipient {
    uuid id PK
    uuid batch_id FK
    uuid campaign_id
    uuid contact_id
    string email
    string destination
    string status
  }

  ChannelSendingProfile {
    uuid id PK
    uuid tenant_id
    string channel
    enum status
  }

  EmailOrgProfile {
    uuid id PK
    uuid tenant_id UK
    string legal_name
  }

  EmailSender {
    uuid id PK
    uuid tenant_id
    string from_email
    boolean is_active
    string status
  }

  EmailDomain {
    uuid id PK
    uuid tenant_id
    string domain
    boolean spf_ok
    boolean dkim_ok
    boolean dmarc_ok
    string provider_domain_id
  }

  EmailReturnPath {
    uuid id PK
    uuid tenant_id UK
    string domain
    string status
  }

  EmailSendingCaps {
    uuid id PK
    uuid tenant_id UK
    int batch_size
    int hourly_cap
    int daily_cap
    string health_status
  }

  EmailSuppression {
    uuid id PK
    uuid tenant_id
    string email
    string reason
  }

  PushChannelSettings {
    uuid id PK
    uuid tenant_id
    string channel
    jsonb settings
  }

  PushEndpoint {
    uuid id PK
    uuid tenant_id
    uuid contact_id
    string channel
    string endpoint
    boolean active
  }

  SmsChannelSettings {
    uuid id PK
    uuid tenant_id UK
    jsonb settings
    string status
  }

  RegulatedChannelTemplate {
    uuid id PK
    uuid tenant_id
    string channel
    string name
    enum status
    uuid source_campaign_id
  }

  CampaignContactEngagement {
    uuid id PK
    uuid tenant_id
    uuid contact_id
    boolean email_unsubscribed
    int email_open_count
    int email_click_count
  }
```

## Files in this folder

| File | Contents |
|------|----------|
| [campaign_tables.csv](campaign_tables.csv) | All tables — name, model, description, PK, notes |
| [campaign_columns.csv](campaign_columns.csv) | All columns — type, nullable, default, description |
| [campaign_er_diagram.md](campaign_er_diagram.md) | This ER diagram (Mermaid) |
| [campaign_er_diagram.png](campaign_er_diagram.png) | Visual ER overview image |
