# Proposal generation — current workflow, stack, and challenges

This document is a snapshot of **how proposals work in this CRM today**: learn vs generate, files, models, data, gates, timeouts, known failures, and why output stays short. Product rules in [`docs/proposal-generation.md`](proposal-generation.md) stay the source of truth for “pattern fill, never clone the gold PDF.”

**Design (locked):** learn a **pattern** from BRD + winning-proposal pairs; at generate time **fill** that pattern with **this deal’s** facts, catalog products, and catalog prices. The gold PDF is training input only — never the generated document.

```
Configuration → Proposal patterns
  slots (BRD + winning proposal)
    → ingest → pair → extract → case-study → synthesize (≥3) → freeze
    → ProposalPlaybook (visual) + ProposalContentPlaybook (writing)

Deal / coworker / POST /api/sales/proposals
  BRD and/or meeting notes
    → persist draft (`approvalStatus=generating`)
    → ingest BRD → profile → match playbook → product scope
    → Gemini outline (playbook keys + BRD leaves, cap 32)
    → org/product Context Layer KB retrieve
    → section-by-section generate (rolling recap + catalog prices)
    → fill frozen HTML, append missing slots → quality gate → persist (`drafting`)
    → optional PDF / DOCX
```

TypeScript (Fastify) orchestrates and persists. Python (ai-service) writes commercial copy. Heuristics are **offline fallback only**; extract/freeze/generate must be labeled `source: "ai"` or the job/create fails.

---

## 1. Mental model in one paragraph

The org uploads **repeatable pairs** (customer BRD + a past winning proposal). Gemini + PyMuPDF **learn look and writing habits**. Freeze stores **CSS, cover chrome, section order, table column names, logo** — not body copy or prices. When sales generates on a deal, the pipeline profiles **this** BRD, picks a playbook, writes each section with the LLM against a **word target**, injects catalog prices, and saves HTML. If the draft is too short, full of placeholders, or not AI-sourced, **nothing is saved**.

---

## 2. Where the code lives (not one folder)

Proposal logic is **split by layer**, not a single `proposal/` package. Do not invent a new top-level folder if you need to merge with another machine/branch.

| Layer | Path |
|---|---|
| Fastify HTTP | `backend/src/modules/sales/routes.ts`, configuration proposal-pattern routes |
| Generate command | `backend/src/service/sales/proposal-from-playbook-commands.ts` |
| Section orchestrator | `backend/src/service/sales/proposal-section-orchestrator.ts` |
| Learn job | `backend/src/service/ai/proposal-corpus-job.ts` |
| Content playbook / length / retrieval | `backend/src/lib/proposal-content-playbook.ts` |
| HTML fill / validate | `backend/src/lib/proposal-playbook-layout.ts` |
| Pattern split / product gate | `backend/src/lib/proposal-playbook-pattern.ts` |
| PDF / DOCX | `backend/src/service/sales/proposal-pdf.ts`, `proposal-docx.ts` |
| Corpus disk | `backend/src/lib/proposal-corpus-storage.ts` → `data/proposal-corpus/{org}/{batch}/` |
| Prisma / DAO | `Proposal*`, `ProposalCorpus*` in `prisma/schema.prisma`; `backend/src/dao/sales/proposal-service.ts`, `dao/ai/proposal-corpus-store.ts` |
| Python agents | `ai-service/app/agents/proposal_*.py` |
| Gemini client | `ai-service/app/services/proposal_gemini.py` |
| PDF parse | `ai-service/app/agents/proposal_pdf_parse.py` (PyMuPDF) |
| MCP tools (coworker propose only) | `ai-service/app/mcp/catalog.py` |
| Train UI | `frontend/src/pages/ProposalPatternsPage.tsx` (`/configuration/proposal-patterns`) |
| Deal UI | `frontend/src/components/sales/DealProposalsPanel.tsx` |
| Detail / export | `frontend/src/pages/ProposalDetailPage.tsx` |

**Not this path:** org `ProposalTemplate` rows and `fromTemplate` / `templateId` on create. `POST /api/sales/proposals` delegates to from-playbook.

---

## 3. What we use (stack)

### Runtime

