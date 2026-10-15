# Template generation director — design guide

**Status:** Production v1 implemented (layered brief, industry policy profile,
style planning, channel writing, deterministic validation, creative review,
targeted retry, semantic email rendering, and Meta-safe WhatsApp presets).
**Primary agent:** `template_generation_director`  
**Supporting policy layer:** deterministic company/industry/Meta rules. A
versioned external regulatory evidence store remains a future extension.

Implementation entry points:

- `agents/app/agents/template_generation_director/`
- `agents/app/agents/template_library/creation_agent.py`
- `backend/src/helpers/email-render.ts`
- `frontend/src/components/campaigns/ChannelTemplatePreview.tsx`

This guide defines template **generation and regeneration**. It deliberately does
not define campaign launch, scheduling, quiet hours, send workers, monitoring, or
the template-edit chat. Those responsibilities stay with their existing owners.

External web/trend search is also deferred from the first implementation. The
Director may receive research tools later, but this design must work using
verified internal information and the editable policy store alone.

---

## 1. Why this agent is needed

The current template pipeline is copy-first:

- email fields are a greeting, `paragraphs[]`, one CTA, sign-off, and footer;
- the email prompt asks for 2–4 paragraphs and one CTA;
- preview and send rendering place those fields in a fixed vertical stack;
- regeneration asks the model to keep the previous structure and CTA pattern.

As a result, campaign wording changes while the creative structure often remains
the same. The new Director must decide **why a structure is appropriate before
writing the copy**. Paragraph count, CTA presence, CTA position, images, proof,
and content hierarchy must follow the user idea and campaign purpose rather than
a fixed ad pattern.

---

## 2. Ownership and boundaries

### The Director owns

- First-time template generation after strategy, audience, and channels exist.
- Full template regeneration when the user rejects the current creative.
- Translation of the user's idea into explicit creative requirements.
- Selection of a message archetype and channel-specific design plan.
- Coordination of existing channel writers.
- User-alignment, factual, creative, accessibility, and content-policy review.
- Returning templates with an auditable generation report.

### The Director does not own

- The create-campaign conversation.
- Campaign naming, audience filtering, or channel selection.
- Template edit chat or small in-place edits.
- Recipient consent and suppression checks at launch.
- Schedule recommendations, quiet hours, or send-window calculations.
- Launch, send workers, retries, delivery, or monitoring.
- Automatic publication or launch.

`create_campaign` remains the user-facing strategist. `on_demand` remains the
owner of one-off contact resolution and launch. Both delegate only their
template-generation step to this Director.

---

## 3. Placement

Target folders:

```text
agents/app/agents/
  template_generation_director/
    __init__.py
    agent.py
    prompts.py
    schemas.py
    workflow.py
    tools/
      schemas.py
      handlers.py
    validators/
      alignment.py
      claims.py
      creative.py
      accessibility.py

  template_regulatory_advisor/
    __init__.py
    agent.py
    prompts.py
    schemas.py
    tools/
      handlers.py

  template_library/
    channels/                 # existing channel writers remain here initially
```

The Director replaces the direct orchestration role of
`template_library.run_creation_agent`; it can reuse existing email, WhatsApp,
SMS, push, web, and PPC channel agents while they are migrated to the new input
contracts.

---

## 4. Call sites

### Create-campaign

```text
create_campaign
  → build_campaign(user_confirmed=true)
  → _generate_and_persist_templates
  → template_generation_director
  → existing template batch persistence
  → create_campaign resumes
```

The existing confirmation and strategy gates remain. The Director is not exposed
as a second user-facing chat agent.

### On-demand

```text
on_demand
  → analyse operator instruction
  → resolve campaign/audience context
  → template_generation_director
  → validate generation result
  → existing on-demand launch flow
```

The operator instruction remains internal context and must never be copied as
recipient-facing content.

### Regeneration

Regeneration invokes the Director with the prior templates and the user's reason
for rejection. The Director decides which constraints should be preserved and
which creative decisions should change. It must not automatically preserve the
old structure or CTA pattern.

---

## 5. Input contract

The caller provides known state; the Director does not re-run campaign intake.

