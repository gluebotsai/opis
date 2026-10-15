# Create-campaign agent service (Python)

Run (from this folder):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m app.main
```

Health: http://127.0.0.1:8005/health  
Socket.IO: http://127.0.0.1:8005 (path `/socket-io`)

## Layout

```text
app/
  llm.py                         # OpenAILLM client
  socket_server.py               # Socket.IO transport
  agents/
    create_campaign/             # Main campaign agent + tools + LLM tool loop
    template_library/            # Creation orchestrator + per-channel agents
      creation_agent.py
      channels/{email,sms,whatsapp,push,web}/
    contacts/                    # Audience / contacts agent
    monitoring/                  # Live campaign monitoring agent
```

## Flow

Cross-module handoffs use **LLM + ROUTE_TO_MODULE** only (no regex routing).
Source agent calls the route tool → FE navigates with `carry_query` + `seed_user_message`
→ destination agent runs **one turn** and replies naturally.

Create-campaign **drafts persist only after campaign work starts** (agent tools set
name/goal/audience/channels/templates). Routing-only shells are discarded on leave.
UI shows **“New campaign”** until `SET_CAMPAIGN_DETAILS` sets a real name.

### Verification

```bash
cd agents && source .venv/bin/activate && PYTHONPATH=. python scripts/verify_routing_handoff.py
```

Spot-checks (13 checks): dashboard clarify/route, monitoring/events/recommendations
paraphrase routing, contacts create, forms handoff, create-campaign audience, WhatsApp LLM
reply, FE `carry_query` wiring, and `validate_campaign_details` session guard.

Unit tests:

```bash
PYTHONPATH=. python -m unittest discover -s tests -p 'test_*.py' -v
```

### Browser E2E (manual)

Requires a logged-in session. After login:

1. Open **Dashboard** → say `create a campaign` → should navigate to Create campaign with one natural reply.
2. Open **Events tracking** → say `build a signup form` → should open Create events.
3. From **Forms**, complete a form → ask to create campaign → LLM confirms in its own words (no "Reply yes") → navigate → one destination reply.

If redirected to `/login`, set test credentials in the frontend `.env.local` and sign in first.


Coordinator agents share `app/runtime/agent.py` → `run_tool_loop`.

1. Main create-campaign agent collects details via tools.
2. `CREATE_TEMPLATES` → **creation agent** fans out to selected **channel LLM agents**.
3. Edit space uses the matching **channel edit agent** (LLM JSON intent — no keyword matching).
