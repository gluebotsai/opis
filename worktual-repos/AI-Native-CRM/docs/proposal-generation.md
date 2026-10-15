# How proposal generation works

A new deal proposal is **not** a copy of an uploaded winning PDF. The org first **learns a pattern** (look + section template) from a requirement + winning proposal pair. At generate time, that frozen pattern is filled with **this deal’s** facts, catalog products, and catalog prices.

```
Configuration → Proposal patterns
  repeatable BRD+proposal slots
       → ingest → persist pairs → extract → case-study → synthesize → freeze
       → ProposalPlaybook (visual) + ProposalContentPlaybook (org writing style)

Deal / coworker / POST /proposals
  BRD and/or meeting notes
       → profile → match visual playbook
       → content playbook (latest on create; pinned/null→latest on regenerate)
       → proposal-generate-section (or proposal-generate fallback)
       → fill frozen HTML slots
       → Proposal.sections + Proposal.blueprint
       → optional PDF / DOCX export
```

TypeScript orchestrates and persists. The LLM (ai-service) writes the commercial copy. Heuristics are offline fallback only.

---

## Two pipelines

| Pipeline | When | Output |
|---|---|---|
| **Learn** | Configuration → Proposal patterns → Learn pattern | An approved `ProposalPlaybook` |
| **Generate** | Deal workspace, coworker, or `POST /api/sales/proposals` | A draft `Proposal` on a deal |

Learn never writes a deal proposal. Generate never clones the gold PDF as the answer.

---

## 1. Learn a pattern

### UI

`frontend/src/pages/ProposalPatternsPage.tsx`  
Route: `/configuration/proposal-patterns`

The user uploads **repeatable pair slots** (each slot is one BRD + one winning proposal). A single pair is the same as today’s two-file form. Confidence is scored by the `proposal-corpus-pair` LLM when both files are attached (`POST /api/configuration/proposal-patterns/pair-score`). If ai-service is down or the LLM returns nothing, the UI shows an error — it does not invent `0.00`. Below ~0.3 requires “use anyway”.

Files go to `POST /api/configuration/proposal-patterns/batches` (`pairs[]` or legacy `files[]`) with `startProcessing: true`. Status polls until the corpus job finishes. **Recently learned** lists filename, section count, content-playbook coverage, and Active / Learning / Failed.

There is **no pattern preview**. Proof that learning worked is the first generated proposal on a deal.

### Storage

On-disk under `data/proposal-corpus/{orgId}/{batchId}/` (`backend/src/lib/proposal-corpus-storage.ts`). Rows:

- `ProposalCorpusBatch` — one upload session
- `ProposalCorpusItem` — each file (`kind`: `requirement` \| `proposal`, `pairSlot`)
- `ProposalCorpusPair` — requirement ↔ proposal + confidence (`pairingSource`, `isVisualMaster`)
- `ProposalCorpusCaseStudy` — per-pair authoring analysis
- `ProposalCorpusJob` — stage machine
- `ProposalPlaybook` — frozen visual pattern (`contentPlaybookId` snapshot)
- `ProposalContentPlaybook` — org-level writing pattern (versioned)

### Job sequence

`backend/src/service/ai/proposal-corpus-job.ts`  
`corpusLearnAgentSequence()`:

1. `proposal-corpus-ingest`
2. `proposal-corpus-pair` (persists user-built slots; scores only if confidence was not submitted)
3. `proposal-corpus-extract`
4. `proposal-corpus-case-study` (per pair)
5. `proposal-playbook-synthesize` (org-level content playbook when ≥ 3 case studies)
6. `proposal-playbook-freeze` (visual master = highest pairing confidence; pins `contentPlaybookId`)

Enqueue: `POST /api/configuration/proposal-patterns/batches/:id/process` → `enqueueProposalCorpusJob`.

### Agents (Python, ai-service)