```json
{
  "mode": "create",
  "session_id": "9000000000000000042",
  "organization_id": "1000",
  "branch_id": "1000",
  "campaign": {
    "name": "Internal campaign label",
    "goal": "Drive webinar registrations",
    "objective": "Register retail business owners",
    "industry": "retail",
    "source_channel": "standalone_campaign"
  },
  "audience": {
    "description": "Retail business owners in India",
    "matched_count": 1200,
    "countries": ["IN"],
    "languages": ["en"]
  },
  "channels": ["email", "whatsapp"],
  "channel_plans": [],
  "user_request": "Keep it educational and avoid aggressive sales language.",
  "prior_templates": []
}
```

Required facts that are unavailable must be reported. The Director must not
invent an offer, discount, event date, product capability, price, statistic, or
landing URL merely to complete a template.

---

## 6. Internal contracts

### 6.1 Creative brief

The Director first converts campaign state and the user's request into a stable
brief:

```json
{
  "core_idea": "Invite business owners to an automation webinar",
  "campaign_intent": "event_invitation",
  "funnel_stage": "consideration",
  "audience_state": "interested but not registered",
  "primary_message": "Learn practical automation techniques",
  "desired_action": "register",
  "tone": ["educational", "professional"],
  "must_include": ["learning outcomes", "event date"],
  "must_avoid": ["aggressive sales language", "unsupported claims"],
  "verified_facts": [],
  "missing_facts": []
}
```

User requirements are locked as constraints. Creative variation must not silently
remove them.

### 6.2 Regulatory decision

The `template_regulatory_advisor` returns content requirements, not send
permission:

```json
{
  "decision": "allowed_with_requirements",
  "jurisdictions": ["IN"],
  "policy_versions": ["IN-WHATSAPP-MARKETING-1"],
  "mandatory_content": ["identify the sender"],
  "prohibited_content": ["unsupported guaranteed outcome"],
  "channel_constraints": [],
  "warnings": [],
  "human_review_required": false,
  "evidence": []
}
```

Possible decisions:

- `allowed`
- `allowed_with_requirements`
- `needs_information`
- `needs_legal_review`
- `blocked`

The advisor must never describe an uncertain result as legally compliant.

### 6.3 Channel design plan

Each channel receives an explicit design decision:

```json
{
  "channel": "email",
  "archetype": "editorial_event_invitation",
  "reason": "The user wants an educational message for a consideration audience.",
  "content_flow": [
    "audience problem",
    "learning outcomes",
    "credibility",
    "registration action"
  ],
  "proof_strategy": "verified event and speaker facts",
  "cta": {
    "required": true,
    "intent": "register",
    "position": "after learning outcomes",
    "reason": "Registration is the requested measurable action."
  },
  "visual_direction": "editorial, restrained, information-led",
  "avoid_patterns": ["recently_used_pattern_id"]
}
```

The WhatsApp, SMS, push, web, and PPC plans adapt the same campaign idea to
channel-native behaviour. They are not shortened copies of the email.

---

## 7. Tool policy

Tools are capabilities, not a forced checklist. The Director chooses the tools
that materially improve the current request and stops when it has sufficient
verified context.

### Context and facts

- `get_campaign_context`
- `get_user_creative_intent`
- `get_audience_insights`
- `get_organization_profile`
- `get_brand_guidelines`
- `get_product_facts`
- `search_campaign_knowledge`

### Creative planning

- `get_recent_template_history`
- `get_template_pattern_library`
- `select_creative_direction`
- `compare_with_recent_templates`
- `create_channel_design_plan`

### Content-policy support

- `resolve_content_jurisdictions`
- `get_active_content_policy_bundle`
- `retrieve_policy_evidence`
- `validate_template_content_policy`
- `request_human_review`

### Generation and quality

- `generate_channel_template`
- `generate_image_brief`
- `generate_template_image`
- `validate_user_alignment`
- `fact_check_template`
- `validate_claims`
- `validate_channel_compliance`
- `validate_accessibility`
- `validate_spam_and_deliverability`
- `validate_links`
- `test_personalization`
- `render_template_preview`

Not every tool must be called for every generation. For example, an image tool is
unnecessary for an SMS template, and a fact lookup is unnecessary when the brief
contains no product claim. Tool selection belongs to the Director; hard
validation gates still apply to every result.

