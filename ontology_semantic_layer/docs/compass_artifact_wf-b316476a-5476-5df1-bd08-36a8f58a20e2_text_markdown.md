# Adding Governed LLM Reasoning to Worktual's Ontology Steward: Models, Guardrails, Evaluation, Repo Layout and Agent Context

**Bottom line:** Keep the steward's deterministic pipeline as the backbone. Use an LLM only as a closed-set, schema-constrained *judge/oracle* on the proposals the deterministic stages are uncertain about. This is the same design that took LogMapLLM to #2 of 10 systems in the OAEI 2025 bio-ml track, for well under a cent per call. A mid-tier model (Gemini 2.5 Flash / GPT-5.x-mini class, or a fine-tuned Qwen3 8–32B for BFSI data residency) with constrained decoding is enough. Frontier reasoning models are not the bottleneck: your golden set, abstention thresholds and approval UX are.

## TL;DR

- **Models and strictness:** The strongest published LLM ontology systems put an LLM on top of classical retrieval and matching: retrieve top-k candidates, then have the LLM pick one, validate one, or reject. Cheap models (Gemini 2.5 Flash, GPT-4o-mini, Llama-3.3-70B) do well in this role, and reasoning modes give small or negative gains on simple classification. Enforce outputs with provider structured outputs or xgrammar/llguidance, restrict answers to an enum of candidate IDs plus `reject`, and route by calibrated confidence. Never let the LLM's own number be the gate.
- **Evaluation and governance:** Build a versioned golden set scored with OAEI-style precision/recall/F1 plus abstention metrics. Treat prompts and model IDs as versioned artifacts that must be re-run against the golden set before any upgrade. Apply changes through a branch → shadow → approve → merge flow modelled on Palantir Foundry ontology proposals. Measure reviewer approval rate, edit rate, time-to-decision and Cohen's kappa.
- **Repo and agent context:** At your team size, use one repo (a uv workspace) with three independently deployable packages: pipeline, ontology API, steward. Add a *published, versioned ontology contract package* that the CDC pipeline pins and the API/steward track. Serve product agents a role-scoped slice plus on-demand discovery tools, not the full ontology. Schema-filtering evidence shows the gains are largest for smaller models and always reduce cost, but recall of the needed elements matters more than precision.

## Key Findings

1. **LLMs win in ontology matching as validators of uncertain candidates, not as free generators.** LogMapLLM calls the LLM only on the subset of mappings LogMap is uncertain about. It reached top-2 overall in the OAEI 2025 bio-ml track (overall F 0.751 vs 0.718 for plain LogMap) using Gemini 2.5 Flash with a natural-language prompt that includes synonyms. The authors (Lushnei, Jiménez-Ruiz et al.) report that at 100–250 input tokens per request, the average cost per 1,000 requests ranged from about $0.01 to $0.04, with a total experimental budget under $50. **(Well-evidenced; peer-reviewed, EACL 2026.)**
2. **No single LLM dominates ontology work.** In the OAEI 2025 bio-ml track, BioGITOM had the best F1 in 3 of 5 semi-supervised tasks, with BERTMap and LogMap-LLM each leading one. In the unsupervised setting, LogMap-Bio and LogMap-LLM each led two tasks. In OntoAligner-Ensemble (2026), a Qwen3.5-9B RAG aligner hit the best F1 of 42.2% on MI–MatOnto, while GPT-5.4's precision swung from 40.2% to 93.3% across tracks. **(Well-evidenced: model rank is task-dependent, so benchmark on your own data.)**
3. **Small plus large beats large alone for schema matching.** Magneto (VLDB 2025) uses a small fine-tuned retriever plus an LLM reranker. Llama-3.3-70B beat GPT-4o-mini as reranker (MRR 0.837 vs 0.815), and pairing it with a fine-tuned MPNet retriever gave the best MRR of 0.860. **(Well-evidenced.)**
4. **Reasoning modes rarely pay for closed-set classification.** TextReasoningBench found CoT/SC-CoT give roughly +1–3% on large models, while ToT/GoT often fail to beat direct answering at up to ~10× the tokens. A sentiment study found reasoning degrades binary classification by up to 19.9 F1 points but helps 27-class tasks by up to 16.0 points, at 2.1×–54× compute. **(Moderately well-evidenced; not ontology-specific.)**
5. **Constrained decoding removes format failures and does not hurt, and may help, classification.** JSONSchemaBench (Geng et al.: 10K real-world JSON schemas in 10 datasets, tested on Guidance, Outlines, llama.cpp, XGrammar, OpenAI and Gemini) found constrained decoding slightly *improves* task accuracy, e.g. GSM8K 80.1% → 83.8% with Guidance. The "Let Me Speak Freely" paper itself found JSON-mode *enhances* classification accuracy even as it hurt reasoning, and its reasoning result was disputed by the .txt team's rebuttal. **(Well-evidenced for format reliability; the accuracy effect is small either way.)**
6. **Schema context:** Neo4j's own Text2Cypher schema-filtering study found filtering helps smaller models most, larger models benefit less, and filtering always cuts cost. Text-to-SQL work shows missing a single required element tanks accuracy, so linkers must optimise recall. **(Well-evidenced.)**

