# SAMPLE SOURCE DOCUMENT
## Worktual Compliance Knowledge Layer

| Field | Value |
|---|---|
| Document ID | SRC-UK-CC-001 |
| Title | United Kingdom — Contact Centre Operations Compliance Source Pack |
| Country / Region | United Kingdom (GB / UK) |
| Industry | Contact Centre / Customer Service Operations |
| Worktual products in scope | AI Contact Center, CRM (support context), Campaign Management (outbound voice/email where relevant), Ticketing |
| Document type | Country + Industry source pack (BA prepared) |
| Language | English |
| Version | 1.0 |
| Prepared by | BA Team (sample) |
| Prepared date | 2026-09-01 |
| Reviewer required | Legal / Compliance (mandatory before activation) |
| Status | SAMPLE — for BA patterning only; not a legal opinion |

---

## 1. Purpose of this source pack

This sample shows Business Analysts how to prepare a source document for the Worktual Compliance Knowledge Layer for:

- **Country:** United Kingdom
- **Industry:** Contact Centre

It summarises obligations that typically affect Worktual Contact Center agents and tools (voice, chat, agent assist, outbound marketing calls, recording, suppression, and human handoff).

> **Important:** This is a working BA source pack based on publicly available ICO guidance. It is not legal advice. Legal/Compliance must approve every obligation before it becomes an active rule in Worktual.

---

## 2. Authoritative sources used

| # | Source | Publisher | Why relevant | URL / reference |
|---|---|---|---|---|
| 1 | Telephone marketing (PECR guide) | ICO | Live and automated marketing call rules, TPS/CTPS | https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/telephone-marketing/ |
| 2 | Sending direct marketing: choosing lawful basis | ICO | PECR vs UK GDPR lawful basis for phone/email/SMS | https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/sending-direct-marketing-choosing-your-lawful-basis/ |
| 3 | Legitimate interests guidance | ICO | Lawful basis example for helpline call recording used for training | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/what-is-the-legitimate-interests-basis/ |
| 4 | Direct marketing guidance (UK GDPR + PECR overview) | ICO | Broader marketing and privacy context | https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/about-this-guidance/ |
| 5 | Enterprise Contact Centre Privacy / Recording Policy | Enterprise (placeholder) | Stricter internal rules, retention, disclosure scripts | *Attach enterprise PDF* |

### Source discipline notes for BAs

- Prefer **ICO / legislation** for country rules.
- Prefer **enterprise policy** for stricter internal controls.
- Record the **access date** and **guidance version note** (ICO may mark pages as under review).
- Do **not** mix UK GDPR and EU GDPR as one policy.

---

## 3. Scope definition

### 3.1 In scope

| Item | Detail |
|---|---|
| Channels | Voice inbound, voice outbound (live and automated), webchat, email support, agent assist |
| Data types | Customer identity, contact details, call recordings, transcripts, agent notes, disposition, queue data |
| Roles | Contact Centre Super Agent, AI Support Agent, Agent Assist / Coworker, Interaction Closure, Audience/Campaign outbound calling |
| Actions | Answer service queries, record/monitor calls, hand off to human, create tickets, make marketing calls, suppress contacts, store interaction history |

### 3.2 Out of scope (separate source packs needed)

- Financial advice / FCA product sales scripts (if regulated advice)
- Healthcare special-category deep packs
- India DPDP / TRAI packs
- EU GDPR packs for EU data subjects

### 3.3 Applicability context (do not use country alone)

A UK Contact Centre rule may apply when **any** of the following is true (Legal to confirm for the tenant):

- Customer / data subject is in the UK
- Enterprise operates a UK contact centre
- Outbound campaign targets UK numbers
- Recording / transcript is processed under UK data protection law

---

## 4. Obligation inventory (BA structured extract)

Use one row per obligation. Map each to Worktual agents and tools.

### A. Transparency and call recording

| Obligation ID | Type | Obligation (plain English) | Condition | Severity | Worktual agent / action | Suggested verification | Source |
|---|---|---|---|---|---|---|---|
| UK-CC-REC-001 | Obligation | Inform callers that the call may be recorded and state the purpose early enough for them to understand | Voice call is recorded or monitored | Blocking | AI Support Agent, Interaction Operations, Agent Assist | Check recording disclosure played / logged before recording starts | ICO legitimate interests example + enterprise recording policy |
| UK-CC-REC-002 | Obligation | Document a lawful basis for recording (often legitimate interests for training/quality after LIA; or consent / legal obligation where applicable) | Call recording enabled | Blocking | Contact Center Super Agent / admin config | Require configured lawful_basis + LIA reference before enabling recording | ICO Legitimate Interests guidance |
| UK-CC-REC-003 | Obligation | Keep a Legitimate Interests Assessment (LIA) when relying on legitimate interests for training/quality recording | Lawful basis = legitimate interests | Approval | Compliance / admin workflow | Block activation if LIA reference missing | ICO Legitimate Interests guidance |
| UK-CC-REC-004 | Prohibition | Do not use recordings for a new purpose (for example marketing analytics) without a fresh lawful basis and transparency | Secondary use of recording/transcript | Blocking | Campaign / Analytics agents | Purpose check on recording reuse tools | UK GDPR purpose limitation (enterprise interpretation required) |
| UK-CC-REC-005 | Obligation | Apply enterprise retention and deletion rules to recordings and transcripts | Recording stored | Blocking | Retention / Lifecycle tools | Retention policy ID must be present | Enterprise policy |

