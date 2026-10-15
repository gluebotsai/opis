# Web Tracking Agents — Ontology Guide

**Product:** Worktual Web Tracking  
**Audience:** Ontology layer, semantic layer, agent integration  
**Purpose:** Describe the live agents, what each one is responsible for, why ontology context makes their answers more accurate, and the simple entities and relations the ontology must teach.

This is **not** a metric catalog and **not** a database schema. It is the product-and-workflow picture the agents need before they resolve numbers.

---

## 1. What agents exist today

There are **two live agents** in the current Web Tracking setup. There is no separate KPI agent and no standalone SQL agent.

| Agent | Where it lives | Who uses it | Input | Output |
|-------|----------------|-------------|-------|--------|
| **AnalyticsAgent** | `AI_CHAT/app/agent/pipeline.py` | Site owner / marketer in the dashboard co-worker chat | Natural-language question | Plain-language answer + chart/table + follow-up suggestions |
| **InsightsAgent** | `AI_CHAT/app/insights/insights_agent.py` | Dashboard Insights panel | Pre-built analytics snapshot (JSON) | Diagnostic / predictive / prescriptive narrative |

Internal modules inside AnalyticsAgent (query rewrite, known SQL, LLM SQL, answer writing) are **capabilities**, not separate agents. Do not model them as their own agents in the ontology.

The old multi-agent stack in `web_tracking_old_setup/` (intent agent, SQL agent, plot agent) is **legacy** and is not part of this ontology.

---

## 2. AnalyticsAgent

### Purpose

The AnalyticsAgent is the **Worktual web analytics co-worker**. A site owner asks a question in plain English. The agent understands what they mean in web-tracking terms, fetches the matching numbers for **their website only**, and answers like a colleague — not like a database.

Typical questions:

- “How many visitors came this week?”
- “Which country has the most sessions?”
- “Show top 10 pages.”
- “Tell me about visitor_abc.”
- “What is the bounce rate on mobile?”
- “Where did traffic come from?”

### Responsibilities

1. **Stay in scope.** Answer only website analytics. Refuse jokes, coding help, and general knowledge.
2. **Understand the product workflow.** Know that the user is looking at Dashboard / Visitors / Sessions / Behavior / Forms / Product Analytics, and that the dashboard period (`today | week | month | overall`) should match the answer unless they ask for a different range.
3. **Disambiguate language.** “Visits” usually means sessions. “People” usually means visitors. “Pages” is not the same as “visitors.” “That visitor” means the one from the previous answer.
4. **Resolve the question.** Turn follow-ups into one clear ask: what to measure, for whom, over which time, grouped how, limited to how many.
5. **Fetch the right data.** For dashboard KPIs use the known dashboard-aligned recipes. For lists, breakdowns, and drill-down, compose a query from the semantic layer. Keep tenant isolation (`website_id`).
6. **Respect metric truth.** Bounce rate has one definition. Visitors are unique people, not session rows. Exit page is not stored on the session row.
7. **Speak like a site owner.** No table names, no SQL, no internal IDs except `visitor_id` when the question is about a specific visitor.
8. **Help the next step.** Offer 2–3 follow-up questions that stay inside the same workflow (for example: after top pages, ask bounce rate or traffic source for those pages).

### How it works (for ontology design)

```
User question
  → greet / refuse if off-topic
  → rephrase follow-up into a standalone question
  → understand entities (visitor vs session vs page vs conversion)
  → fetch numbers (KPI recipe or semantic query)
  → write a business answer + chart/table
```

Ontology is used **before and after** the numbers: first to understand the question, then to explain the answer correctly.

---

## 3. InsightsAgent

### Purpose

The InsightsAgent is the **dashboard storyteller**. It does not chat. It does not run ad-hoc SQL. It receives a compact snapshot of already-aggregated site health and writes three kinds of insight:

- **Diagnostic** — what changed and how serious it is
- **Predictive** — what volume / bounce look like next
- **Prescriptive** — what the user should do next, with a link to `/`, `/behavior`, `/visitors`, or `/sessions`

### Responsibilities

1. **Narrate only the snapshot.** Never invent numbers.
2. **Explain change in product language.** “Bounce rose because landing pages from paid traffic are weak” — not “`is_bounce` increased on `dim_sessions`.”
3. **Connect cause and effect** using workflow knowledge: traffic up + bounce up = acquisition mismatch; errors up + conversions down = site reliability problem.
4. **Rank actions** as High / Medium / Low and point the user to the right dashboard area.
5. **Keep severity honest.** Large change is critical; small change is normal.

### How it works (for ontology design)

```
Dashboard period selected
  → API builds snapshot (KPIs, movers, rollups, forecasts)
  → InsightsAgent writes narrative
  → Insights panel shows it
```