## 1. Model Selection for Ontology Work

**Recommendation:** Run a two-tier setup.
- **Tier A, the default oracle:** a cheap, fast, structured-output-capable hosted model (Gemini 2.5 Flash class, or a GPT-5.x-mini/nano class model) for Understander/Aligner/Taxonomist adjudication on uncertain items.
- **Tier B, the BFSI and on-prem option:** Qwen3-8B/14B/32B served on vLLM with xgrammar or llguidance. Fine-tune it on your approved-proposal history once you have roughly 1–2K labelled decisions.
- **Escalation:** use a frontier model (Claude Opus/Sonnet 4.x, GPT-5.x, Gemini 3 Pro) only for new_class proposals and relation proposals from transcripts, where free-text understanding matters most.

### What the ontology-specific evidence says

**OAEI 2025 (bio-ml and related tracks).**
- **LogMapLLM** (code: `github.com/city-artificial-intelligence/logmap-llm`):
  - The authors tested 30 LLM-prompt combinations (GPT-4o Mini and Gemini Flash 1.5/2.0/2.0-Lite/2.5) across nine OAEI tasks. They also tried Mistral Small, Llama-3-70B and Qwen3 1.7B/8B on anatomy; the authors report the open-weight Mistral and Llama models "showed poorer performance and slower response times."
  - Gemini 2.5 Flash with the P_S^NLF prompt was best, averaging a Youden's index of 0.550 (sensitivity 0.822, specificity 0.728) on the uncertain sets across the nine tasks, against 0.094 for LogMap's own diagnosis of those same mappings; the authors note that YI values "above 0.5" are generally considered good.
  - They used a structured Boolean output with retry on parse failure.
  - Running Qwen3-8B locally on a laptop took more than 125 s per request. This is a deployment-cost warning, not a quality result.
- **Agent-OM** first entered OAEI in 2025 with two variants: a "production" variant on commercial LLMs and a "lite" variant on open-source LLMs, across eight tracks.
- **Common design:** the paper surveys OLaLa, LLMs4OM, MILA, Agent-OM, KROMA and HybridOM. Their shared technique is to "use retrieval methods to select top-k candidates for each entity, then [ask] the LLM to select the best among these candidates". This is exactly the closed-set pattern you want.
- **Non-LLM baselines are still competitive.** BERTMap, BioGITOM and LogMap-Bio remain top performers, so an embedding-plus-lexical stage (your bge/Qwen3-Embedding) should stay the first pass.