### B. Outbound telephone marketing (PECR)

| Obligation ID | Type | Obligation (plain English) | Condition | Severity | Worktual agent / action | Suggested verification | Source |
|---|---|---|---|---|---|---|---|
| UK-CC-TEL-001 | Prohibition | Do not make live marketing calls to numbers on TPS/CTPS unless the person specifically consented to calls from this organisation | Outbound live marketing call | Blocking | Campaign / Outbound dialler / Audience agent | TPS/CTPS screen result must be PASS or specific consent evidence present | ICO Telephone marketing |
| UK-CC-TEL-002 | Obligation | Maintain and honour an organisation-specific “do not call” list | Any outbound marketing call | Blocking | Audience / Suppression tools | Suppression registry check | ICO Telephone marketing checklist |
| UK-CC-TEL-003 | Prohibition | Do not call anyone who previously objected to this organisation’s marketing calls | Prior objection exists | Blocking | Audience agent, Launch agent | Objection flag check | ICO Telephone marketing |
| UK-CC-TEL-004 | Obligation | Display calling line identity (CLI) / allow number to be shown | Outbound marketing call | Blocking | Dialler / Campaign delivery tool | CLI presentation must be enabled | ICO Telephone marketing |
| UK-CC-TEL-005 | Obligation | Identify the organisation making the call; if asked, provide address or Freephone contact | Live marketing call | Mixed | Voice agent scripts / AI Support outbound | Script / disclosure component required | ICO Telephone marketing |
| UK-CC-TEL-006 | Prohibition | Do not make automated marketing calls (recorded message) without specific consent for automated calls | Automated outbound marketing | Blocking | Campaign / Voicebot outbound | Consent type must include automated_calls | ICO Telephone marketing |
| UK-CC-TEL-007 | Prohibition | Do not use general marketing consent or live-call consent as sufficient for automated calls | Automated outbound marketing | Blocking | Consent verification tool | Consent scope validation | ICO Telephone marketing |
| UK-CC-TEL-008 | Prohibition | Do not make claims-management marketing calls without specific consent | Claims management marketing | Blocking | Campaign eligibility | Sector flag + consent check | ICO Telephone marketing |
| UK-CC-TEL-009 | Obligation | For pension-related marketing calls, meet PECR authorisation/relationship criteria and consent or strict existing-customer conditions | Pension scheme marketing | Approval + Blocking | Campaign eligibility | Specialist rule pack + approval | ICO Telephone marketing |

### C. Lawful basis alignment (UK GDPR + PECR)

| Obligation ID | Type | Obligation (plain English) | Condition | Severity | Worktual agent / action | Suggested verification | Source |
|---|---|---|---|---|---|---|---|
| UK-CC-LB-001 | Obligation | Where PECR requires consent for the communication method, treat consent as the practical UK GDPR lawful basis for that marketing use | Electronic / telephone marketing where PECR mandates consent | Blocking | Campaign Super Agent | Consent evidence required before send/call | ICO Sending direct marketing: lawful basis |
| UK-CC-LB-002 | Obligation | Where PECR does not require consent for live calls, document either consent or legitimate interests (with LIA) before calling | Live marketing call, number not TPS/CTPS restricted | Approval | Campaign / Compliance | Lawful basis field required | ICO Sending direct marketing: lawful basis |
| UK-CC-LB-003 | Obligation | Stop direct marketing immediately if the person objects (absolute right for direct marketing) | Marketing objection received | Blocking | Suppression / Interaction Closure / Campaign | Objection write + suppress | ICO Legitimate Interests / marketing rights |

### D. Inbound service / AI Contact Center operations

| Obligation ID | Type | Obligation (plain English) | Condition | Severity | Worktual agent / action | Suggested verification | Source |
|---|---|---|---|---|---|---|---|
| UK-CC-SVC-001 | Obligation | Use only permitted data for the stated service purpose | Customer support interaction | Blocking | AI Support Agent, Agent Assist | Purpose tag on tools | Enterprise + UK GDPR principles |
| UK-CC-SVC-002 | Obligation | Mask or minimise sensitive data in agent assist suggestions and transcripts where enterprise policy requires | Agent assist / transcript display | Mixed | Support Agent Coworker | Sensitive-data scanner | Enterprise policy |
| UK-CC-SVC-003 | Obligation | When customer requests a human agent, trigger live-agent handoff and stop automated containment loops | Explicit live-agent request | Blocking | AI Support / Handoff agent | Handoff tool called; no further bot deflection | Enterprise contact centre policy |
| UK-CC-SVC-004 | Obligation | Authenticate the customer before disclosing account-sensitive information | Identity-sensitive enquiry | Blocking | AI Support / Agent Assist | Auth step completed evidence | Enterprise policy |
| UK-CC-SVC-005 | Obligation | Record disposition / outcome accurately after interaction | Interaction closure | Approval-gated if AI suggests | Interaction Closure Agent | Agent confirmation before disposition write | Enterprise quality policy |