Ontology is used to **interpret relationships**, not to fetch rows.

---

## 4. Why ontology is needed

The semantic layer answers: *which metric, which filter, which value list.*  
The ontology answers: *what this product is, how the pieces fit, and how a site owner talks about them.*

Without ontology, both agents can still return numbers and still get the story wrong.

| Problem without ontology | What goes wrong | What ontology fixes |
|--------------------------|-----------------|---------------------|
| “Visits” vs “visitors” | Agent counts sessions when the user meant people, or the reverse | Teaches that a visitor is a person/browser, a session is one visit |
| “That one” follow-up | Agent loses the visitor, page, or country from the last answer | Teaches conversation objects: current visitor, current page, current period |
| Bounce questions | Agent uses a stale session flag | Teaches the product rule: one page and almost no time |
| Journey questions | Agent treats pages as a flat list | Teaches order: land → view pages → click / form / buy → leave |
| Insights narrative | Agent says “sessions dropped” with no meaning | Teaches that sessions come from traffic, and bounce/errors can waste that traffic |
| Form / shop questions | Agent mixes form submit with purchase | Teaches two different success paths: lead form vs checkout |
| Identity questions | Agent treats every visitor as a known customer | Teaches anonymous visitor vs identified user |
| Tone | Agent talks like a database | Teaches business language and what the dashboard user is trying to do |

### What ontology should give each agent

**AnalyticsAgent needs ontology to:**

1. Classify the user’s ask into a workflow: site health, traffic source, geography, page ranking, visitor profile, form funnel, shop funnel, speed, or errors.
2. Pick the right entity. “Show India” is usually visitors or sessions **from** a country, not a country object by itself.
3. Keep follow-ups attached to the same entity (“this visitor”, “those pages”, “mobile only”).
4. Know which questions are lists, which are single numbers, and which are journeys.
5. Phrase the answer in the same words the dashboard uses.

**InsightsAgent needs ontology to:**

1. Read a KPI change as a business event, not a raw delta.
2. Combine related entities: traffic source → landing page → bounce → conversion.
3. Choose the right next screen (`/visitors`, `/sessions`, `/behavior`).
4. Avoid recommending replay, SQL, or pipeline tables.

**Ontology should not:**

- Replace SQL or metric formulas (that is the semantic layer).
- List every ClickHouse column.
- Include session replay internals, ingest payloads, or pipeline tables.

---

## 5. How to add ontology as agent context

Give each agent a short, stable picture of the product — not the whole database.

Recommended context blocks:

1. **Product picture** — what Web Tracking is for (understand people on *this* website).
2. **Entity list** — the objects below, in plain English.
3. **Relation list** — how those objects connect.
4. **Workflow rules** — bounce, new vs returning, online now, dashboard period, identified vs anonymous.
5. **Language map** — user words → entities (“visits” → session, “people” → visitor, “sales” → purchase conversion).
6. **Guardrails** — do not mention tables; do not mix visitor count with session count; bounce has one meaning.

AnalyticsAgent should receive the full entity + workflow picture.  
InsightsAgent can receive a shorter version focused on cause-and-effect (traffic, landing page, bounce, conversion, errors, speed).

---

## 6. Main entities

Keep these names in the ontology. Each definition says **exactly what it is in Web Tracking**.

### Website

The one tracked site the logged-in user is looking at. Every answer is only about this website. In the product this is the customer’s domain / property.

### Organization

The Worktual customer account that owns one or more websites. The chat user belongs to an organization, but they ask questions about **their current website**, not the whole company unless they say so.

### Visitor

A person browsing the website, identified by a browser cookie (`visitor_id`). Most visitors are anonymous. One visitor can come back many times. “How many visitors?” means how many distinct people/browsers, not how many visits.

### Known user

A visitor who logged in, registered, or was identified, so we now know a real user id (and sometimes email or name). Still the same person as the visitor — just no longer anonymous.

### Session

One visit. It starts when the visitor arrives and ends when they leave or go idle. One visitor can have many sessions. “How many sessions?” / “how many visits?” means how many of these visits happened.

### Page

A URL path on the website, such as `/pricing` or `/checkout`. A page is a place. It is not a visit and not a person.

### Page view

One time a page was opened. If the same visitor opens `/pricing` three times, that is three page views of one page. “How many page views?” counts these openings.

### Landing page

The first page of a session — where the visit started. This is how we judge whether a campaign or referrer sent people to a good first page.

### Exit page

The last page the visitor viewed in that session — where they left. In Web Tracking this is inferred from page views, not stored as a reliable session field.

### Interaction

A physical action on a page: click, scroll, hover, rage click, or dead click. It tells us what the visitor did *on* the page, not which page they opened.

### Rage click