**OntoAligner / LLMs4OM** (`github.com/sciknoworg/OntoAligner`).
- The toolkit showed a Qwen2-0.5B model performing well against OLaLa running Llama-2-70B on several datasets.
- Its 2026 ensemble paper found RAG aligners using Qwen3.5-9B, GPT-5.4-Nano and Gemini 2.5 Flash-Lite each win on different tracks. The KGE aligner reached 100% precision but only 9.2% recall on some tasks.
- Takeaway: ensembling or voting across heterogeneous matchers is a legitimate way to raise precision.

**LLMs4OL 2025** (ISWC; term typing, taxonomy discovery, non-taxonomic relations, Text2Onto).
- The organisers' overview (Babaei Giglou et al., 2025) reports 11 participating teams and approximately 1,000 submissions across 26 subtasks.
- The organisers' conclusion: "hybrid pipelines integrating commercial LLMs with domain-tuned embeddings and fine-tuning approaches achieved the strongest overall performance". LLMs are strong at term typing and taxonomy discovery, and non-taxonomic relation extraction "remained the most challenging".
- For you, this means entity-vs-attribute typing of `custom_fields` keys is the *easy* case. Relation proposals mined from transcripts (source c) are the *hard* case and should always go to a human.

**Schema matching** (the closest analogue to BFSI schemas shared without data).
- Magneto's result is above: small retriever plus LLM reranker, with Llama-3.3-70B edging GPT-4o-mini.
- Matchmaker found a compositional GPT-3.5 program matched a single-stage GPT-4 (ReMatch). Pipeline design can buy roughly a model generation.

**Text2Cypher.**
- Neo4j's 2024 benchmark found GPT-4o and the fine-tuned `tomasonjo_text2cypher` model tied at about 30% exact-match on execution-based evaluation. Neo4j notes the metric is very strict.
- SynthCypher reports fine-tuning Llama-3.1-8B, Mistral-7B and Qwen-7B on synthetic data improves Text2Cypher by up to 40%.
- CypherBench reports GPT-4o at 60.18% execution accuracy and no open-weights model under 10B above 20%.
- Implication: for *query generation* against your graph, small models need fine-tuning. For *classification*, they are close enough.

### Small vs frontier, and the cost ratio

For constrained classification and validation with retrieval, the gap is small and pipeline-dependent. Llama-3.3-70B beat GPT-4o-mini in Magneto; Qwen3.5-9B won a track in OntoAligner-Ensemble. For open-ended generation (Cypher, relation extraction), the gap is large unless you fine-tune. Cost: LogMapLLM's table shows Gemini 2.0 Flash at $0.10/$0.40 per million input/output tokens against Llama-3-70B on Bedrock at $2.65/$3.50. That puts the hosted "Flash" tier roughly 15–25× cheaper per request than a hosted 70B open model. Self-hosting on your own GPU changes this math. **(Well-evidenced numbers; the ratio is our derivation from their table.)**

### Reasoning models

Your task (pick one of about 20 classes, or reject) is simple classification. The evidence says reasoning adds 0–3 points at 2–50× cost and can hurt binary decisions. "Reasoning's Razor" (2025) found reasoning raises accuracy but can *hurt recall at low-false-positive operating points*, which is exactly the regime of a high-precision auto-apply gate. **Recommendation:** thinking off for Tier A classification. Enable reasoning only for new_class and relation proposals, and A/B it on your golden set.

### Structured output reliability

- **JSONSchemaBench** (arXiv 2501.10868) evaluated Guidance, Outlines, llama.cpp, XGrammar, OpenAI and Gemini. A secondary summary of the paper reports that schema complexity drives coverage from about 86% on simple schemas to about 3% on the hardest, and that no engine covers all JSON Schema features. *Treat these as secondary figures.*
- **Practical rule:** keep the Proposal schema flat. Use enums, `required`, and no `oneOf`/recursive `$ref`, and it will compile on every engine.
- **vLLM/SGLang:** SqueezeBits' benchmark found llguidance had zero timeouts but more compile failures, while XGrammar compiled more schemas but timed out on complex ones.
- **Hosted providers:**
  - OpenAI Structured Outputs launched in August 2024.
  - Anthropic added constrained decoding in November 2025. Before that, tool-use JSON was best-effort.
  - OpenAI has credited llguidance as foundational to its implementation (secondary source).
