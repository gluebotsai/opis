# Campaign Management — Product Status Report

| Field | Value |
|-------|--------|
| **Product** | Worktual Campaign (rebuild) |
| **Date** | 14 September 2026 |
| **Scope** | SPA + Fastify API + Python MAS agents + Hub A2A + SFT catalog |
| **Overall** | Core product largely **Implemented**. Gaps below are Pending / Partial. |

**Download companions**

- Markdown (this file): `docs/CAMPAIGN_PRODUCT_STATUS_REPORT.md`
- Spreadsheet CSV: `docs/CAMPAIGN_PRODUCT_STATUS_REPORT.csv`

---

## 1. Status summary

| Status | Meaning |
|--------|---------|
| **Implemented** | Feature is live in product (SPA / API / agents as applicable) |
| **Partial** | Core path works; named gap remains |
| **Pending** | Planned or WIP; not finished for production use |

| Status | Modules (approx.) |
|--------|-------------------|
| Implemented | Dashboard, Audience/Contacts, Create Campaign, Gallery/Images, Monitoring, Recovery, Launch Scheduling, Forms/Events, WhatsApp, Template Library, On-demand, Recommendations, Hub A2A, SFT Agent Catalog |
| Partial | Templates/Compliance (regulatory advisor), Web Tracking (partner cutover) |
| Pending | Template improvement, dynamic filters on running, configuration gaps, contact preferences, gallery media hardening, SFT sample richness, agent platform P3–P5, :8005 firewall allowlist |

*Excluded from this report (explicitly out of current focus): SMS end-to-end, PPC ads surface.*

---

## 2. Implemented modules

| Status | Module Name | Feature Overview | Feature | Implemented |
|--------|-------------|------------------|---------|-------------|
| Implemented | Dashboard | Campaign / ops overview + analytics chat | KPI overview; live/past/scheduled counts; open/click/delivery style metrics; reports chat (`query_analytics`); period filters | Yes |
| Implemented | Audience / Contacts | Audience CRM + chat create/update | Contact list/detail; single & bulk create; Hub `create-contact`; contacts MAS | Yes |
| Implemented | Create Campaign | Chat-led campaign build → launch | Meta/channels/audience; template gen; gallery/images; launch now/schedule | Yes |
| Partial | Templates / Compliance | Channel templates + future regulatory coach | Template gen/edit/coach | Yes for gen/edit; regulatory advisor Planned |
| Implemented | Gallery / Images | Org gallery + AI image flows | Gallery bootstrap/pick; generate/refine; media APIs | Yes |
| Implemented | Monitoring | Live campaign ops | Live/scheduled/past lists; detail; monitor chat | Yes |
| Implemented | Recovery / Ops | Pause/resume/stop / A-B | Recovery tools; Hub stop/resume; A/B auto-winner cron | Yes |
| Implemented | Launch Scheduling | Timed & on-demand launch | Scheduler executor; workers; calendar | Yes |
| Implemented | Forms / Events | Form design + public submit | Events editor; forms agent; `/f/:slug`; tracking hooks | Yes |
| Implemented | WhatsApp | Meta approval + send / fix | Approved/rejected flows; social-service workers | Yes |
| Implemented | Template Library | Reuse library → campaign | Library browse/use; `library_run` | Yes |
| Implemented | On-demand | Autonomous create + send | SPA on-demand; Hub `on-demand-send` / `temp-audience-and-send` | Yes |
| Implemented | Recommendations | AI recommendation board | Generate → recommendation run | Yes |
| Implemented | Hub A2A | Spoke for Worktual Hub | Card + OAuth + ~10 skills; `/a2a/` live | Yes |
| Implemented | SFT Agent Catalog | Synthetic-data agent export | `/internal/v1/agents*`; key auth; `:8005` host-published for discovery | Yes |

---

## 3. Pending / partial backlog

| Status | Module | Feature Overview | Pending Feature |
|--------|--------|------------------|-----------------|
| Pending | Templates | Improve template quality / edit UX | Template improvement (coach quality, inline edit, better regenerate/refine); unify template library + coach where still thin |
| Pending | Templates / Compliance | Content policy before send | `template_regulatory_advisor` (planned, not built) |
| Pending | Audience / Running campaigns | Filters after launch | Dynamic filter apply for **running** campaigns (live re-filter / re-segment; today filters are largely a snapshot at save, not live CDP) |
| Pending | Configuration | Org send / channel setup | Configuration gaps (email Mode B / DNS paste ops path; config UX completeness for senders/domains/channels) |
| Pending | Contacts | Preference-aware send | Contact channel preferences (productize WIP filtering from engagement) |
| Partial | Web Tracking | Click/open → partner | Partner landing / SDK `wt` cutover + short-links/cookies (joint) |
| Pending | Gallery / Media | Deploy hardening | Public media URL / repair stale localhost gallery images |
| Pending | SFT / FT quality | Catalog already live | Richer gold `sampleConversations` across executors |
| Pending | Agent platform | Topology roadmap | P3–P5 (HTTP agents / MCP / orchestrator envelope) |
| Pending | Ops / Security | SFT port open | Firewall allowlist for `:8005` (scheduler IP only) |

---

## 4. Recently closed (reference)

| Item | Outcome |
|------|---------|
| Dashboard agent static / canned replies | Fixed (reports agent tool nudge + greeting rewrite) |
| SFT catalog APIs | Live on agents with `INTERNAL_SERVICE_KEY` |
| Remote SFT discovery Errno 111 | Fixed via `AGENTS_HOST_BIND=0.0.0.0` → `http://82.113.92.49:8005` |
| Hub A2A go-live wiring | Deployed earlier |

---

## 5. Suggested priority (pending only)

1. Template improvement  
2. Dynamic filter apply for running campaigns  
3. Configuration hardening  
4. Contact channel preferences  
5. `template_regulatory_advisor`  
6. Web Tracking partner cutover (joint)  
7. Gallery media hardening  
8. SFT gold samples  
9. Agent platform P3–P5  
10. Firewall allowlist for `:8005`

---

*Generated for internal planning. Secrets (e.g. `INTERNAL_SERVICE_KEY`) are not included in this document.*