### E. Evidence and audit

| Obligation ID | Type | Obligation (plain English) | Condition | Severity | Worktual agent / action | Suggested verification | Source |
|---|---|---|---|---|---|---|---|
| UK-CC-AUD-001 | Evidence | Retain evidence of TPS/CTPS screening, consent, objection, disclosure, and approvals used for the action | Marketing call or recorded interaction | Blocking for high-risk actions | All governed tools | Decision audit store | Accountability principle / enterprise |
| UK-CC-AUD-002 | Evidence | Store policy version IDs used at decision time | Any compliance decision | Blocking | Compliance verification tools | Decision token includes policySetVersion | Worktual Compliance Layer design |

---

## 5. Mapping to Worktual Contact Center agents (example)

| Worktual agent / capability | Must load obligation IDs | Typical verification tools |
|---|---|---|
| Contact Center Super Agent | All in-scope UK-CC-* for the action | Policy resolve + decision token |
| AI Support Agent | UK-CC-REC-001, UK-CC-SVC-001..004 | Disclosure check, auth check, purpose check |
| Support Agent Coworker | UK-CC-SVC-002, UK-CC-SVC-004 | Sensitive data mask, auth gate |
| Interaction Closure Agent | UK-CC-SVC-005, UK-CC-LB-003 | Disposition confirm, objection suppress |
| Audience / Campaign outbound | UK-CC-TEL-001..009, UK-CC-LB-001..003 | TPS/CTPS, DNC, consent scope, CLI |
| Recording / QA workflows | UK-CC-REC-001..005 | Disclosure, LIA, retention |

---

## 6. Suggested decision outcomes for verification tools

| Check fails | System outcome |
|---|---|
| TPS/CTPS hit and no specific consent | **Block** outbound marketing call |
| Automated call without automated-call consent | **Block** |
| Recording enabled but disclosure not played | **Block** recording start or **Approval required** |
| Marketing objection present | **Block** and suppress |
| Sensitive disclosure without authentication | **Block** |
| Healthcare/pension/claims special case incomplete | **Approval required** |
| Missing audit evidence for high-risk action | **Block** |

---

## 7. Example runtime scenario (for BA validation workshops)

**Scenario:** UK outbound live marketing call about a product renewal.

1. Campaign Agent requests applicable UK Contact Centre + marketing policies.
2. Audience Agent screens number against TPS/CTPS and enterprise DNC list.
3. Consent/lawful-basis tool confirms either:
   - specific consent for live calls, or
   - live call allowed because not on TPS/CTPS, no prior objection, not a restricted category, and lawful basis documented.
4. Dialler tool verifies CLI display is on.
5. Voice script includes organisation identity.
6. If customer says “do not call me again”, Interaction/Suppression path writes objection and blocks future marketing calls.
7. Audit log stores policy version, screening results, and outcome.

---

## 8. Open questions for Legal / Compliance (BA must not answer alone)

1. For this tenant, is call recording for QA based on legitimate interests, consent, or another basis?
2. Exact wording and timing of the recording disclosure for IVR and agent-assisted calls?
3. Retention period for recordings, transcripts, and AI summaries?
4. Are claims-management or pension campaigns in scope for this enterprise?
5. Which UK numbers / brands require CTPS as well as TPS screening?
6. Does enterprise policy impose quiet hours or frequency caps beyond PECR?
7. How should chat/social channels inherit voice recording-equivalent transparency rules?

---

## 9. Attachments checklist

- [ ] ICO Telephone marketing page export / dated screenshot or PDF
- [ ] ICO lawful basis for direct marketing page export
- [ ] ICO Legitimate interests page export (call recording training example noted)
- [ ] Enterprise Contact Centre Privacy Notice
- [ ] Enterprise Call Recording / Monitoring Policy
- [ ] Enterprise Outbound Dialler / TPS screening SOP
- [ ] Sample IVR disclosure script
- [ ] Sample “do not call” process SOP

---

## 10. Handoff to Compliance Knowledge Layer

When Legal approves this pack, Compliance Engineering should convert each obligation into:

1. Structured policy metadata (country=GB, industry=contact_centre)
2. Machine-evaluable controls
3. Agent/product mappings
4. Verification tool checks
5. Citations back to this source pack and official URLs
6. Versioned publication in the Compliance Knowledge Layer

**Until Legal approval, agents must not treat this sample as active policy.**