Repeated fast clicks on the same spot. In this product it means the visitor is frustrated — a button looks clickable but nothing useful happens.

### Dead click

A click on something that is not interactive. In this product it means the page looks clickable but is not.

### Form

A lead or contact form on the website (for example Contact Us). It is a conversion path for enquiries, not for money.

### Form event

One step in that form: seen, started, field filled, submitted, succeeded, failed, or abandoned.

### Product

An item in the shop catalog — something with a product id, name, and often a price or category.

### Product action

What the visitor did with a product: viewed it, added to cart, removed from cart, added to wishlist, or started checkout.

### Conversion

A goal the site owner cares about: purchase, signup, login, checkout start, refund, or a custom goal. A conversion is a success event, not a page view.

### Purchase

The conversion that means money was taken — an order completed. Revenue and average order value come from this.

### Traffic source

How the visitor arrived: Google, email, a Worktual campaign, a referring website, or direct (typed the URL / no referrer). Stored as referrer domain and UTM tags (source, medium, campaign).

### Campaign

A marketing push that sent people to the site — usually from Worktual Campaign or UTM tags. A campaign can start many sessions.

### Custom event

A business action the site owner named themselves (`track('demo_requested')`, site search, and similar). Use this when the question is not a built-in page view, click, form, or purchase.

### Performance measurement

How fast and stable a page felt in the browser — LCP, FCP, CLS, INP, TTFB. This is site speed, not traffic.

### Error

A JavaScript or loading failure on the page. This is site reliability. Errors can make people bounce or fail to convert.

### Time period

The window the user (or the dashboard pill) asked for: today, last 7 days, last 30 days, or all time. “Online now” is not a period — it is the last 5 minutes of activity.

### Online visitor

A visitor whose session was active in the last 5 minutes. This is live presence, not “visitors today.”

---

## 7. Main relations

Write these in the ontology as simple sentences. They are the rules the agent should use when reading a question or explaining a result.

### Ownership and tenancy

- **An organization owns a website.**  
  The agent never mixes two customers’ data.

- **A website has many visitors.**  
  All counts are for the current website only.

### People and visits

- **A visitor has many sessions.**  
  One person can visit many times. Visitor count ≤ session count in normal traffic.

- **A session belongs to exactly one visitor.**  
  You can open a visitor and see their visits.

- **A visitor may become a known user.**  
  Identify / login / register links the cookie to a real account. The visitor id stays the same.

- **A session may belong to a known user.**  
  If they identified during or before that visit.

### Pages and journeys

- **A session contains page views, in order.**  
  That ordered list is the visitor journey.

- **A page view happens on one page.**  
  “Top pages” ranks pages by how many times they were opened.

- **A session starts on a landing page.**  
  First page view = landing page.

- **A session ends on an exit page.**  
  Last page view = exit page.

- **A page can appear in many sessions.**  
  Popular pages collect many page views from many visitors.

### Actions on a page

- **A page view can contain interactions.**  
  Clicks and scrolls happen *during* a page view.

- **A rage click or dead click is a kind of interaction.**  
  They signal frustration on that page.

- **A form event happens on a page, in a session, by a visitor.**  
  Form success is a lead conversion path, separate from purchase.

### Commerce

- **A product action happens in a session, by a visitor, on a product.**  
  View → add to cart → checkout is the shop funnel.

- **A conversion happens in a session, by a visitor.**  
  It may mention a product and a money value.

- **A purchase is a conversion that creates revenue.**  
  Refund is the opposite conversion.

### Acquisition

- **A session arrives through a traffic source.**  
  Source/medium/campaign/referrer describe *this visit*, not the visitor’s whole life.

- **A campaign can start many sessions.**  
  Campaign quality is judged by sessions, bounce on the landing page, and conversions.

- **A traffic source lands people on a landing page.**  
  High traffic + high bounce usually means the ad and the first page do not match.

### Quality of the visit

- **A session may bounce.**  
  Bounce means the visitor saw only one page and left almost immediately (under 10 seconds).

- **A new visitor is a visitor with only one session in the chosen period.**  
  A returning visitor has more than one session in that period.

- **An online visitor is a visitor with a session active in the last 5 minutes.**  
  This is not the same as visitors today.

### Site health

- **A page can have performance measurements.**  
  Slow pages can increase bounce.

- **A page or session can have errors.**  
  Errors can stop forms and purchases.

- **A custom event happens in a session, by a visitor.**  
  It is an extra business signal the site owner defined.

### Time

- **Every count is for a time period unless the user asks “right now.”**  
  The dashboard period is the default window.

- **Follow-up questions stay on the last entity and period** unless the user changes them.  
  “And by country?” still means the same metric and dates.

---

## 8. Cause-and-effect the agents should know

