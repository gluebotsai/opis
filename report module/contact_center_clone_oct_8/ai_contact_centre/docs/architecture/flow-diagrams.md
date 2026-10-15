# Omnichannel Flow Diagrams

Source-cited entry points:
- Webchat: `apps/chat-service/src/services/webchat-orchestrator.ts`, `apps/cc-core/src/services/conversations.ts`
- Email: `apps/chat-service/src/email/email-orchestrator.ts`, `apps/cc-core/src/services/email-conversations.ts`
- WhatsApp: `apps/social-service/src/services/inbound-handler.ts`, `apps/cc-core/src/services/social-conversations.ts`

## Webchat

```mermaid
flowchart TD
    WebVisitor[Website Visitor] --> Widget[Webchat Widget]
    Widget -->|"session.start / message"| WebSocket["chat-service WebSocket<br/>webchat-ws-gateway.ts"]
    WebSocket --> WebPolicy["cc-core: resolveChannelPolicy<br/>setup_webchat_configs + channel_automation_policies"]
    WebPolicy --> WebConversation["cc-core: startConversation<br/>INSERT ccass.conversations"]
    WebConversation --> WebBot{Bot Enabled}
    WebBot -->|No| WebQueue["cc-core: status=queued<br/>lifecycle=waiting"]
    WebBot -->|Yes| WebPersist["cc-core: appendConversationMessage<br/>INSERT conversation_messages"]
    WebPersist --> WebNLP["nlp: POST /api/v1/webchat/turn<br/>nlp_conversations + nlp_turns"]
    WebNLP --> WebGuard{Valid Reply and Confidence Pass}
    WebGuard -->|Yes| WebBotReply["cc-core: persist bot message + NLP turn<br/>BEFORE delivery"]
    WebBotReply --> WebDeliver["chat-service: WebSocket to widget"]
    WebGuard -->|"No / Human / Provider Failure"| WebQueue
    WebQueue --> WebRoute["cc-core: routeConversationToAgent<br/>routing_attempts + capacity"]
    WebRoute --> WebAvailable{Agent Available}
    WebAvailable -->|No| WebFallback["Approved waiting message<br/>no_agent_behavior from policy"]
    WebAvailable -->|Yes| WebOffer["cc-core: status=assigned<br/>workspace Socket.IO offer"]
    WebOffer --> WebOfferResult{Accept, Reject, or Timeout}
    WebOfferResult -->|Reject or Timeout| WebRoute
    WebOfferResult -->|Accept| WebActive["cc-core: status=active<br/>lifecycle=connected"]
    WebActive --> WebAgentReply["Agent reply via workspace"]
    WebAgentReply --> WebAgentDelivery["cc-core → chat-service → widget"]
    WebAgentDelivery --> WebClose["endConversation + disposition<br/>CDP projection"]
    WebDeliver --> WebNext{Continue or Escalate}
    WebNext -->|Continue| WebPersist
    WebNext -->|Escalate| WebQueue
```

**DB writes per happy path:** `conversations`, `conversation_messages` (customer + bot), `nlp_conversations`, `nlp_turns`, `conversation_memory`.

## Email

```mermaid
flowchart TD
    EmailCustomer[Email Customer] --> Gmail[Gmail Mailbox]
    Gmail --> PubSub[Gmail Watch and PubSub]
    PubSub --> EmailProcessor["chat-service: inbound processor"]
    EmailProcessor --> EmailDedupe["cc-core: email_provider_events<br/>dedupe by provider ID"]
    EmailDedupe --> EmailPolicy["cc-core: resolveEmailMailboxPolicy<br/>email_mailbox_policies + setup fallback"]
    EmailPolicy --> EmailConversation["cc-core: ingestInboundEmailConversation<br/>INSERT conversations"]
    EmailConversation --> EmailBot{Bot Enabled and Auto-send}
    EmailBot -->|No| EmailQueue["status=queued"]
    EmailBot -->|Yes| EmailNLP["nlp: POST /api/v1/email/turn"]
    EmailNLP --> EmailGuard{Grounded, Guarded, Confidence Pass}
    EmailGuard -->|Yes| EmailCommit["cc-core: commitEmailBotDecision<br/>email_delivery_outbox"]
    EmailCommit --> EmailBotSend["Gmail send via outbox worker"]
    EmailGuard -->|"No / Human / Provider Failure"| EmailQueue
    EmailQueue --> EmailRoute["cc-core: routeConversationToAgent"]
    EmailRoute --> EmailAvailable{Agent Available}
    EmailAvailable -->|No| EmailWaiting["Remain queued<br/>approved_service_message"]
    EmailAvailable -->|Yes| EmailOffer["status=assigned"]
    EmailOffer --> EmailOfferResult{Accept, Reject, or Timeout}
    EmailOfferResult -->|Reject or Timeout| EmailRoute
    EmailOfferResult -->|Accept| EmailActive["status=active"]
    EmailActive --> EmailAgentReply["Agent reply with RFC headers"]
    EmailAgentReply --> EmailOutbox["email_delivery_outbox"]
    EmailOutbox --> EmailDelivery[Gmail Delivery]
    EmailDelivery --> EmailClose["resolve + disposition + CDP"]
    EmailBotSend --> EmailFollowup{New Customer Email}
    EmailFollowup -->|Open Session| EmailConversation
    EmailFollowup -->|After Close| EmailNewSession["New linked conversation"]
```