- **Field naming matters.** Instructor's September 2024 blog post "Bad Schemas could break your LLM Structured Outputs" reports that renaming `potential_final_choice`/`final_choice` to `potential_answers`/`final_answer` improved accuracy from 4.5% to 95%, and that JSON mode showed 50% more performance variation than tool calling. This is vendor-reported; verify on your own task. Put a short `rationale` field *before* the `decision` field so the model "thinks" inside the schema without a reasoning mode.

### LLM-as-judge model choice

Use a *different model family* from the proposer for the validator. Self-preference bias is well-documented, and larger models often show stronger self-preference. Where stakes are high, use a small jury of diverse models (Verga et al., "Replacing judges with juries") rather than one large judge.

## 2. Making the Agents Strict and Governed

**Recommendation:** the LLM never writes YAML. It fills a Pydantic `Proposal` model whose `decision` enum and `target_id` enum are generated per call from the retrieved candidate set, plus `reject`/`no_op`. Deterministic code (validator, applicator) turns approved proposals into YAML diffs.

1. **Closed-set, retrieval-grounded classification.** For each unmapped key:
   - Retrieve top-k (k ≈ 10–20) candidates from core.yaml, the active domain pack, types.yml and the Google/Shopify taxonomies using your Qwen3 embeddings.
   - Pass the candidates *with IDs, definitions, parents and synonyms*. LogMapLLM's best prompt included synonyms and one parent level.
   - Build the JSON Schema enum dynamically so the model *cannot* emit an ID outside the set. `new_term`/`new_class` must also reference a parent ID from the set.
   - This is the OLaLa/LLMs4OM/MILA pattern, and it also matches the LLMs4OL 2026 "vocabulary-constrained filtering" approach.
2. **Constrained decoding everywhere.** Use provider structured outputs for hosted models and vLLM guided decoding (xgrammar or llguidance backend) for Qwen. Keep retry-on-parse-failure as a belt-and-braces measure, as LogMapLLM did.
3. **Confidence and abstention. Do not trust the raw verbalized number.**
   - A 2026 study found vanilla verbalized confidence is extremely sparse: 92% of values collapse onto a few round numbers. Taking the expected value over digit-token logprobs ("verbalization logprobs") fixed the sparsity and improved AUROC by 0.9 over vanilla verbalization and by 4.7 over token logprobs.
   - Another 2026 study found verbal confidence AUROC of only 0.53–0.60, against 0.63–0.75 for calibrated logprobs. A third found reported confidence tracks the model's *commitment* more than correctness.
   - A counterpoint: on post-2025 frontier judges, a well-designed verbalized-confidence recipe beat logprob-based G-Eval.
   - **Practical recipe:** build a composite score from retrieval margin (top-1 vs top-2 similarity), logprob of the chosen enum token where available, agreement across 3 samples or 2 model families, and deterministic checks (type compatibility, naming rules). Then **calibrate it with isotonic regression on your golden set** and set the auto threshold for a target precision (e.g. ≥98%), not a fixed 0.9.
4. **Self-consistency.** For classification, n=3–5 votes typically buys only +1–3 points (TextReasoningBench), so use it *selectively*: on items in the uncertainty band, and as a disagreement signal feeding the calibrator. The extra calls are cheap at Flash-tier prices (about $0.01–0.04 per 1,000 calls).
5. **LLM-as-judge biases and mitigations.**
   - **Position bias** is systematic (Shi et al., IJCNLP-AACL 2025). Shuffle candidate order across samples and swap-and-average for pairwise checks.
   - **Self-preference:** use a different family for the judge.
   - **Verbosity bias:** judge against a rubric, not free-form rationales.
   - **Anchoring:** a 2026 study found prior scores shown to a judge compromise its independence. *Do not show the steward's confidence or decision to the validator.*