| Agent | File | What it does |
|---|---|---|
| **ingest** | `proposal_corpus_ingest_agent.py` | Parse PDF / DOCX / TXT to `fullText` (and layout hints when present). Word is extracted as text, not sent to Gemini as a fake PDF. |
| **pair** | `proposal_corpus_pair_agent.py` | LLM scores a user-built 1:1 slot (advisory). Repeatable-slot uploads are accepted regardless of score; below ~0.3 the UI requires “use anyway”. No heuristic relatedness fallback. |
| **extract** | `proposal_corpus_extract_agent.py` | Gemini reads the gold proposal: instance (cover, sections, tables), layout, theme tokens, logo. `source` must be `"ai"`. |
| **case-study** | `proposal_corpus_case_study_agent.py` | Per pair: how this BRD became this proposal (`sectionAnalysis` + `lengthAnalysis`). |
| **synthesize** | `proposal_playbook_synthesize_agent.py` | Org-level `ProposalContentPlaybook` (append-only versions). Floor: 3 case studies. |
| **freeze** | `proposal_playbook_freeze_agent.py` | Builds frozen **theme CSS** + **content template** + **skeleton HTML**. Pins `contentPlaybookId` to the latest org content playbook. |

If extract/freeze is not labeled AI, the job fails. There is no silent heuristic playbook.

### What gets frozen on the playbook

`createPlaybook` in the corpus job (status **`approved`** on success):

| Field | Holds |
|---|---|
| `sectionsJson` | Section keys, titles, intent, tone, `contentPattern`, optional `tableSpec` (column headers) |
| `tagsJson` | Format (cover style, fonts, colors, heading align) + content (section order, match tags) |
| `blueprint` | `{ mode: "playbook-template", html, css, tokens, coverLayout, frozenTheme }` |
| `assets` | Logo, tokens, cover layout, content template, `goldInstance` (structure only) |

**Copied into later proposals:** theme CSS, cover structure, section order/headings, table **columns**, logo.

**Not copied:** body copy, table cell values, prices, customer name, dates.

Comment in the job file: uploaded PDFs are training input only — never cloned as generated output.

### Failures you will see in Recently learned

- Same file used as both requirement and proposal
- Gemini could not read the upload as a PDF (retry; use PDF for the winning proposal if you need fonts)
- Extract/case-study/synthesize/freeze not AI-sourced
- Skeleton check: playbook has no visual template — retry learning

---

## 2. Generate a proposal for a deal

Every create goes through **`createProposalFromPlaybookCommand`**  
(`backend/src/service/sales/proposal-from-playbook-commands.ts`).

`createProposalCommand` (`POST /api/sales/proposals`) ignores `fromTemplate` / `templateId` and delegates here. Org-level `ProposalTemplate` rows are legacy and are not the generate path.

### Entry points

| Surface | What the user does | API |
|---|---|---|
| **Deal → Proposals** | Brief and/or attach BRD | `createProposalFromPlaybook` → `POST /api/sales/proposals/from-playbook` |
| **Coworker chat** | Attach BRD (paperclip) then ask to draft | Tool `propose_create_proposal` → `POST /api/sales/proposals` |
| **Proposal detail → Regenerate / personalize** | Re-run with the same playbook pinned | `POST /api/sales/proposals/:id/personalize` |
| **Section rewrite** | Edit one section in chat or UI | `POST /api/sales/proposals/:id/rewrite-section` |

Frontend helpers: `frontend/src/services/sales.ts`.

### Gates before the LLM writes

The command refuses to generate unless:

1. There is a **requirement** — BRD file (PDF / Word / text) and/or meeting notes on the deal. Coworker will **not** call `propose_create_proposal` until `requirementPdfAttached` is true.
2. The org has **at least one approved playbook**. Otherwise the error points at Configuration → Proposal patterns.

### Step-by-step generate

1. **Assemble requirement**  
   `composeProposalRequirement` labels meeting notes vs BRD so they are not mixed. Optional file is ingested with `proposal-corpus-ingest`; `fullText` is prepended.

2. **`proposal-requirement-profile`**  
   LLM JSON: themes, products, requested features, customer name, industry, constraints, deal-size band, summary. Used for matching and product scope — not as the proposal body.

3. **Select playbook**  
   `retrieveTopPlaybooks` then **`proposal-playbook-match`**. Low topical confidence does not block; a learned playbook is still chosen. Optional `playbookId` pins regenerate to the same pattern.

4. **Skeleton**  
   `skeletonFromPlaybook(sectionsJson)` — section keys/titles from the pattern (cover skipped as a body section).

5. **Product scope**  
   `resolveProposalProductScope` + catalog rows from **`inventory.products`**. Allowed product names are passed to generate. Mentions of SKUs outside that set are stripped (`gateProposalSectionsAgainstAllowedProducts`).

