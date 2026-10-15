# Proposal generation — what we changed (this machine)

This document explains the **proposal learn + generate** flow after the work done here, in three layers: **logic** (what the product should do), **technical** (how the pipeline actually runs), and **technology** (models, timeouts, logs). It then lists **files and functions** that implement those changes.

Product rules that did not change:

- Learn a **pattern** from BRD + winning-proposal pairs. Generate **fills** that pattern for **this** deal.
- Do **not** clone gold PDF x/y, gold body copy, or gold prices.
- List prices come from **`inventory.products`** (read/write existing columns only — no inventory DDL).
- Proposal **writing** is Gemini (Python agents). Coworker stays on the org LLM (Qwen). TypeScript only orchestrates and persists.

Existing product docs: [`proposal-generation.md`](proposal-generation.md), [`proposal-generation-workflow.md`](proposal-generation-workflow.md).

---

## 1. Logic (what “proper generation” means)

### 1.1 Two pipelines

| Pipeline | User action | Result |
|---|---|---|
| **Learn** | Configuration → Proposal patterns. Upload BRD + winning PDF slots. | One **approved playbook**: look (CSS/cover) + **section list/order** + table column names. Optional **content playbook** (writing lengths) if the org has ≥ 3 case studies. |
| **Generate** | Deal → generate proposal (BRD and/or meeting notes). | A **draft** on that deal: playbook slots filled with this customer, this catalog, this requirement. |

Learn never writes a deal proposal. Generate never pastes the uploaded gold PDF as the answer.

### 1.2 Who decides the sections

**Gemini does not invent the table of contents.**

1. Learning **freezes** chapter keys on the visual playbook (`sectionsJson` / `sectionOrder`).
2. Generate **matches one playbook** for this BRD.
3. `skeletonFromPlaybook` copies that list (cover is layout, not a body slot).
4. Gemini writes **body + table rows for each existing key**.

If you trained **two** patterns (e.g. 10 vs 20 sections), generate does **not** merge them and does **not** always pick the newest. It scores tags/themes/products against **this** BRD, then an LLM match picks **one** id. Recency is only a small tie-break. Pin `playbookId` to force a pattern.

### 1.3 Cover, tables, chrome

- Cover alignment follows gold as a **group** (`cover_align`: left / center / right), not cloned coordinates.
- Preview and PDF must use the **same** cover class (`cover-align-center` etc.).
- Tables only exist when the playbook has **real columns**. Do not invent Col 1 / Col 2 / Col 3 from bullets.
- Tiny gold customer sentences must not become a running header.

### 1.4 Prices

- Amounts in commercials must come from **catalog** (and quote **quantities**), not from gold PDFs and not invented by the model.
- The writer may leave price cells empty; **code** is supposed to fill catalog rates.

### 1.5 Time / reliability

- Do **not** send all 19 sections to Gemini in **one** JSON call (that caused 504 / Fastify abort).
- Default: **one Gemini call per section**. If one section times out, retry **that section once**, then `gemini_unavailable` — do not restart the whole proposal.
- Whole-document generate is **last resort** only if section mode itself failed (not after Gemini/KB unavailable).

---

## 2. Technical (how the code runs)

### 2.1 Learn job

`processProposalCorpusJob` (`backend/src/service/ai/proposal-corpus-job.ts`):

1. **ingest** — parse PDF/DOCX/TXT  
2. **pair** — persist user BRD↔proposal slots  
3. **extract** — Gemini reads gold instance (cover, sections, tables, theme)  
4. **case-study** — per pair: section + length analysis  
5. **synthesize** — org `ProposalContentPlaybook` only if **≥ 3** case studies  
6. **freeze** — skeleton HTML/CSS; visual master = highest pairing confidence  

Frozen: chrome, CSS, **section order**, table headers, logo. Not gold prose or gold rupees.

### 2.2 Generate job (current default)

`createProposalFromPlaybookCommand`:

1. Ingest this deal’s BRD / notes.  
2. Profile + **playbook match** (`retrieveTopPlaybooks` → `proposal-playbook-match`).  
3. Product scope from deal + `listProductsByIds` (`inventory.products`).  
4. **Writing playbook:** synthesized content playbook if usable; otherwise **stopgap** from skeleton keys (`contentPlaybookForSectionGenerate`). This is why generate no longer sits on `contentPlaybook: false` → whole-doc.  
5. **`generateProposalSectionsFromContentPlaybook`:** KB retrieve → plan word targets → write body sections (wave 1) → summary/overview last (wave 2) via `proposal-generate-section`.  
6. `composePricing` + `overlayCatalogPricingOnSections` on section JSON.  
7. Quality gate. Persist blueprint HTML. Optional PDF.