### Deferred web research

No DuckDuckGo, Brave, Tavily, or other external-search integration is required in
the first implementation. A provider-neutral `search_web_trends` capability may
be added later. If added, it remains discretionary and must never include contact
PII, copy third-party ads, or turn unverified search snippets into claims.

---

## 8. Design grammar

### Pattern library

Initial message archetypes:

- announcement
- event invitation
- problem → solution
- product spotlight
- educational/editorial
- testimonial/social proof
- comparison
- limited-time promotion
- re-engagement
- onboarding
- reminder
- story-led message

Patterns are tagged by channel, funnel stage, campaign intent, information
density, proof style, and valid CTA types. A pattern is a planning aid, not a
complete template to copy.

### Email sections

The target email contract uses ordered semantic sections:

```json
{
  "subject": "A verified, customer-facing subject",
  "preheader": "Optional supporting context",
  "pattern": "editorial_event_invitation",
  "sections": [
    {
      "type": "headline",
      "purpose": "Introduce the customer value",
      "content": "..."
    },
    {
      "type": "benefits",
      "purpose": "Explain what the attendee will learn",
      "items": ["...", "..."]
    },
    {
      "type": "proof",
      "purpose": "Establish credibility",
      "content": "..."
    },
    {
      "type": "cta",
      "intent": "register",
      "label": "Reserve your place",
      "url": "{{campaign_url}}"
    },
    {
      "type": "compliance_footer",
      "content": "..."
    }
  ]
}
```

Supported section types should initially include:

- headline
- text
- benefits
- product
- offer
- testimonial
- statistics
- event details
- image
- divider
- CTA
- secondary link
- sign-off
- compliance footer

CTA is optional unless the campaign intent requires an action. The design plan
must state the CTA's purpose, interface type, and position.

### Compatibility

The `fields` database column is JSON and can hold `sections`. Preview and
send-time rendering must use:

```text
sections present → section renderer
sections absent  → current greeting/paragraphs/CTA renderer
```

This permits old templates to remain valid during rollout. Preview and production
send rendering must share the same interpretation so the sent message matches
what the operator approved.

---

## 9. Editable content-policy knowledge

Policy decisions must not live only in an LLM prompt or vector index.

### Source of truth

Store structured, versioned records for:

- jurisdictions;
- official sources and source versions;
- content-policy rules;
- channel and industry applicability;
- effective and expiry dates;
- severity (`info`, `warn`, `review`, `block`);
- approval state and change history.

Workflow:

```text
draft → under_review → approved → active → superseded → archived
```

Editing an active rule creates a new version. Previous versions remain available
to explain historical generation decisions.

### Supporting vector retrieval

Vector search is for finding supporting passages and explanations. It is not the
allow/block engine and vectors are never manually edited.

```text
editable source/version
  → approval
  → chunk + embed
  → activate new vector chunks
  → deactivate superseded chunks
```

Every retrieved chunk must carry its source, jurisdiction, effective dates,
approval state, policy version, and official URL. Production retrieval uses only
approved active versions.

---

## 10. Generation workflow

```text
1. Validate caller input and preserve the user's exact constraints.
2. Build the CreativeBrief.
3. Select useful context/fact tools.
4. Ask the Regulatory Advisor for content requirements.
5. Read recent template history and select a justified design archetype.
6. Build one ChannelDesignPlan per selected channel.
7. Run channel writers, in parallel where independent.
8. Generate channel-specific media only where justified.
9. Run deterministic schema/channel checks.
10. Run user-alignment, factual, creative, accessibility, and policy critics.
11. Regenerate only failed dimensions with targeted feedback.
12. Render with the production renderer.
13. Return templates plus an auditable GenerationReport.
```

Latency is not a design constraint for this workflow. Work may use multiple
reasoning and review passes, but loops remain bounded and every retry has a
specific failed criterion.

---

## 11. Validation gates

### Mandatory for every template

- Complete and renderable channel schema.
- User idea and explicit requirements preserved.
- No unsupported product, price, event, statistic, or outcome claims.
- No unresolved required fact.
- Applicable content-policy checks passed or review requested.
- Valid merge tags and URLs.
- Channel/provider limits respected.
- Accessibility checks appropriate to the channel.