| Piece | Role | Typical local |
|---|---|---|
| Vite (`frontend/`) | SPA; `/api` reverse proxy to Fastify | `:5173` |
| Fastify (`backend/`) | Auth, RBAC, Prisma, orchestration, persist, PDF/DOCX | `:4000` |
| ai-service (Python / uvicorn) | LLM agents + MCP HTTP host | `:8000` (`/health`; `/ready` may 503 if extra MCP down) |
| PostgreSQL (shared Worktual) | `crm.*` proposals; `inventory.products`; `cdp` / `accounts` read | Do **not** `db:seed` on shared DB |

A2A, standalone MCP :8010, meeting-service, campaign-ms are **not** required for proposal generate.

Local start/stop (this workspace): `.scripts/run-local.sh`, `.scripts/stop-local.sh`. Env template: `.env.proposal.local.example`. Real secrets live in root `.env` (never commit).

### Models

| Concern | Env / default | Notes |
|---|---|---|
| **Proposal learn + generate** | `PROPOSAL_LLM_*` / `GEMINI_API_KEY`; default model `gemini-3.5-flash` | Native **google-genai** when installed. Empty key → skip Gemini and fall back to CRM LLM. |
| **Coworker / other CRM agents** | `LLM_BASE_URL` / `LLM_MODEL` (e.g. worktual-qwen) | Must not be used as the happy-path proposal writer when Gemini is configured. |
| Thinking | Default **high**, `include_thoughts=false`. One Chat.send_message per section. `max_output_tokens` **65536** (thinking + JSON share this budget). `HttpOptions.timeout` is **180000 ms**. | AFC disabled. |

`PROPOSAL_LLM_BASE_URL` is ignored for JSON generate when `google-genai` is installed.

### Libraries and services

| Technology | Used for |
|---|---|
| **Gemini** (`google-genai`) | Extract gold PDF, freeze, section/whole generate, QA |
| **PyMuPDF** (`fitz`) | PDF text, tables, measured layout, theme tokens |
| **Pydantic** (`proposal_schemas.py`) | Strict JSON schemas (e.g. `SectionDraft`, `BrdExtraction`) |
| **Playwright** | HTML → PDF export (`proposal-pdf.ts`) |
| **DOCX builder** | HTML/sections → Word |
| **Prisma** | `crm.proposals`, playbooks, corpus tables |
| **`inventory.products`** | Names, descriptions, **unit prices** (DML only; no inventory DDL) |
| **Enterprise Context Layer KB** | Capability copy on **section generate** (`proposal-kb-retrieve` plus per-leaf search; `product_ids` = module **slugs**, not inventory CUIDs) |
| **MCP / coworker** | `propose_create_proposal` — UI still **POSTs Fastify**; dual path forever |

### Frozen vs regenerated

| Frozen from winning proposal | New for this deal |
|---|---|
| Theme CSS (fonts, colors, spacing) | All section prose |
| Cover structure | Cover values (client, date, product tags) |
| Section **order and headings** | Table **cell** values |
| Table **column** specs | Prices from catalog |
| Logo | BRD / meeting facts |
| `data-slot` skeleton | Allowed-product gating |

---

## 4. Learn pipeline (Configuration → Proposal patterns)

### User flow

1. Upload **repeatable slots** (each slot = one BRD + one winning proposal).
2. Optional `POST .../pair-score` — LLM relatedness. Below ~**0.3** needs “use anyway”. No heuristic `0.00` if the LLM is down (error).
3. `POST /api/configuration/proposal-patterns/batches` with `startProcessing: true`.
4. Poll until the corpus job finishes. **Recently learned**: filename, section count, content-playbook coverage, Active / Learning / Failed.
5. **No pattern preview.** Proof of learn is the first generated deal proposal.

### Job sequence (`corpusLearnAgentSequence`)

1. `proposal-corpus-ingest` — PDF / DOCX / TXT → `fullText`. Word is text, not a fake PDF to Gemini.
2. `proposal-corpus-pair` — persist user slots; score if not submitted.
3. `proposal-corpus-extract` — Gemini reads gold proposal (instance, layout, theme, logo). **`source` must be `"ai"`.**
4. `proposal-corpus-case-study` — per pair: how this BRD became this proposal (`sectionAnalysis`, `lengthAnalysis`).
5. `proposal-playbook-synthesize` — org **content** playbook when **≥ 3** case studies (append-only versions).
6. `proposal-playbook-freeze` — visual master = **highest pairing confidence**; theme CSS + skeleton HTML; pins `contentPlaybookId`.