6. **Write sections**  
   If the org has a `ProposalContentPlaybook` with ≥ 3 case studies: `proposal-generate-section` runs one section at a time (learned spec, similar case studies, rolling recap; executive summary last). New proposals always use the **latest** content playbook; regenerate of an existing row uses the visual playbook’s pinned `contentPlaybookId`, or latest if that FK is null.  
   Otherwise today’s single `proposal-generate` call (up to 2 attempts) is unchanged.
   That fallback **probes product KB first** (~3s). If search is down it returns immediately
   (`kb_unavailable`) and Fastify does **not** retry — the user sees
   “Product catalog lookup is temporarily unavailable, try again shortly”.
   Empty hits are not a failure; only transport / 5xx / connect timeouts abort.
   Section-by-section generate does not call product KB today.

   After the model returns, code:

   - Fills commercial table prices from the catalog (`fill_commercial_table_prices`)
   - Scrubs invented prices
   - Applies frozen cover layout
   - Renders HTML with **frozen CSS** (`render_proposal_html` / `fillPlaybookTemplate`)

7. **Quality gate**  
   Must be `source: "ai"`, enough body text, no leftover placeholders. Failures are **not saved**.

8. **HTML validate**  
   `validateGeneratedProposalHtml` — required slots/sections present.

9. **Persist**  
   `createProposal` (or update when `replaceProposalId` is set for regenerate):

   - `sections` — customer-specific bodies (+ table rows)
   - `blueprint` — filled HTML + CSS, `playbookId`, `mode: "playbook-template"`
   - `customerName`, `title`, `summary`, `dealId`
   - `templateId` is **null**

### Copied vs regenerated

| Frozen from the winning proposal | New for this deal |
|---|---|
| Theme CSS (fonts, colors, spacing) | All section prose |
| Cover structure and alignment | Cover values (client, date, product tags) |
| Section order and headings | Table **cell** values |
| Table **column** specs | Prices from `inventory.products` |
| Logo | Requirement-specific facts |
| Slot structure (`data-slot`) | Allowed-product gating |

---

## 3. HTTP surface (Fastify)

Prefix: `/api/sales` (`backend/src/modules/sales/routes.ts`).

| Method | Path | Command |
|---|---|---|
| `POST` | `/proposals` | `createProposalCommand` → from-playbook |
| `POST` | `/proposals/from-playbook` | `createProposalFromPlaybookCommand` |
| `GET` | `/proposals/:id` | detail |
| `GET` | `/proposals/:id/pdf` | Playwright HTML → PDF |
| `GET` | `/proposals/:id/docx` | HTML → Word |
| `POST` | `/proposals/:id/personalize` | Full regenerate, playbook pinned |
| `POST` | `/proposals/:id/rewrite-section` | One-section LLM rewrite |
| `POST` | `/proposals/:id/patch-section` | Manual body patch |
| `POST` | `/proposals/:id/blueprint-html` | HTML document edit |
| `POST` | `/proposals/:id/patch-document-text` | Find/replace in older page-clone docs |

Learn APIs live under `/api/configuration/proposal-patterns/*`.

### Create body (from-playbook)

```ts
{
  dealId: string;
  requirementText?: string;
  title?: string;
  playbookId?: string | null;
  productHint?: string | null;
  productIds?: string[] | null;
  requirementPdfBase64?: string | null;
  requirementFilename?: string | null;
}
```

---

## 4. Python agents involved in generate

Registry: `ai-service/app/agents/__init__.py`. Called via `callAiServiceAgent(...)` from Fastify — TypeScript does not write the commercial copy.

| Agent id | Role on generate |
|---|---|
| `proposal-corpus-ingest` | Optional: turn the attached BRD into `fullText` |
| `proposal-requirement-profile` | Structure the ask before match |
| `proposal-playbook-match` | Choose which learned pattern to apply |
| `proposal-generate` | Whole-document fallback when no content playbook exists yet |
| `proposal-generate-section` | One section at a time when a content playbook is usable |
| `proposal-content-qa` | Post-assembly check vs section specs (`PROPOSAL_CONTENT_QA_MODE=shadow\|active\|off`) |
| `proposal-content` | Later edits: section rewrite / personalize helper — not the first draft |