**Whole-doc `proposal-generate`:** only if section mode failed (`source !== "ai"`) and the reason is not `gemini_unavailable` / `kb_unavailable`.

### 2.3 Cover / table / chrome implementation

- PyMuPDF measures cover lines; **vote** → `cover_align`. Theme CSS emits `.cover-block.cover-align-*`. Export print CSS uses `!important` so leftover gold “title left” cannot win.  
- `usable_running_chrome`: short repeating header only (not a paragraph from the gold body).  
- `realTableColumns` / `tableRowsFromBody`: no fake 3-col from bullets.  
- `injectPlaybookTable`: if frozen HTML already has `<td>` rows, it **does not overwrite** them (this still matters for empty commercial cells).

### 2.4 Why tables can still miss prices

Catalog **is** loaded and composed (see logs). Overlay writes **section `tableRows`**. If `usedFrozenHtml: true`, save uses Gemini HTML + cover paint only — **not** `fillPlaybookTemplate`. Python `fill_commercial_table_prices` fills empty cells only when the **first cell name matches** a catalog product. Gold names (e.g. Worktual Voicebot) will not match “AI Native CRM”. V2 `{{price.line.n}}` often never ran (`actorUserId` BigInt vs String).

So proper **logic** is catalog-fill; **HTML persist** can still skip it. Check logs vs PDF until overlay is written into `<tbody>`.

### 2.5 Timeouts that we saw

| Layer | Budget | Failure |
|---|---|---|
| Gemini HTTP | 180s + client retries | `504 DEADLINE_EXCEEDED` on one huge JSON |
| Fastify `callAiServiceAgent` | 240s max | `TimeoutError` abort; Python may keep running |
| Old retry | 2× whole-doc when no content playbook | Two overlapping generates, interleaved logs |

Section path: per-section timeout → one retry → `gemini_unavailable`, stop remaining leaves.

---

## 3. Technology

| Concern | Choice |
|---|---|
| Orchestration | Fastify (`backend/src/service/sales/*`) |
| Agents / copy | Python ai-service (`ai-service/app/agents/*`) |
| Proposal writer model | Gemini (`proposal_gemini.py`, default `gemini-3.5-flash`) |
| Coworker / match LLM | Org `LLM_BASE_URL` (Qwen) |
| Layout measure | PyMuPDF (`proposal_pdf_parse.py`) |
| PDF export | Playwright + shared cover-align CSS |
| Product prices | `inventory.products` via Prisma map (`listProductsByIds`) |
| Logs | `.scripts/logs/api.log` (Fastify), `.scripts/logs/ai.log` (Uvicorn/Gemini) |

**Generate log markers**

- `[proposal-generate] playbook selected` — which pattern and `skeletonKeys`  
- `[proposal-generate] section writing playbook` — stopgap vs synthesized id  
- `[proposal-generate] section write start` / `ok` / `timeout` — per key  
- `[proposal-generate] catalog from db` / `catalog prices applied` / `proposal table money cells`  
- `[proposal-generate] html filled` — `usedFrozenHtml`  
- `V2 unavailable` — Prisma `actorUserId` type mismatch  

Restart Fastify after code changes so these paths load.

---

## 4. Files — what we changed in each

For every file: **what we changed** (behavior), then **functions** touched. Match/retrieve scoring was already in the repo; we did not rewrite it for this work.

### 4.1 Generate path (section-by-section default)

**`backend/src/lib/proposal-content-playbook.ts`**

- **Changed:** Synthesis still needs ≥ 3 case studies (`canUseContentPlaybook` / `resolveContentPlaybook` unchanged in meaning). Generate no longer requires that. Added a **stopgap writing playbook** from visual skeleton keys so section generate always has specs/word floors. Attempt count is always “section pass + optional whole-doc last resort” (not “two whole-doc calls when playbook is missing”). Added timeout-reason helper for per-section abort.
- **Functions:** `resolveContentPlaybook` (unchanged rule), **new** `stopgapContentPlaybookFromSkeleton`, **new** `contentPlaybookForSectionGenerate`, `proposalGenerateAttemptCount` (now always 2 max, first pass is sections), `shouldRetryWholeDocumentGenerate`, **new** `isAiServiceTimeoutReason`.