Enqueue: `POST /api/configuration/proposal-patterns/batches/:id/process`.

### Prisma / disk

- `ProposalCorpusBatch`, `ProposalCorpusItem` (`kind`: requirement \| proposal), `ProposalCorpusPair` (`pairingSource`, `isVisualMaster`), `ProposalCorpusCaseStudy`, `ProposalCorpusJob`
- `ProposalPlaybook` — visual freeze (`approved` on success)
- `ProposalContentPlaybook` — writing specs, exemplar bank, variance log, case-study count, confidence
- Files: `data/proposal-corpus/{orgId}/{batchId}/`

### Agents registered but **not** in the live learn sequence

`proposal-corpus-structure`, `proposal-corpus-design-geometry`, `proposal-corpus-design-critique`, `proposal-corpus-section-deep`, `proposal-corpus-features`, `proposal-playbook-cluster`, `proposal-playbook-qa` (rule-only; content QA at generate is `proposal-content-qa`).

### Learn failures (Recently learned)

- Same file as both requirement and proposal
- Gemini could not read the upload as PDF (use PDF for the winning proposal if fonts/layout matter)
- Extract / case-study / synthesize / freeze not AI-sourced
- Skeleton check: no visual template

---

## 5. Generate pipeline (deal)

Every create goes through **`createProposalFromPlaybookCommand`**.

### Entry points

| Surface | API |
|---|---|
| Deal → Proposals | `POST /api/sales/proposals/from-playbook` |
| Coworker (after BRD attached) | Tool `propose_create_proposal` → `POST /api/sales/proposals` |
| Regenerate / personalize | `POST /api/sales/proposals/:id/personalize` |
| Section rewrite | `POST /api/sales/proposals/:id/rewrite-section` |

Frontend from-playbook POST returns a stub immediately (`approvalStatus=generating`). The detail page polls until `drafting` or `failed`. Vite proxy `/api` is **120s** and no longer bounds generate length.

### Gates before the LLM writes

1. **Requirement** — BRD (PDF / Word / text) and/or meeting notes. Coworker will not propose create until `requirementPdfAttached`.
2. **≥ 1 approved playbook** — else error points at Configuration → Proposal patterns.

### Step-by-step

1. **Assemble requirement** — `composeProposalRequirement` labels meeting notes vs BRD. Optional file → `proposal-corpus-ingest`; `fullText` prepended.
2. **`proposal-requirement-profile`** — JSON: themes, products, features, customer, industry, constraints, deal-size band, summary. Used for match and scope, **not** as the proposal body.
3. **Select playbook** — `retrieveTopPlaybooks` then `proposal-playbook-match`. Low topical confidence does **not** block. Optional `playbookId` pins regenerate.
4. **Skeleton** — `skeletonFromPlaybook(sectionsJson)`; cover is not a body section.
5. **Product scope** — `resolveProposalProductScope` + **`inventory.products`**. Extra SKU mentions stripped (`gateProposalSectionsAgainstAllowedProducts`).
6. **Write**
   - If content playbook usable (≥ 3 case studies): **`proposal-kb-retrieve`**, then **`proposal-generate-section`** once per **playbook** leaf (no BRD TOC expansion). Recap is closed claims; catalog prices only.
   - Else **`proposal-generate`** whole document (up to 2 attempts). This path also probes product KB; transport/5xx/`kb_unavailable` → fail fast.
7. After the model: fill commercial table prices from catalog, scrub invented prices, apply frozen cover, render HTML with frozen CSS (`fillPlaybookTemplate` **appends** `data-slot` sections that were not in the learned skeleton).
8. **Quality gate** (see below). Failures mark the stub `approvalStatus=failed` instead of leaving a silent empty draft.
9. **HTML validate** — required slots/sections present.
10. **Persist** — `sections`, `blueprint` (`mode: "playbook-template"`, html + css, `playbookId`), customer name, title, summary, `dealId`, `approvalStatus=drafting`. `templateId` is null.

`proposal-content` is for later rewrite/personalize helper, not the first draft.

### Length planner

`planSectionLengths` uses **per-section gold means** (or spec midpoint / 80-word floor). It does **not** inflate to a 4× document budget or add extra BRD chapters. Short leaves are reported to the quality gate; they are **not** rewritten.

