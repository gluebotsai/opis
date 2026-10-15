# Campaign agents — security and simultaneous communication

How Campaign agents are secured, and how they communicate when multiple sessions or specialists are active.

Related: [CAMPAIGN_AGENTS_SYSTEM_GUIDE.md](./CAMPAIGN_AGENTS_SYSTEM_GUIDE.md), [CAMPAIGN_HUB_A2A_AGENT_CARD.md](./CAMPAIGN_HUB_A2A_AGENT_CARD.md), [agents/app/mas/README.md](../agents/app/mas/README.md).

---

## 1. Agent security

Agents are not an open public chat API. Access and actions are gated in layers.

| Layer | What happens |
|--------|----------------|
| **Login JWT** | Browser or CRM connects to agents Socket.IO with the same user JWT as the Campaign API (`JWT_SECRET`, HS256). No valid token → connection/session rejected (“Valid JWT token required”). |
| **Session ownership** | Each agent chat session is tied to a `user_id`. If another user tries that `session_id` → “You do not have access to this campaign session.” |
| **CORS / origins** | Only allowed frontend origins can talk to agents (LAN + production URLs). |
| **API calls from agents** | When agents call Campaign REST (contacts, launch, etc.), they send `Authorization: Bearer <user JWT>` — backend auth and tenant rules still apply. |
| **Hub A2A** | Hub uses OAuth-style **client id/secret** plus Bearer access JWT; skills run with scoped access, not an open public agent API. |
| **SFT catalog** | Internal catalog endpoints require `x-internal-service-key` (fail closed if missing or wrong). |
| **Tool allowlists (MAS)** | Executors only get the tools they are allowed to call (runtime allowlists), not every tool in the system. |

### Summary

| Concern | Mechanism |
|---------|-----------|
| Authentication | User JWT (SPA/CRM); Hub OAuth + client secret; internal service key (SFT catalog) |
| Authorization | Session owner check; org-scoped Campaign API; executor tool allowlists |
| Network | CORS allowlist for agent origins |

There is no separate third-party “agent firewall” product; these checks are the security model in use.

### Key code locations

| Area | Path |
|------|------|
| Socket JWT + session access | `agents/app/socket_server.py` (`_require_session_access`) |
| JWT decode (SPA + CRM) | `agents/app/auth.py` |
| Hub Bearer / OAuth | `agents/app/a2a/auth.py`, `agents/app/a2a/server.py`, `agents/app/a2a/card.py` |
| SFT internal key | `agents/app/sft_catalog/auth.py` |
| Executor tool allowlists | `agents/app/mas/runtime/tool_adapters.py` |
| CORS origins | `agents/app/cors_origins.py` |

---

## 2. How agents communicate simultaneously

Agents do **not** all talk to each other in a free mesh. Communication is **orchestrated**.

```text
User chat (Socket.IO)
    → Super agent (routes intent)
        → Domain agent (e.g. creation, audience, content)
            → Executor (does the job + tools)
                → Campaign API / DB / LLM
```

| Mode | How it works |
|------|----------------|
| **One user turn** | Usually one path: Super → one Domain → one Executor. Cross-area work uses a structured **handoff** (`request_domain_handoff`), not ad-hoc peer chat. |
| **Many users / many tabs** | Each has its own `session_id` + JWT. Many sessions can run **concurrently** on the agents server (async Socket.IO tasks), isolated by session ownership. |
| **Hub + SPA together** | Hub skills and SPA chat can run at the same time as separate requests; both go through auth, then MAS/bindings. |
| **Background jobs** | Cron/workers call **executors directly** (no Super chat), still with configured bindings — not open user sockets. |

### What “simultaneously” means here

- **Many sessions in parallel** (different users or chats), and  
- **Within one session**, handoffs and sequential specialist steps — not every agent broadcasting to every other agent.

### MAS package (orchestration)

```text
Super → Domain → Executor → business tools
```

- Super routes to a Domain (interactive SPA first turn + Hub unknown intent).
- Domains select Executors via LLM (`invoke_executor`) or deterministic module hints.
- Executors perform business work and emit UI events.
- Cross-domain work uses structured handoffs (`agents/app/mas/runtime/handoffs.py`).
- User-intent routing does **not** use regex or phrase lists (LLM + tools).

Details: [agents/app/mas/README.md](../agents/app/mas/README.md).

---

## 3. Short answers

1. **Is there agent security?** Yes — JWT, session ownership, CORS, Bearer calls to the Campaign API, Hub OAuth/client secret, internal service key, and tool allowlists.  
2. **How do agents communicate at the same time?** Parallel **per session/request**; inside a campaign chat, **Super → Domain → Executor (+ handoff)**, not free simultaneous agent-to-agent chatter.