6. **Frameworks, and what we would pick:**

| Tool | Role in your pipeline | Verdict |
|---|---|---|
| Pydantic + Instructor or Pydantic AI | Typed Proposal I/O, retries, provider abstraction | **Use** (core) |
| vLLM guided decoding (xgrammar / llguidance), Outlines | Token-level enforcement for self-hosted Qwen | **Use** for Tier B |
| DSPy | Prompt/program optimisation against your golden set | **Consider** once the golden set is ≥500 items; it treats prompts as compiled artifacts |
| BAML | Schema-first prompt functions with codegen and tests | Good alternative to Instructor if you want prompts-as-code files; pick one, not both |
| Guardrails AI | Validators library (regex, PII, etc.) | Optional; your validator module already does this deterministically |
| NeMo Guardrails | Dialogue/rail flows for conversational agents | **Skip** for the steward (batch classification); maybe for product agents |

*(The table is practitioner judgment based on each tool's scope, not benchmarked.)*

7. **Prompt and version discipline.** Meta's AURA paper describes database-backed, versioned prompt templates with rollback. Because "model-version changes can affect prompt formatting and baseline distributions," they "re-evaluate them against historical baselines before upgrades". A named human owns every change. Copy this:
   - Store `prompt_id@version`, `model_id@snapshot`, `decoding_config`, `candidate_set_hash` and `ontology_version` on every Proposal.
   - Pin dated model snapshots, never `-latest`.

## 3. Evaluation Harness

**Recommendation:** a golden set, a CI eval job and a reviewer-metrics dashboard, built before the first LLM call goes to production.

- **Metrics (OAEI methodology).** Precision = |M_S ∩ M_RA|/|M_S|, Recall = |M_S ∩ M_RA|/|M_RA|, F1. Bio-ml adds *local ranking* (MRR, Hits@1/5/10) for candidate selection.
  - For the steward, report per decision class (reuse / new_term / new_class / reject / no_op): P/R/F1 plus a confusion matrix.
  - For retrieval, report Hits@k (did the right target make the candidate set?).
  - For the gate, report **selective metrics**: precision at the auto threshold, coverage (the share auto-approved), and AUROC/ECE of the calibrated score.
  - For the LLM-as-oracle component, LogMapLLM's **sensitivity/specificity/Youden's index** is a good diagnostic.
- **Building the golden set.**
  - (1) Harvest every historical deterministic decision and every human decision from existing overlays (org1000–1007) as silver labels.
  - (2) Stratify by source (custom_fields, BFSI schema, transcript, capability endpoint), by domain pack and by difficulty. Deliberately include *adversarial negatives*: PII-like keys, near-synonyms that must NOT merge, and tenant-specific terms that must stay in the overlay.
  - (3) Have two reviewers label a 200–300 item core independently, measure Cohen's kappa, and adjudicate.
  - (4) Keep a hidden held-out split that is never used for prompt tuning or DSPy optimisation.
  - The OAEI caveat applies: reference alignments "may not be perfect" and bio-ml's references come from public resources, so record label provenance.
- **Regression testing.** Run the full golden set in CI on any change to prompt, model snapshot, candidate retrieval, embedding model (your bge → Qwen3-Embedding migration counts), or ontology version. Diff at the *item level*, not just aggregate F1, and fail the build on any regression in precision at the auto threshold. Keep a "canary" set of about 50 historically flipped items.
- **Human-in-the-loop efficiency.** Track:
  - approval rate per decision class and per confidence bucket (this is your calibration check in production);
  - edit rate (approved with modification);
  - median time-to-decision and queue age;
  - reviewer agreement (Cohen's kappa for pairs, Fleiss' kappa for more reviewers) on a 5–10% double-reviewed sample;
  - post-approval reversal rate.
  - If approval rate in the top confidence bucket stays above the target precision for about 4 weeks, widen auto-apply for that class. Atlan describes the same "trust accrues from clean shadow-mode runs and audit history" principle. *(Thresholds are practitioner recommendations.)*

## 4. Monorepo vs Separate Repositories

**Recommendation (practitioner consensus; no controlled studies exist):** at your size (likely fewer than 20 engineers), use **one repository, a uv workspace with separate packages and separate deploy pipelines**:
- `pipeline/` (router, writer, DLQ)
- `ontology-contract/` (YAML plus the loader, validators, generated Pydantic types and JSON Schema)
- `ontology-api/`
- `steward/`
- `evals/`

The key move is to **publish `ontology-contract` as a versioned package or artifact** (semver, derived from `pack_version`/`requires_core`) so each service pins it independently.

- **Why not polyrepo now:** the contract changes in lockstep with loader code, validators and evals, and atomic PRs across contract, API and steward are valuable while the ontology is evolving fast. Doppel's 2026 write-up on moving to uv workspaces reports 30–70% build/deploy time reductions, with some services dropping from 10+ minutes to under 4 minutes to deploy, and a single lockfile giving reproducibility and a reliable feedback loop for agentic tooling.
- **Avoiding deployment coupling:**
  - Separate CI workflows triggered by path filters.
  - Separate container images and release tags per package.
  - The pipeline consumes the contract *at a pinned version*, never HEAD. A fast-moving API or steward then cannot break sub-second CDC.
  - Ontology changes land in the contract first, then roll out to the API/steward, then the pipeline bumps its pin after shadow validation.
  - The same pattern appears at Accor's data platform: separate team repos on a shared Airflow cluster, "independent deployments: Project A's release shouldn't block or require Project B," and CI under 2 minutes. Their answer at 80+ engineers was polyrepo *with* a shared platform, which is consistent with the thresholds below.
- **Schema distribution options, ranked for you:**
  1. Versioned package, with contract tests in each consumer. Recommended.
  2. Ontology served at runtime from the ontology API with version negotiation. Add later for product agents.
  3. A schema-registry-style artifact store: an S3/OCI artifact of compiled YAML plus a hash, which the pipeline hot-loads with an allow-list of versions.
  4. **Avoid git submodules**: pin drift and poor CI ergonomics (practitioner consensus).
- **Build tooling:**
  - uv workspaces plus path-filtered CI are enough at your size. Una fills the gap of building deployable apps from uv workspaces.
  - Pants is the best-fit "real" build system for Python-heavy monorepos (dependency inference, git-changed-only runs).
  - Bazel is justified mainly for large polyglot repos needing hermetic remote execution.
  - Nx/Turborepo are JS-centric; skip them.
  - Consider Pants only when CI time per PR exceeds about 10–15 minutes despite path filtering. *(Practitioner opinion.)*
- **When the answer changes:** split `pipeline/` into its own repo when a separate on-call team owns it, or when its compliance boundary (BFSI) demands separate access control. The contract package design makes that split cheap. Rough thresholds (practitioner opinion): below about 15 engineers, monorepo; 15–50, monorepo with Pants/CODEOWNERS or split by team; above 50, per-team repos plus a platform contract, as at Accor.
- **Latency-critical vs request/response vs batch LLM.** Share code, not runtimes:
  - The pipeline gets its own image, minimal dependencies (no LLM SDKs), and its own SLOs and alerts.
  - The steward runs as a batch/queue worker whose only write path into production is a *proposal record*, never a direct graph write.

## 5. Architecture for LLM-Driven Ontology Evolution

**Recommendation:** adopt a **Foundry-style proposal lifecycle** on top of your YAML layers:

detect → propose (LLM + deterministic) → validate (deterministic + independent LLM judge) → **branch** (YAML diff in a proposal branch) → **shadow apply** (a staging Neo4j database per affected org, e.g. `org1003_shadow`, replaying a sample of recent CDC events) → human approve → merge → version bump → applicator → post-merge monitoring.

- **Documented production precedents:**
  - **Palantir Foundry** treats an ontology proposal as "analogous to a Pull Request". Changes happen on a branch, reviewers approve or reject *per modified resource*, and protected main cannot be edited directly. Object types are indexed on the branch so their data can be previewed before merge. Foundry's legacy docs warn that "proposals cannot be reverted automatically. To undo a proposal, you must undo the different changes within it." Build a *reversible* applicator: every applied proposal emits an inverse diff.
  - **Meta's AURA**: agents are read-only against production data, code changes happen in sandboxed clones, and a named human owns every shipped change.
  - Atlan's 2026 guidance: mutating actions such as schema changes need approval gates, and autonomy expands only after clean shadow-mode runs. *(Vendor guidance.)*
  - We found **no published production case study** of an LLM proposing ontology changes at scale with measured approval rates. Treat your system as novel and instrument it accordingly.
- **Shadow application and rollback:**
  - Apply the candidate overlay to a shadow database and replay the last N hours of the org's CDC topic.
  - Diff node/relationship counts, derived_labels, metrics outputs and Text2Cypher golden-query results against production.
  - Reject if any existing mapping changes meaning. Your "overlay may only ADD" rule is the right invariant; extend it to "a proposal may not change the resolution of any previously-bound key".
  - Roll back via the inverse diff and a version pin revert.
- **Preventing drift and bloat:**
  - (1) **Usage-based decay.** Every tenant term carries `created_by_proposal`, `last_seen_in_data` and a query-hit count. Terms unseen for 90–180 days enter a deprecation proposal. Salesforce's per-object caps show why this matters: 500 custom fields on Enterprise and 800 on Unlimited, which Support will not raise.
  - (2) **Promotion.** When ≥3 tenants in the same domain pack independently approve equivalent terms (via embedding plus steward reuse match), open a promotion proposal from the overlay to the domain pack. Promotion to core requires ≥2 domain packs.
  - (3) **Reuse-first bias.** The steward must show the nearest existing terms and justify why `reuse` was rejected before proposing `new_term`.
  - (4) **Hard quotas** per org overlay (e.g. max new classes per quarter).
  - (5) **Semantic drift check.** Re-embed definitions on every version and flag terms whose definition embedding moved beyond a threshold. *(Items 2–5 are practitioner recommendations.)*
- **Multi-tenant extension precedents:**

| Platform | Extension mechanism | Governance / limits |
|---|---|---|
| Salesforce | Custom objects and fields on standard objects | Custom fields per object capped by edition (Enterprise 500, Unlimited 800) plus separate managed-package allowances; hard per-object caps; cannot be raised by Support |
| Microsoft Dataverse | Solutions layered over a system layer; publisher customization prefix on every component | Unmanaged changes share one layer; managed layers stack ("last one wins", merge only for apps/forms/sitemaps); **managed properties** let the publisher lock customization, and "can't be updated except by an update of the solution by the original publisher"; custom tables raised from 1,500 to 3,000 per environment (2022 wave 2); no hard column limit but an 8,060-byte SQL row limit, and Microsoft advises "less than a few hundred columns" |
| ServiceNow | Scoped apps with a namespace prefix (`x_<company>_<app>`); global customisations use `u_`; tables can extend base tables such as Task | Namespace "cannot be changed or removed"; cross-scope access is denied unless explicitly granted (runtime access tracking); Custom Table Guide (effective Oct 17, 2025) requires custom tables to be licensed via App Engine entitlements, caps App Engine Starter tables at 50 custom fields, and allows up to 1,000 exempt extensions of listed tables |
| Palantir Foundry | Ontology branches and proposals | PR-style review per resource, protected main, branch previews |

Lessons you can apply directly:
- **Prefixing:** Dataverse and ServiceNow namespace every tenant artifact. Use `org1003:` or `bfsi:` prefixes on overlay terms so promotion is an explicit rename-plus-alias.
- **Publisher-owned lock flags:** a Dataverse-style managed property on core terms means overlays can't narrow them.
- **Explicit quotas**, as Salesforce and ServiceNow impose.
- **Layer precedence, stated once and tested:** core < domain < org, add-only.

*(The ServiceNow Custom Table Guide figures come from a copy hosted on the ServiceNow Community, and its `u_` prefix details come from community posts. Verify against your contract.)*

## 6. Which Ontology an Agent Should Receive

**Recommendation:** give each product agent a **role-scoped slice** covering its product's entities, one-hop neighbours, relevant metrics and business rules. Add **discovery tools** (`search_entities(query)`, `describe_entity(id)`, `get_relations(id, depth)`, `list_metrics(domain)`), and schema-link per question with a *recall-oriented* retriever. Never send the full core + domain + org ontology.

- **Evidence on too much context:**
  - Neo4j's schema-filtering study (Ozsoy, 2025; Llama-3.1-8B plus larger models on the Text2Cypher 2024 dataset) compared static "Enhanced/Base schema" against per-question pruning by exact match and by similarity. Filtering "effectively optimizes Text2Cypher, especially for smaller models"; larger models "benefit less"; it cuts token cost for all.
  - Text-to-SQL work consistently finds the full schema adds noise and hallucination, while a perfect subset is the upper bound.
  - Some 2025 work ("The death of schema linking?") argues strong reasoning models tolerate the full schema. The split is size-dependent, which is consistent with Neo4j's finding.
- **Recall beats precision in the linker.** KaSLA shows that missing a single required table or column breaks the SQL even when aggregate recall looks high. The EDBT 2026 schema-linking analysis found the lowest-precision, highest-recall linking gave *very high* execution accuracy. Tune your slice retriever for recall@k ≈ 1.0 on your golden questions and accept some extra tokens.
- **Techniques to use:**
  - Entity-name and synonym exact matching: the cheapest, and Neo4j notes it adds negligible latency.
  - Embedding similarity over entity definitions and synonyms, using your Qwen3 embeddings.
  - One-hop graph expansion of matched entities.
  - Optional draft-then-prune (PET-SQL/ASTRES style): generate a draft query, parse which labels it used, and re-prompt with that sub-schema.
  - Post-generation validation of Cypher against the schema, as in Neo4j's 2026 grammar- and schema-aware filtering: check label/relationship existence and direction and reject invalid queries.
- **Full vs slice vs tools, as trade-offs:**
  - A full ontology is simplest but costly, and it hurts small models.
  - A role slice is cheap and stable (cacheable), but misses cross-product questions.
  - Discovery tools cover everything but add latency and multi-turn failure modes.
  - The hybrid (slice + tools) is the practitioner default. We found no head-to-head published benchmark of slice vs tools for ontology-serving agents, so measure it on your agent golden questions.
- **Access control first:** apply the ontology `access`/`compliance` fields *before* building the slice, so restricted entities never enter model context. Per-tenant slices must include only that org's overlay.

## Caveats

- Several 2026 arXiv papers cited here (OntoAligner-Ensemble, the confidence studies, the anchoring study, PIPE-Cypher) are preprints. Treat their numbers as indicative.
- OAEI and LLMs4OL results are dominated by biomedical ontologies. Transfer to B2B SaaS/BFSI field classification is plausible but unproven. Your golden set is the real benchmark.
- JSONSchemaBench coverage figures (86% → 3%) and the Instructor field-name claim come from secondary summaries or vendor documentation.
- Model names evolve quickly (GPT-5.x, Claude 4.x, Gemini 3). Pin snapshots and let the regression harness, not leaderboards, decide upgrades.
- Monorepo guidance and bloat-control thresholds are practitioner opinion; no controlled studies exist for data platforms.