Section extras send one recap field (`alreadyCovered`: heading + closed claims), a BRD excerpt larger than the KB cap, compact catalog rows (id/name/price), and truncated exemplars/spec. Each leaf is **one** Gemini `Chat.send_message`. Recap is input on that write; overlap is not a second paid call. Thinking stays **high**. Output is one JSON `body` (+ optional `tableRows`).

### Quality gate (nothing saved if)

- `generated.source !== "ai"`, **or**
- Any section still below the planned word band, **or**
- Total body (+ table) chars below min (`max(1500, sections×220)` or a lower bar if tables are large), **or**
- Too many placeholder bodies (`Requirement themes:`, `Present `, `Define `, …), **or**
- Empty bodies with no table rows.

Content-playbook generate is **one write per leaf**. Native proposal agents do not retry on timeout. Gemini failure does not fall through to a second model. After orchestrator, Fastify may still hard-fail the create.

QA: `PROPOSAL_CONTENT_QA_MODE=shadow` (default) | `active` | `off`. Shadow logs mismatches (e.g. compare table vs narrative; note word band) and does not block unless you turn `active`.

After a **successful** section-by-section write, the command currently sets `generated = { source: "ai", html: "" }` and fills HTML locally — the gate still inspects section bodies.

### After generate

| Action | How |
|---|---|
| View | Stored `blueprint.html` + CSS |
| Rewrite one section | `proposal-content` + deal/meeting context |
| PDF | Playwright Chromium + export layout tokens |
| DOCX | Same prepared HTML/sections |

Send/share still requires human approval (document approval / sales flow). Quote from accepted proposal uses **catalog** prices (`quote-from-proposal`).

### HTTP (sales)

| Method | Path |
|---|---|
| `POST` | `/api/sales/proposals`, `/proposals/from-playbook` |
| `GET` | `/proposals/:id`, `.../pdf`, `.../docx` |
| `POST` | `.../personalize`, `.../rewrite-section`, `.../patch-section`, `.../blueprint-html`, `.../patch-document-text` |

Learn APIs: `/api/configuration/proposal-patterns/*`.

### Data the generator may use

| Source | For |
|---|---|
| Current BRD / meeting notes | This customer’s ask |
| Approved playbook | Look, order, table headers |
| `inventory.products` | Names, descriptions, prices |
| Sales KB | Capability language on **section generate** and whole-doc fallback (slugs like `crm`, `contact-center`) |
| Deal / company / contact | Names, title, notes |

**Not** used as the answer: gold PDF body; previous draft prose on regenerate (`buildProposalRegenerateRequirement` rebuilds from meeting/deal facts).

---

## 6. Timeouts and ceilings (current bottlenecks)

| Layer | Limit |
|---|---|
| Vite `/api` proxy | **120s** (stub create + polling; generate runs in-process after POST) |
| Frontend axios from-playbook | 60s (returns `{ status: generating, id }`) |
| Fastify `AI_SERVICE_JOB_TIMEOUT_MS` | ~210s |
| Fastify `AI_SERVICE_MAX_TIMEOUT_MS` | **240s** per agent call |
| Gemini HTTP client | **180s** per call |
| LLM job / max | 150s / 210s |
| OpenAI-compat Gemini `max_tokens` | **8192** (whole-doc / fallback path) |
| Generate-section `max_tokens` | `max(2000, target_words * 4)` on Qwen path |

UI generate is a **background job** on the draft proposal (`approvalStatus=generating`). Scripts and post-meeting still pass `sync: true`.

---

## 7. Challenges we already hit (building and operating)

These showed up in product comments, tests, and local generate:

1. **Clone vs generate** — users expect the gold PDF back; product is pattern-fill. Freeze is theme + skeleton, not pixel-perfect pages.
2. **Messy PDFs** — two-column, headers/footers, tables-as-images; extract **under-counts words** and trains a short length planner.
3. **Section-key aliases** — `executive_summary` ↔ `overview`, `note_for_vbike` ↔ `note_for_client`; mismatch drops exemplars or QA fails.
4. **Short stubs** — models compress; 80-word floors; quality gate then **discards the whole document**.
5. **Wrong SKUs / apparel / invented prices** — extra products stripped; prices only from catalog; commercial cells left blank otherwise.
6. **KB CUID vs slugs** — inventory ids dropped; search needs Context Layer product slugs.
7. **Georgia + rainbow fallback** — freeze not AI → job fail (no silent heuristic playbook).
8. **Page-clone vs playbook-template** — older clone mode exists in layout helpers; live generate is `playbook-template`.
9. **Coworker create-too-early** — must attach BRD first.
10. **All-or-nothing generate** — no preview of playbook × BRD before save.
11. **≥ 3 case studies** for content playbook; 4 studies still **low** confidence; visual freeze needs a PDF gold for fonts.
12. **Word/text gold** learns little layout; winning proposal should be PDF.
13. **Pair score advisory** — user slots always persist; old 0.65 auto-match floor does not apply to explicit pairs.
14. **Gemini keys missing locally** — sections silently used CRM LLM fallback; quality/length suffered.
15. **Vite 120s** — UI create now returns a stub; poll the proposal until `drafting`.
16. **QA shadow mismatches** — comparison tables written as essays; closing notes shorter than spec (e.g. 78 vs 100–200 words).
17. **Product KB** — section path retrieves org/product KB; transport failure fails the job (`kb_unavailable`).
18. **Seed vs login** — `npm run db:seed` writes `public.users` (`demo`); real login is `accounts.setup_users`. Do not seed shared Worktual DB.
19. **Dual path forever** — MCP proposes; Fastify executes. Do not generate inside coworker.

---

## 8. Challenges for comprehensive (enterprise-length) proposals

Goal: PDFs whose **length, structure, and detail** match winning enterprise proposals, **grounded in the customer BRD** — not a 3-page summary.

The pipeline **works end-to-end** but **plans** for a few pages. Scaling is not “raise `max_tokens`.”

### Technical bottlenecks

| Area | What happens now |
|---|---|
| **Length model** | Per-section gold/spec/floor. Playbook skeleton only. |
| **Coarse skeleton** | Playbook slots only (no extra BRD TOC). HTML fill appends missing frozen slots. |
| **Context window** | Compact extras (~28k cap); BRD excerpt 8k, KB 4k. |
| **JSON schema** | Still one `body` blob per leaf (Gemini `SectionDraft`). |
| **Latency** | UI generate is async on the draft; Gemini client 180s per call. |
| **KB / Gemini capacity** | Org KB fail-closed on transport. Gemini **503/429 high demand** stops the job; remaining leaves are not called. |
| **Coherence** | Heading + closed claims for recent leaves; older leaves are heading-only “already covered”. |
| **Quality gate** | Still all-or-nothing on the finished job; stub stays `failed` instead of vanishing. |

Paid Gemini (`PROPOSAL_LLM_*` / `GEMINI_API_KEY`) remains the happy-path writer.

---

## 9. Invariants (do not regress)

- Pattern-fill, not PDF clone.
- Extract/freeze/generate happy path = LLM (`source: "ai"`).
- Prices only from **`inventory.products`**; no CRM DDL on `inventory` / `cdp` / `accounts` (except approved exceptions elsewhere).
- B2C never enables Finance; proposal is a **sales** document, not an invoice.
- Coworker proposes tools; Fastify creates the proposal.
- Manual Configuration / Deal forms remain.
- UI-only RBAC is not enough; mutations stay tenancy-checked.

---

## 10. Local ops (this workspace)

```bash
bash /home/vectone/rebuild/AI-Native-CRM/.scripts/run-local.sh   # API :4000, Vite :5173, ai-service :8000
bash /home/vectone/rebuild/AI-Native-CRM/.scripts/stop-local.sh
```

Need `GEMINI_API_KEY` or `PROPOSAL_LLM_API_KEY` for native Gemini. Login is an **Accounts** setup user, not the Prisma seed `admin.b2b@worktual.com` / `demo` unless that row exists in `accounts.setup_users`.

---

## Related docs

- [`docs/proposal-generation.md`](proposal-generation.md) — product how-it-works (shorter)
- [`docs/worktual-combine-contracts.md`](worktual-combine-contracts.md) — MCP / coworker contracts
- [`docs/multi-tenancy-common-model.md`](multi-tenancy-common-model.md) — one CRM schema, catalog in inventory
- `.cursor/rules/agents-must-use-llm.mdc` — no heuristic-as-agent on the success path
