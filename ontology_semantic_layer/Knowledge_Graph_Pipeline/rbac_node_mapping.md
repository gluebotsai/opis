# RBAC Domain & Node Mapping

This document outlines exactly which Neo4j nodes (Labels) belong to which product domain. This is the foundation for your Fine-Grained Access Control (FGAC) rules. When Product Designers are deciding who gets access to what, they can use this list to understand the underlying ontology.

## 🛡️ The `common` Domain (Identity & Core Spines)
> **Rule of Thumb:** These nodes are the "spine" of the graph. Almost every user role (regardless of whether they are CRM, Ticketing, or CDP) will need `read` access to the `common` domain to see who owns a record, who the customer is, or which Tenant they belong to.

- `BusinessHourShift`
- `BusinessHours`
- `ChannelConfig`
- `Contact`
- `EmailChannelConfig`
- `Holiday`
- `HolidayCalendar`
- `KnowledgeDocument`
- `KnowledgeOrgProfile`
- `Product`
- `Role`
- `SetupQueue`
- `SetupQueueRoutingProfile`
- `SocialChannelConfig`
- `Team`
- `Tenant`
- `TicketAgent`
- `User`
- `VoiceDid`
- `VoicePromptProfile`
- `WebchatChannelConfig`


## 📦 The `crm` Domain
> **Rule of Thumb:** Access to these nodes should be strictly gated to users who have `crm` module permissions in their PostgreSQL role.

- `Addon`
- `AddonTier`
- `AgentMemory`
- `Appointment`
- `AssignmentProfile`
- `AssignmentSettings`
- `BillingSchedule`
- `CoachingInsight`
- `Company`
- `CompanySite`
- `ContactActivity`
- `ContactProfile`
- `Contract`
- `Deal`
- `DealActivity`
- `Invoice`
- `InvoiceLine`
- `InvoiceTemplate`
- `LeadEnrichmentJob`
- `LeadEnrichmentSnapshot`
- `LeadLifecycleJob`
- `LeadNurtureJob`
- `LeadScoringJob`
- `LeadSummary`
- `MeetingAnalysis`
- `MeetingAssistSession`
- `MeetingTranscriptChunk`
- `Notification`
- `OrderLine`
- `OrgProfile`
- `PriceBook`
- `PriceBookEntry`
- `PrivacyRequest`
- `ProcessConfirmation`
- `ProductOffer`
- `Proposal`
- `ProposalTemplate`
- `Quote`
- `QuoteLine`
- `QuoteTemplate`
- `SalesOrder`


## 📦 The `ticketing` Domain
> **Rule of Thumb:** Access to these nodes should be strictly gated to users who have `ticketing` module permissions in their PostgreSQL role.

- `AuditEvent`
- `AutomationRule`
- `ClientAccount`
- `DashboardMetrics`
- `InboundEmailRef`
- `KnowledgeArticle`
- `OrgSettings`
- `OutboundEmail`
- `ProactiveApproval`
- `ProactiveAudit`
- `ProactiveEvent`
- `ProactiveRecommendation`
- `ProactiveRoutingWeights`
- `ReplyTemplate`
- `SupportProfile`
- `Ticket`
- `TicketNote`
- `TicketNotification`
- `TicketQueue`
- `TicketSLA`
- `TicketStatus`
- `WorkflowEvent`


## 📦 The `ccaas` Domain
> **Rule of Thumb:** Access to these nodes should be strictly gated to users who have `ccaas` module permissions in their PostgreSQL role.

- `Agent`
- `AgentCapacity`
- `AgentPresence`
- `Assignment`
- `Attachment`
- `ChannelAutomationPolicy`
- `Conversation`
- `ConversationParticipant`
- `ConversationSummary`
- `Disposition`
- `DispositionEvent`
- `EmailMailboxPolicy`
- `Interaction`
- `MissedContact`
- `NlpConversation`
- `NlpSkill`
- `NlpSkillBinding`
- `NlpSkillTool`
- `NlpSkillVersion`
- `PresenceReasonCode`
- `Queue`
- `QueueRoutingProfile`
- `RoutingAttempt`
- `RoutingPolicy`
- `SLA`
- `SLAInstance`
- `SharedNote`
- `Skill`
- `Task`
- `Transfer`
- `WebchatSession`
- `WhatsAppChannelPolicy`
- `WorkNote`
- `WorkflowSession`


## 📦 The `campaign` Domain
> **Rule of Thumb:** Access to these nodes should be strictly gated to users who have `campaign` module permissions in their PostgreSQL role.

- `Campaign`
- `CampaignAlert`
- `CampaignBranch`
- `CampaignChannel`
- `CampaignDelivery`
- `CampaignDraft`
- `CampaignEmailSender`
- `CampaignEngagement`
- `CampaignIdea`
- `CampaignSendBatch`
- `ChannelSendingProfile`
- `ChannelTemplate`
- `EmailComplianceProfile`
- `EmailDomain`
- `EmailReturnPath`
- `EmailSendingCaps`
- `EmailSuppression`
- `IndustryPack`
- `ProductEntitlement`
- `PushEndpoint`
- `PushSettings`
- `RegulatedTemplate`
- `SmsSettings`
- `TemplateMessage`
- `Visitor`


## 📦 The `cdp` Domain
> **Rule of Thumb:** Access to these nodes should be strictly gated to users who have `cdp` module permissions in their PostgreSQL role.

- `ActionRule`
- `ActivationTask`
- `AnomalyAlert`
- `AnomalyRule`
- `ChannelIdentity`
- `ContactPoint`
- `CustomerEvent`
- `CustomerMetric`
- `CustomerScore`
- `CustomerSession`
- `CustomerTouchpoint`
- `DailyMetric`
- `ExperienceMemory`
- `Insight`
- `JourneyEvent`
- `JourneyState`
- `KnownFact`
- `MetricThreshold`
- `Order`
- `OrgMetric`
- `Persona`
- `PersonaEvidence`
- `PredictiveModel`
- `Recommendation`
- `Segment`
- `SourceSystem`