**Coworker** (`proposal_coworker_agent.py` / deal coworker): proposes tools. It does **not** call `proposal-generate`. `backend/src/service/ai/coworker-agent-turn.ts` only loads deal/proposal context. The UI executes `propose_create_proposal` by posting to Fastify.

Registered but **not** in the live learn sequence: `proposal-corpus-structure`, `proposal-corpus-design-geometry`, cluster, `proposal-playbook-qa` (rule-only; content QA is `proposal-content-qa`).

---

## 5. After generate: view, edit, export

### On screen

Stored `blueprint.html` + `css` (`.proposal-doc` / playbook-template article with `data-slot` sections).  
Helpers: `backend/src/lib/proposal-doc-html.ts`, `backend/src/lib/proposal-playbook-layout.ts`.

### Section rewrite

`rewriteProposalSectionCommand` → `proposal-content` with deal context + meeting notes + the user’s instruction. Patches `sections` and syncs HTML.

### PDF

`backend/src/service/sales/proposal-pdf.ts` — Playwright Chromium. Print CSS/margins come from frozen `.proposal-doc` tokens via `backend/src/lib/proposal-export-layout.ts`. Optional letterhead stamp.

### DOCX

`backend/src/service/sales/proposal-docx.ts` — same prepared HTML/sections, Word buffer.

Export prep: `prepareProposalDocumentExport` in `proposal-commands.ts`.

---

## 6. Data the generator is allowed to use

| Source | Used for |
|---|---|
| Current BRD / meeting notes | What this customer asked for |
| Approved playbook | Look, section order, table headers |
| `inventory.products` | Names, descriptions, **prices** (DML only; no CRM schema on inventory) |
| Sales knowledge base | Capability language for allowed products |
| Deal / company / contact | Names, title, notes |

Not used as the answer: gold PDF body, previous draft prose on regenerate (`buildProposalRegenerateRequirement` rebuilds from meeting/deal facts only).

---

## 7. Limits of the current design

1. Generate is all-or-nothing — no “preview this playbook × this BRD” before save.
2. Freeze is **theme + skeleton**, not a pixel-perfect clone of the uploaded PDF.
3. Winning **PDF** learns fonts/layout; Word/text is mainly for requirement text.
4. User-declared pairs are accepted at any score (below ~0.3 needs “use anyway”). The old 0.65 auto-match reject does not apply.
5. Incomplete / placeholder / non-AI generate output is discarded.
   Product KB down is a separate fail-fast (`kb_unavailable`) — not a quality-gate timeout.
   Search always sends required `product_ids` as Context Layer slugs (`crm`, `contact-center`, …);
   inventory CUIDs are dropped. Empty hits are not a failure.
6. The model can mention extra SKUs; Fastify strips them.
7. Quote templates / `ProposalTemplate` are not this path.

---

## Code map

| Concern | Location |
|---|---|
| Learn job | `backend/src/service/ai/proposal-corpus-job.ts` |
| Content playbook lookup / length / retrieval | `backend/src/lib/proposal-content-playbook.ts` |
| Section orchestrator | `backend/src/service/sales/proposal-section-orchestrator.ts` |
| Generate command | `backend/src/service/sales/proposal-from-playbook-commands.ts` |
| Create / PDF / DOCX / personalize | `backend/src/service/sales/proposal-commands.ts` |
| Pattern split / product gate | `backend/src/lib/proposal-playbook-pattern.ts` |
| HTML fill / validate | `backend/src/lib/proposal-playbook-layout.ts` |
| Generate LLM | `ai-service/app/agents/proposal_generate_agent.py` |
| Generate-section LLM | `ai-service/app/agents/proposal_generate_section_agent.py` |
| Content QA LLM | `ai-service/app/agents/proposal_content_qa_agent.py` |
| Case-study LLM | `ai-service/app/agents/proposal_corpus_case_study_agent.py` |
| Synthesize LLM | `ai-service/app/agents/proposal_playbook_synthesize_agent.py` |
| Freeze LLM | `ai-service/app/agents/proposal_playbook_freeze_agent.py` |
| Prisma | `Proposal`, `ProposalPlaybook`, `ProposalContentPlaybook`, `ProposalCorpus*` in `prisma/schema.prisma` |
| Train UI | `frontend/src/pages/ProposalPatternsPage.tsx` |
| Deal UI | `frontend/src/components/sales/DealProposalsPanel.tsx` |