These are ontology *interpretations*, not extra metrics. They make answers and insights sound like a teammate.

| If this happens | It often means | Look at |
|-----------------|----------------|---------|
| Sessions up, visitors flat | Same people visiting more often | Returning visitors |
| Visitors up, bounce up | New traffic is not a good fit | Traffic source + landing page |
| Page views up, pages per session down | People open a page and leave | Landing page and bounce |
| Rage clicks on a page | The UI on that page is broken or confusing | That page’s interactions |
| Form starts high, success low | The form is hard or failing | Form events on that form |
| Cart adds high, purchases low | Checkout is dropping people | Product actions + checkout conversions |
| Errors up, conversions down | The site is breaking the goal | Errors on checkout / form pages |
| Slow LCP, bounce up | The page is too slow | Performance on that page |
| Identified visitors up | More people logged in or were recognized | Known users |

InsightsAgent should use this table when writing diagnostic and prescriptive text.  
AnalyticsAgent should use it only to choose a sensible follow-up, not to invent a cause when the user only asked for a number.

---

## 9. Language map (user words → entities)

Teach this in the ontology so the agent does not guess.

| User says | Treat as |
|-----------|----------|
| visitors, people, users, audience | Visitor |
| online now, live users | Online visitor |
| new / first-time visitors | Visitor with one session in the period |
| returning / repeat visitors | Visitor with more than one session in the period |
| visits, sessions, traffic (volume) | Session |
| pages, top pages, URLs | Page, ranked by page views |
| page views, views, impressions | Page view |
| landing page, entry page | Landing page |
| exit page, where they left | Exit page |
| clicks | Interaction of type click |
| rage clicks, frustration | Rage click |
| bounce, bounce rate | Session that bounced |
| where from, source, campaign, Google, email | Traffic source / Campaign |
| country, city, India, Chennai | Visitor/session location |
| mobile, desktop, Chrome | Device / browser on the session |
| this visitor, visitor_abc | One Visitor |
| journey, path, what did they do | Page views in one session, in order |
| form, contact form, submit, abandon | Form and form events |
| product, cart, wishlist, checkout | Product and product actions |
| sales, orders, revenue, AOV | Purchase conversion |
| conversions, signups, goals | Conversion |
| speed, LCP, slow pages | Performance measurement |
| errors, bugs, JS errors | Error |
| today / this week / this month / overall | Time period (or the dashboard pill) |

---

## 10. What each agent should remember from the ontology

### AnalyticsAgent — must get right

1. Visitor ≠ session ≠ page view.
2. Answers are always for the current website.
3. Dashboard period applies unless the user names another range.
4. Bounce has one meaning.
5. Exit page comes from the last page view.
6. A follow-up stays on the last visitor, page, or filter.
7. Lists (top pages, top visitors, by country) are different from a single KPI.
8. Speak business English; show `visitor_id` only when the user is inspecting people.

### InsightsAgent — must get right

1. A KPI change is a story about people, visits, and pages — not a database row.
2. Traffic, landing page, bounce, and conversion are one chain.
3. Recommend the next dashboard area, not a query.
4. Never invent a number that is not in the snapshot.

---

## 11. Suggested ontology shape (keep it small)

Use these as the ontology’s only first-class objects. Everything else is a property or a type of one of these.

```
Organization
  owns → Website

Website
  has → Visitor
  has → Page
  has → Product
  has → Form
  measured over → Time period

Visitor
  makes → Session
  may be → Known user
  may be → Online visitor

Session
  arrives via → Traffic source / Campaign
  starts on → Landing page
  contains → Page view (ordered)
  ends on → Exit page
  may bounce
  may include → Interaction
  may include → Form event
  may include → Product action
  may include → Conversion
  may include → Error
  may include → Custom event

Page view
  is of → Page
  may have → Interaction
  may have → Performance measurement
```

That is enough for both agents. Do not add pipeline objects (raw payload, staging, replay chunk) to this picture.

---

## 12. Related documents

| Document | Use it for |
|----------|------------|
| [WEB_TRACKING_AGENT_SEMANTIC_LAYER.md](./WEB_TRACKING_AGENT_SEMANTIC_LAYER.md) | Which metrics and dimensions to compute |
| [WEB_TRACKING_SEMANTIC_LAYER_DATABASE.md](./WEB_TRACKING_SEMANTIC_LAYER_DATABASE.md) | What each table/column is for |
| [WEB_TRACKING_CLICKHOUSE_FULL_SCHEMA.md](./WEB_TRACKING_CLICKHOUSE_FULL_SCHEMA.md) | Full ClickHouse schema |

**Split of duties:**

- **Ontology** = what the product is, and how objects relate (this file).
- **Semantic layer** = how to calculate and list the numbers.
- **Schema** = where those numbers physically live.