## WhatsApp

```mermaid
flowchart TD
    WaCustomer[WhatsApp Customer] --> Meta[Meta WhatsApp Cloud API]
    Meta --> WaWebhook["social-service: signed webhook<br/>inbound-handler.ts"]
    WaWebhook --> WaCredential["Resolve channel credentials<br/>setup_social_configs"]
    WaCredential --> WaNormalize["Normalize and deduplicate<br/>external_message_id"]
    WaNormalize --> WaPolicy["cc-core: getWhatsAppChannelPolicy<br/>whatsapp_channel_policies"]
    WaPolicy --> WaConversation["cc-core: ingestInboundSocialConversation<br/>INSERT conversations"]
    WaConversation --> WaBot{Bot Enabled}
    WaBot -->|No| WaQueue["status=queued"]
    WaBot -->|Yes| WaNLP["nlp: POST /api/v1/whatsapp/turn"]
    WaNLP --> WaGuard{Valid Reply and Policy Threshold Pass}
    WaGuard -->|Yes| WaPersist["cc-core: persist reply BEFORE Meta send<br/>nlp_turns + conversation_messages"]
    WaPersist --> WaSend["social-service: Meta API outbound"]
    WaGuard -->|"No / Human / Provider Failure"| WaQueue
    WaQueue --> WaRoute["cc-core: routeConversationToAgent"]
    WaRoute --> WaAvailable{Agent Available}
    WaAvailable -->|No| WaWaiting["approved_handoff_message"]
    WaAvailable -->|Yes| WaOffer["status=assigned"]
    WaOffer --> WaOfferResult{Accept, Reject, or Timeout}
    WaOfferResult -->|Reject or Timeout| WaRoute
    WaOfferResult -->|Accept| WaActive["status=active"]
    WaActive --> WaAgentReply["Agent reply"]
    WaAgentReply --> WaDelivery["cc-core → social-service → Meta"]
    WaDelivery --> WaReceipt["Persist Meta wamid + delivery status"]
    WaReceipt --> WaClose["Inactivity close + disposition + CDP"]
    WaSend --> WaNext{Continue or Escalate}
    WaNext -->|Continue| WaNormalize
    WaNext -->|Escalate| WaQueue
```

## Combined Omnichannel

```mermaid
flowchart TB
    subgraph adapters [Channel Adapters]
        WebAdapter["chat-service WebSocket"]
        EmailAdapter["chat-service Gmail/PubSub"]
        WaAdapter["social-service Meta Webhook"]
    end

    subgraph shared [Shared Control Plane - cc-core]
        Config[Channel Configuration]
        TenantBoundary[Tenant Authentication]
        Policy["channel_automation_policies<br/>+ channel-specific resolvers"]
        Conversation["ccass.conversations<br/>conversation_messages"]
        SessionContext["conversation_memory<br/>nlp_conversations"]
        NLPDecision["nlp service<br/>grounding + knowledge"]
        IntentEngine[Canonical Intent Registry]
        DecisionGate{Bot Reply or Live Agent}
        Routing["routing.ts<br/>capacity + offers"]
        Workspace["Socket.IO workspace events"]
        Disposition["dispositions + SLA"]
        CDP["cdp.interactions<br/>contact_identities"]
    end

    subgraph delivery [Channel Delivery]
        WebOutbound[WebSocket Delivery]
        EmailOutbound[email_delivery_outbox]
        WaOutbound[Meta WhatsApp API]
    end

    WebAdapter --> Config
    EmailAdapter --> Config
    WaAdapter --> Config
    Config --> TenantBoundary
    TenantBoundary --> Policy
    Policy --> Conversation
    Conversation --> SessionContext
    SessionContext --> NLPDecision
    NLPDecision --> IntentEngine
    IntentEngine --> DecisionGate
    DecisionGate -->|Bot Reply| ChannelDelivery{Select Channel}
    ChannelDelivery -->|Webchat| WebOutbound
    ChannelDelivery -->|Email| EmailOutbound
    ChannelDelivery -->|WhatsApp| WaOutbound
    DecisionGate -->|Escalate| Routing
    Routing --> Workspace
    Workspace --> AgentDelivery{Agent Reply Channel}
    AgentDelivery -->|Webchat| WebOutbound
    AgentDelivery -->|Email| EmailOutbound
    AgentDelivery -->|WhatsApp| WaOutbound
    WebOutbound --> Conversation
    EmailOutbound --> Conversation
    WaOutbound --> Conversation
    Conversation --> Disposition
    Conversation --> CDP
    Disposition --> CDP
```