**`backend/src/service/sales/proposal-from-playbook-commands.ts`**

- **Changed:** Stopped the `if (contentPlaybook) orchestrator else whole-doc proposal-generate` split. Always builds `writingPlaybook`, always calls `generateProposalSectionsFromContentPlaybook`. Whole-doc `proposal-generate` runs **once** only if section mode itself failed (not Gemini/KB unavailable). Quality gate **no longer** `continue`s to restart the whole generate. After `listProductsByIds`, logs catalog rows, composed prices, and table money cells so you can map DB → draft.
- **Functions:** `createProposalFromPlaybookCommand` (generate loop), `skeletonFromPlaybook` (existing; still the TOC source), **new** `compactCatalogProductForLog`, **new** `pricingTableCellsForLog`. `selectLearnedPlaybookId` was already here (which playbook id to keep).

**`backend/src/service/sales/proposal-section-orchestrator.ts`**

- **Changed:** `generateOneSection` used to treat a timed-out HTTP call (`null`) as an empty heuristic section and keep writing the rest. Now: timeout/`null` → **retry that section once** → still fail → `gemini_unavailable` so `writeWave` **stops remaining sections**. No full-proposal restart from one leaf timeout.
- **Functions:** `generateProposalSectionsFromContentPlaybook` (caller already looped skeleton; still does), **`generateOneSection`** (timeout retry), `writeLeaf`, `writeWave`.

Agents used on this path: `proposal-kb-retrieve`, `proposal-generate-section`, `proposal-content-qa`. Last-resort only: `proposal-generate`.

### 4.2 Cover, tables, chrome

**`ai-service/app/agents/proposal_pdf_parse.py`**

- **Changed:** Cover alignment is a **group vote** (`_cover_chrome_align`), not leftover per-line CSS. `usable_running_chrome` rejects long gold body lines (e.g. a customer sentence) so they are not learned as a repeating header. `compile_theme_css` emits unified `.cover-block.cover-align-*` and can override leftover title-left.
- **Functions:** `_cover_chrome_align`, `usable_running_chrome`, `compile_theme_css`.

**`ai-service/app/agents/proposal_schemas.py`**

- **Changed:** Added `cover_align: left | center | right` on cover/layout types so freeze + generate share one field.

**`ai-service/app/agents/proposal_layout.py`**

- **Changed:** Merge/propagate `cover_align` from gold/frozen cover into layout tokens. Commercial helpers still scrub invented money and fill **empty** catalog-matched cells (`scrub_invented_prices`, `fill_commercial_table_prices`). `content_to_crm_sections` still maps Gemini JSON onto the **playbook skeleton** (does not invent TOC).
- **Functions:** cover merge (`cover_align`), `scrub_invented_prices`, `fill_commercial_table_prices`, `content_to_crm_sections`.

**`ai-service/app/agents/proposal_render_html.py`**

- **Changed:** Cover HTML gets `cover-align-*` on the cover-block so preview and PDF share one class.

**`ai-service/app/agents/proposal_playbook_freeze_agent.py`**

- **Changed:** Persist `cover_align` on freeze. Blank header/footer when chrome is not usable (stops gold body leaking into running chrome).

**`backend/src/lib/proposal-playbook-layout.ts`**

- **Changed:** Infer/stamp `cover-align-*` from frozen layout/CSS (`coverAlignFromLayout`, `inferCoverAlign`, `applyCoverAlignClass`, `applyPlaybookCoverHtml`). **Stop inventing 3-column tables from bullets** (`realTableColumns`, `tableRowsFromBody`). Strip unusable section chrome headers. `fillPlaybookTemplate` injects real table rows into empty tbodies.
- **Functions:** `coverAlignFromLayout`, `inferCoverAlign`, `applyCoverAlignClass`, `realTableColumns`, `tableRowsFromBody`, `fillPlaybookTemplate`, `applyPlaybookCoverHtml`, chrome-strip helpers.

**`backend/src/lib/proposal-export-layout.ts`**