### Creative quality

- Chosen structure is justified by campaign intent and audience state.
- Every section has a purpose.
- CTA is justified rather than inserted by default.
- Channel outputs are adapted, not duplicated.
- Structural similarity to recent templates is measured.
- Regeneration materially addresses the user's rejection.

Hard validation determines readiness; the writer cannot mark its own output
ready merely because generation succeeded.

---

## 12. Output and statuses

```json
{
  "ok": true,
  "generation_batch_id": "uuid",
  "creative_brief": {},
  "design_plans": [],
  "templates": [],
  "generation_report": {
    "facts_used": [],
    "policy_versions": [],
    "validation": {
      "schema": "pass",
      "user_alignment": "pass",
      "claims": "pass",
      "content_policy": "pass",
      "accessibility": "pass",
      "creative": "pass",
      "render": "pass"
    },
    "warnings": [],
    "human_review_required": false
  },
  "status": "ready"
}
```

Generation statuses:

- `draft`
- `needs_information`
- `validation_failed`
- `needs_legal_review`
- `ready`

`ready` means the generated content passed generation-time checks. It does not
mean every recipient is eligible or that the campaign may be sent at the current
time.

---

## 13. Persistence and audit

Continue storing channel content in `campaign_channel_templates.fields`. Add or
attach generation metadata sufficient to reproduce the decision:

- Director version and model;
- creative brief;
- selected design pattern and reason;
- prior-template comparison;
- facts used;
- applicable content-policy versions;
- validator results and warnings;
- generation timestamp;
- source create/regenerate/on-demand.

Large source documents and embeddings do not belong inside template `fields`.
Store references to their approved versions.

---

## 14. Failure behaviour

- Missing essential fact → `needs_information`; never invent it.
- Unknown/uncertain policy → `needs_legal_review`.
- Prohibited content → `blocked` advisor decision and no `ready` template.
- One channel fails → return channel-specific errors; caller decides whether a
  partial set is acceptable. On-demand must keep its stricter required-channel
  checks.
- Renderer fails → `validation_failed`; do not persist as ready.
- Advisor unavailable → do not claim compliance. Return draft/review status.
- No usable design difference on regeneration → fail the creative gate and retry
  with a different archetype.

Do not fall back to generic recipient-facing stub copy and describe it as a
successful template.

---

## 15. Rollout order

1. Finalize schemas and tool contracts.
2. Add optional section rendering with legacy fallback.
3. Align frontend preview and backend send rendering.
4. Add pattern library and recent-template comparison.
5. Add editable policy source/rule/version storage.
6. Build `template_regulatory_advisor`.
7. Build `template_generation_director` over existing channel writers.
8. Integrate create-campaign behind a feature flag.
9. Run shadow generation and compare old/new outputs without sending.
10. Roll out normal create-campaign generation.
11. Roll out on-demand only after its block/review behaviour is verified.

Suggested flag:

```text
TEMPLATE_GENERATION_DIRECTOR_ENABLED
```

---

## 16. Acceptance criteria

- A campaign can produce multiple justified email structures, not only
  greeting → paragraphs → CTA.
- CTA may be omitted or repositioned when the design plan supports that choice.
- User must-include and must-avoid requirements survive every generation pass.
- Product and campaign facts are traceable and unsupported claims are rejected.
- Channel outputs share one campaign idea but use channel-native structure.
- Regeneration can replace the previous structure rather than preserving it.
- Applicable content-policy version and evidence references are recorded.
- Uncertainty produces review status, not a false compliance claim.
- Existing flat-field templates continue to preview and send.
- Preview and production rendering produce equivalent content hierarchy.
- Create-campaign and on-demand use the same Director contract.

---

## 17. Deferred guides

A separate **time and launch guide** will define:

- recipient timezones;
- quiet hours and permitted send windows;
- promotional versus transactional timing;
- multi-country audience scheduling;
- launch-time consent/suppression checks;
- policy changes between generation and launch;
- on-demand “send now” behaviour.

Those rules must consume the template's channel, campaign type, policy references,
and readiness status without silently rewriting the approved template.
