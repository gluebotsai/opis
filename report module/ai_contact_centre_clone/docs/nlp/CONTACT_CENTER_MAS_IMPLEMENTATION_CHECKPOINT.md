# Contact Center MAS implementation checkpoint

## Preserved contracts

- Flat surface-selected coworker routing remains the runtime default.
- Existing API paths, SSE event payloads, support bots, Lola, A2A, omnichannel, trigger, timer, cron, and closure flows remain isolated.
- Existing L3 Python prompts remain the default until `AGENT_MARKDOWN_PROMPTS_ENABLED=true`.
- Existing role/surface/tenant MCP authorization and mutation confirmation remain authoritative.

## Implemented

- Tenant-allowlisted `flat`, `shadow`, and `three_layer` entry strategies with bounded routing timeouts and separate internal/user hop budgets.
- L1 Contact Center Super and four L2 routing-only domains with zero business MCP servers and code-enforced layer edges.
- Migrated `agent.md` sources for seven legacy coworker L3s plus Conversation Assist and Coworker Task Assist.
- Direct passive Conversation Assist path with separate reply draft, private notes, action proposal, source-message ID, and revision.
- Human action approval enters coworker chat; passive assist cannot mutate or send.
- Contact operation skill packs, per-agent skill allowlists, LLM-controlled activation, prompt rebuilding, bounded scratchpad injection, and handoff cleanup.
- Shared working/short-term/long-term/preference memory interfaces, tenant-scoped cc-core persistence, preference MCP verification, and non-blocking audit writes.
- Additive routing-chain, prompt-version, assist-state, and tool-audit persistence columns.
- Structured workspace UI with stale-response suppression and private/action cards.

## Rollback

Set `COWORKER_MAS_MODE=flat` or remove the tenant allowlist entry. Disable each other feature flag independently. The database changes are additive and need no rollback.

## Verification snapshot

- Original focused NLP baseline: 74 tests passed.
- Changed Python files pass Ruff.
- Full NLP suite: 203 tests passed.
- Focused hierarchy/memory/skills/preferences/direct-assist suite: 19 tests passed.
- Web production build passes.
- Web and cc-core TypeScript checks pass.
- Prisma schema validation passes.
- The repository-wide cc-core test command still has unrelated pre-existing failures: five files import absent `vitest`, and three legacy schema fixtures do not match current numeric-ID/length validation. Changed cc-core files compile successfully.
- The repository-wide type check reaches the unchanged test harness and stops on its existing `bigint | undefined` versus `string | undefined` mismatch in `packages/test-harness/src/preflight.ts:58`; web, cc-core, and db-cc checks pass.

Update this file only with verified results after each remaining gate.