- **Changed:** PDF/print path uses the **same group cover align** and print CSS `!important` on `.cover-align-*` so PDF is not stuck left while preview is centered.
- **Functions:** `coverAlignFromHtml` / group cover title align, print cover-align CSS.

**`backend/src/lib/document-blueprint.ts`**

- **Changed:** Viewer CSS for cover-align. `injectPlaybookTable` fills only **real** columns; if frozen HTML already has `<td>` rows it **leaves them** (so gold/empty commercial cells can survive — still an open gap).
- **Functions:** `injectPlaybookTable`, cover-align viewer CSS.

**`frontend/src/components/documents/DocumentBlueprintView.tsx`**

- **Changed:** Preview uses the same table/cover/chrome rules as PDF (no Col 1/2/3 from bullets; apply cover-align class).

### 4.3 Catalog pricing (compose + log; HTML inject still incomplete)

**`backend/src/dao/products/product-crm-service.ts`**

- **Not rewritten for this work.** Generate already calls `listProductsByIds`. We **log** those rows; we did not change inventory schema.

**`backend/src/service/sales/proposal-pricing.ts`**

- **Mostly existing.** `composePricing` builds catalog tokens/lines. `overlayCatalogPricingOnSections` writes rates into **section `tableRows`** (price columns / empty commercial tables). We did not change this to overwrite frozen HTML.
- **Functions:** `composePricing`, `overlayCatalogPricingOnSections`.

**`backend/src/service/sales/proposal-from-playbook-commands.ts`** (pricing logs)

- **Changed:** After catalog load: `[proposal-generate] catalog from db`. After overlay: `[proposal-generate] catalog prices applied` and `[proposal-generate] proposal table money cells`.

**`ai-service/app/agents/proposal_generate_agent.py`**

- **Existing whole-doc finalize:** `_finalize_generated` still scrubs unknown money then `fill_commercial_table_prices` then `render_proposal_html`. Prompts still say do not invent prices. This path is **last resort** now, not the default.

### 4.4 Tests we added or extended

| File | What we changed in the test |
|---|---|
| `backend/src/lib/proposal-playbook-layout.test.ts` | Assert cover-align class on fill; reject fake 3-col from bullets |
| `backend/src/lib/proposal-export-layout.test.ts` | Assert PDF/print cover-align |
| `backend/src/lib/proposal-content-playbook.test.ts` | Stopgap playbook when &lt; 3 studies; attempt count is section + last-resort whole-doc |
| `backend/src/service/sales/proposal-section-orchestrator.test.ts` | 503 stops later sections; **null timeout retried once** then `gemini_unavailable` |
| `backend/src/service/sales/proposal-pricing.test.ts` | Catalog compose / overlay (existing suite, pricing behavior) |
| `ai-service/tests/test_proposal_generate.py` | Cover-align CSS; scrub/fill commercial cells |

### 4.5 Diagnosed, not patched in the section-default change

| File | What we found (not what we rewrote here) |
|---|---|
| `backend/src/lib/proposal-playbook-retrieve.ts` | `scorePlaybook` / `retrieveTopPlaybooks` already pick among patterns (tags + small recency). Unchanged. |
| `backend/src/dao/sales/proposal-generation-run.ts` | Prisma `actorUserId` as BigInt vs String → V2 create fails → “V2 unavailable, using sync legacy path” |
| `backend/src/service/sales/proposal-v2-hooks.ts` | Would inject `{{price.line.*}}` if V2 ran |
| `ai-service/app/services/proposal_gemini.py` | Gemini HTTP timeout 180s + retries can exceed Fastify 240s on whole-doc |

---

## 5. Still open

1. Persist catalog rates into **frozen HTML** commercial `<tbody>` (or stop `usedFrozenHtml` for pricing tables).  
2. Fix V2 `actorUserId` so `{{price.line.*}}` can substitute.  
3. If whole-doc fallback still runs, cap Gemini retries so they cannot exceed Fastify’s abort.  

---

## 6. How to check a generate

1. Restart the API.  
2. Grep `.scripts/logs/api.log` for `playbook selected`, `section writing playbook`, `section write start`, `catalog from db`.  
3. You should see **one write per section**, not a first-pass whole-doc `proposal-generate`.  
4. Map catalog log names/amounts onto the commercial table by **catalog product name**.  
