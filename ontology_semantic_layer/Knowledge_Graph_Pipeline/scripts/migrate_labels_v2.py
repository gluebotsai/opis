import argparse
from neo4j import GraphDatabase
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("migrate_labels")

# V1 to V2 label renames
RENAMES = {
    "Contact": "Customer",
    "CustomerEvent": "BehaviourEvent",
    "CustomerSession": "Visit",
    "CustomerInteraction": "Touchpoint",
    "CustomerJourney": "JourneyStep",
    "CustomerJourneyState": "JourneyPosition",
    "CustomerScore": "CustomerScorecard",
    "CustomerMetricSummary": "CustomerValueSummary",
    "CustomerMetric": "DailyEngagementMetric",
    "CustomerCampaignMetric": "PerformanceMetric",
    "CustomerRecommendation": "NextBestAction",
    "Segment": "AudienceSegment",
    "PersonaDefinition": "Persona",
    "PersonaSnapshot": "PersonaEvidence",
    "EpisodicMemory": "ExperienceMemory",
    "SemanticMemory": "KnownFact",
    "ProceduralMemory": "EngagementRule",
    "ActivationTask": "ActivationSignal",
    "AnomalyRule": "AnomalyDetector",
    "AnomalyAlert": "AnomalySignal",
    "AnomalyThresholdState": "AdaptiveThreshold",
    "AgenticModel": "PredictiveModel",
    "SourceSystem": "DataSource",
    "CustomerOrder": "Purchase",
    
    "User": "Employee",
    "Role": "AccessRole",
    "HolidayCalendar": "HolidaySchedule",
    "Holiday": "NonWorkingDay",
    "BusinessHours": "OperatingSchedule",
    "BusinessHourShift": "ScheduleShift",
    "ChannelConfig": "ChannelAccount",
    "SetupQueue": "QueueDefinition",
    "VoiceDid": "VoiceNumber",
    "KnowledgeOrgProfile": "ExtractedBusinessProfile",
    
    "Agent": "StaffRole",
    "AgentCapacity": "ChannelCapacity",
    "AgentPresence": "AgentAvailability",
    "PresenceReasonCode": "PresenceReason",
    "Queue": "ServiceQueue",
    "RoutingPolicy": "DistributionPolicy",
    "ChannelAutomationPolicy": "AutomationPolicy",
    "SlaPolicy": "ServiceLevelPolicy",
    "Disposition": "OutcomeCode",
    
    "ConversationMemory": "ConversationDigest",
    "ConversationSlaState": "ServiceLevelClock",
    "ConversationDisposition": "OutcomeRecord",
    "ConversationMessageAttachment": "MediaAttachment",
    "ConversationNote": "InternalNote",
    "ConversationParticipant": "ParticipantRecord",
    "ConversationAssignment": "WorkAssignment",
    "ConversationTransfer": "WorkTransfer",
    "RoutingAttempt": "DistributionAttempt",
    "WebchatSession": "ChatSession",
    "AgentMissedContact": "MissedEngagement",
    "AgentTask": "WorkTask",
    
    "NlpSkill": "BotSkill",
    "NlpSkillVersion": "BotSkillVersion",
    "NlpSkillBinding": "BotSkillBinding",
    "NlpSkillTool": "BotTool",
    "NlpConversation": "BotSession",
    
    "ProductOffer": "OfferingPlan",
    "ProductAddon": "OfferingAddOn",
    "ProductAddonTier": "PricingTier",
    "PriceBook": "PriceList",
    "PriceBookEntry": "PriceListEntry",
    "CrmOrganizationProfile": "VerticalProfile",
    "Company": "Account",
    "CompanyLocation": "AccountSite",
    "CrmContactProfile": "SalesProfile",
    "Deal": "Opportunity",
    "DealActivity": "OpportunityActivity",
    "ContactActivity": "EngagementActivity",
    "Appointment": "Meeting",
    "ProposalTemplate": "DocumentTemplate",
    "QuoteLine": "LineItem",
    "ContractBillingSchedule": "BillingSchedule",
    "OrgAssignmentSettings": "AssignmentPolicy",
    "SalesUserAssignmentProfile": "RepCapacityProfile",
    "LeadEnrichmentSnapshot": "EnrichmentSnapshot",
    "LeadSummary": "LeadBrief",
    "MeetingAssistSession": "LiveMeetingSession",
    "MeetingTranscriptChunk": "TranscriptSegment",
    "MeetingAnalysis": "MeetingOutcome",
    "CoachingInsight": "CoachingNote",
    "ProcessConfirmation": "ActionApproval",
    "AgentMemory": "AgentMemorySlot",
    "CrmNotification": "Notification",
    
    "TicketingOrgSettings": "SupportPortalSettings",
    "TicketingContactProfile": "SupportProfile",
    "TicketingAccount": "SupportAccount",
    "TicketingQueue": "SupportQueue",
    "Ticket": "SupportCase",
    "TicketStatus": "CaseStatus",
    "TicketNote": "CaseNote",
    "KbArticle": "KnowledgeArticle",
    "TicketingMacro": "CannedReply",
    "TicketingAutomationRule": "WorkflowRule",
    "TicketingDashboardMetric": "SupportSnapshot",
    "TicketAuditEvent": "AuditRecord",
    "EmailMessageRef": "EmailThreadRef",
    "OutboundEmailLog": "EmailDispatchRecord",
    "TicketConversationContext": "InteractionSummary",
    "WorkflowEvent": "AssistantWorkflowEvent",
    "ProactiveOutbox": "ProactiveSuggestion",
    "ProactiveRecommendation": "ProactiveDecision",
    "ProactiveApproval": "ApprovalRequest",
    "ProactiveAudit": "SupportSignal",
    "ProactiveRoutingWeight": "RoutingWeightModel",
    
    "Branch": "BusinessUnit",
    "CampaignOrgProduct": "ModuleEntitlement",
    "CampaignChannel": "CampaignChannelPlan",
    "CampaignAgentSession": "CampaignDraft",
    "CampaignChannelTemplate": "MessageTemplate",
    "CampaignTemplateMessage": "TemplateRevision",
    "RegulatedChannelTemplate": "ApprovedTemplate",
    "ChannelSendingProfile": "SendingReadiness",
    "PushChannelSetting": "ChannelSendingConfig",
    "EmailOrgProfile": "SenderComplianceProfile",
    "EmailSender": "SenderAddress",
    "EmailDomain": "SendingDomain",
    "EmailReturnPath": "BounceDomain",
    "EmailSendingCap": "SendingLimit",
    "EmailSuppression": "SuppressedAddress",
    "CampaignSendBatch": "SendBatch",
    "CampaignSendRecipient": "MessageDelivery",
    "PushEndpoint": "PushSubscription",
    "WebsiteContact": "WebVisitor",
    "CampaignContactEngagement": "OutreachEngagement",
    "TenantIndustryPack": "IndustryPack",
    "CampaignRecommendation": "CampaignIdea",
    "Product": "Offering"
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="Actually run the rename")
    parser.add_argument("--reverse", action="store_true", help="V2 to V1")
    parser.add_argument("--uri", default="bolt://localhost:7687")
    parser.add_argument("--user", default="neo4j")
    parser.add_argument("--password", default="India@321")
    args = parser.parse_args()

    driver = GraphDatabase.driver(args.uri, auth=(args.user, args.password))
    
    mapping = RENAMES
    if args.reverse:
        mapping = {v: k for k, v in mapping.items()}
        
    with driver.session(database="system") as s:
        dbs = [r["name"] for r in s.run("SHOW DATABASES YIELD name WHERE name STARTS WITH 'org' RETURN name")]
        
    for db in dbs:
        log.info(f"Processing database {db}...")
        with driver.session(database=db) as s:
            for old_lbl, new_lbl in mapping.items():
                if args.execute:
                    res = s.run(f"""
                        MATCH (n:`{old_lbl}`)
                        WITH n LIMIT 10000
                        SET n:`{new_lbl}`
                        REMOVE n:`{old_lbl}`
                        RETURN count(n) as c
                    """)
                    count = res.single()["c"]
                    if count > 0:
                        log.info(f"  {db}: Renamed {count} '{old_lbl}' to '{new_lbl}'")
                else:
                    res = s.run(f"MATCH (n:`{old_lbl}`) RETURN count(n) as c")
                    count = res.single()["c"]
                    if count > 0:
                        log.info(f"  {db}: [DRY RUN] Would rename {count} '{old_lbl}' to '{new_lbl}'")
                        
if __name__ == "__main__":
    main()
