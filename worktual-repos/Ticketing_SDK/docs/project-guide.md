# Project guide

This repo holds two products that stay separate.

**Worktual Ticketing** is the real helpdesk. Its API is on port 3001, its staff UI is on port 5173, and its data lives in the Postgres database named by `DATABASE_URL` (the local name used for that product is `worktual_bigint`). Partners never connect to that database. They call the API with an org API key.

**Acme Support** is a small traditional desk in `Ticketing_SDK_Testing`. It has its own login, its own tickets, and its own Postgres database, `ticketing_sdk`. It does not store tickets in Worktual. It is the place where SDK widgets and the knowledge flow are tried.

A third pair of small services sits beside the desk:

- `recommend-service` talks to the chat model.
- `rag-service` stores knowledge documents and searches them.

Those two are not part of the desk database and not part of Worktual.

## What was built

- A TypeScript partner client, `@worktual/ticketing`, plus Python and C# clients.
- White-label widgets in `@worktual/ticketing-ui`: chat, login, inbox, approvals, insights, and task cards.
- A desk-only popup, `@worktual/ticketing-ui-v2` (`<worktual-desk-assist>`).
- A click-to-suggest button, `@worktual/ticketing-ui-v3` (`<worktual-note-recommend>`). It searches the knowledge service, then asks the model to rephrase the passage.
- Partner routes on the Worktual API: sessions from an org API key, usage, tasks, and proposals.
- The Acme desk: staff login, ticket list, create, status, internal notes, and a saved suggestion.
- The recommendation service and the knowledge service.

## Ports

| Service | Port | Folder | Start |
|---|---|---|---|
| Worktual API | 3001 | repo root | `npm run dev:api` |
| Worktual UI | 5173 | `ui-frontend` | `npm run dev:frontend` |
| Coworker agents | 8012 | `ai-agents` | `npm run dev:agents` |
| Acme desk | 4100 | `Ticketing_SDK_Testing` | `npm start` |
| Recommendation | 4200 | `recommend-service` | `npm start` |
| Knowledge / RAG | 4300 | `rag-service` | `npm start` |

Postgres listens on `127.0.0.1:5432`.

## How to run Worktual Ticketing

From the repo root, once:

```bash
npm install
cp .env.example .env
```

Set `DATABASE_URL` in `.env` to the Worktual database. Do not point it at `ticketing_sdk`. Apply the SQL files listed in `docs/README.md` the first time. Then:

```bash
npm run dev:api
npm run dev:frontend
npm run dev:agents
```

Open `http://127.0.0.1:5173`. The demo staff account in `docs/README.md` is `jane.smith@worktual.com` / `Worktual@123`.

The API mints partner sessions in `ui-backend/src/server/sdkPartner.ts`. An org API key (`wt_live_…`) stays on a server. `auth.createSession` turns it into a short staff session. The browser only receives that session token.

## How to run the Acme desk

The desk needs its own database. On first start it creates `ticketing_sdk` if that database is missing, then creates its tables and seeds Maya plus five tickets.

```bash
cd Ticketing_SDK_Testing
npm install
npm start
```

Open `http://127.0.0.1:4100`.

| Field | Value |
|---|---|
| Name | Maya Chen |
| Email | `maya@acme.test` |
| Password | `desk-pass` |

Optional environment, in `Ticketing_SDK_Testing/.env` (this file is gitignored):

| Variable | Purpose | Default |
|---|---|---|
| `DESK_DATABASE_URL` | Desk Postgres URL | `postgresql://<your-user>@127.0.0.1:5432/ticketing_sdk` |
| `PORT` | Desk port | `4100` |
| `WORKTUAL_API_BASE` | Worktual API | `http://127.0.0.1:3001` |
| `WORKTUAL_API_KEY` | Org API key. Never put this in the browser. | empty |
| `WORKTUAL_ACTOR_EMAIL` | Existing Worktual user for the desk session | empty |
| `RECOMMEND_URL` | Suggestion endpoint | `http://127.0.0.1:4200/recommend` |
| `RAG_URL` | Knowledge service origin | `http://127.0.0.1:4300` |

If `WORKTUAL_API_KEY` and `WORKTUAL_ACTOR_EMAIL` are set, desk login also opens a Worktual session. The desk still works when Worktual is down. The header then shows the Worktual error, and local tickets continue to work.

Restart the desk after changing `server.mjs` or `html.mjs`. Node caches those modules. CSS is read from disk on each request.

Widget bundles are served from `packages/*/dist`, which is gitignored. Build them before using chat or the assist popup:

```bash
npm run sdk:build
cd packages/ticketing-ui-v2 && npm install && npm run build
cd ../ticketing-ui-v3 && npm install && npm run build
```

The desk serves those files at `/sdk/`, `/sdk-ui/`, `/sdk-ui-v2/`, and `/sdk-ui-v3/`.

## How to run the recommendation service

```bash
cd recommend-service
npm start
```

Create `recommend-service/.env` (gitignored):

```bash
LLM_MODEL=worktual-qwen-27B
LLM_BASE_URL=http://YOUR_LLM_HOST/v1
# LLM_API_KEY=   optional
```

`POST /recommend` sends `{ issue, locale, grounded, knowledge }` to `{LLM_BASE_URL}/chat/completions`.

- With `knowledge` set, the model rewrites that passage into a customer reply and keeps the facts.
- With `grounded: false` and no knowledge, the reply starts with `I don't have knowledge on this.`
- `POST /api/coworker/agent-turn` and `/stream` answer the chat launcher. Chat history is kept in memory for that process only.

`GET /health` returns `{ ok, model }`.

## How to run the knowledge service

```bash
cd rag-service
npm start
```

This process does not use Postgres. It reads and writes files under `rag-service/`:

| Path | What it is |
|---|---|
| `kb/*.md` | Sixteen starter articles. Each has an Issue section and a Reply section. |
| `data/documents.json` | Index of uploaded documents, including chunk vectors. Gitignored. |
| `data/files/` | The uploaded file bytes. Gitignored. |
| `data/solutions.json` | Solutions stored after a ticket is resolved. Gitignored. |

Endpoints:

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/health` | | `{ ok, solutions, documents }` |
| GET | `/documents` | | Filename, id, time, and chunk count. Vectors stay on the server. |
| POST | `/documents` | `{ filename, mime, content_base64, ticket? }` | Saves the file, extracts text, embeds each chunk. |
| POST | `/search` | `{ issue }` | Best saved article, uploaded chunk, or stored solution. |
| POST | `/store` | `{ issue, solution, ticket }` | Appends a solution. |

Text is taken from `.txt`, `.csv`, `.md`, `.docx`, `.xlsx`, and text inside a PDF. A file with no text, such as a photo, is rejected with `This document has no text to embed.` Limits are 8 MB per file and 8 files per upload. Allowed extensions also include images, Office files, and zip; only the text-bearing ones become searchable.

Search checks uploaded chunk vectors first (cosine similarity, 384 dimensions, stored on disk). If that score is weak, it falls back to word overlap against the markdown articles and stored solutions. A hit needs at least 3 shared words and a score of 0.34. Vectors survive a restart because they are in `documents.json`.

The desk calls this service over HTTP. Ticket rows never move into this service.

## Desk pages and routes

Pages a person sees today:

- `/login` — Maya’s sign-in.
- `/` — ticket list, status chips, search, New ticket.
- `/tickets/new` — subject, description, requester name, requester email, priority.
- `/tickets/ACM-1001` — request, requester, status, internal notes, saved suggestion.

Seeded tickets are `ACM-1001` through `ACM-1005` (VPN, blank invoice, new-starter laptop, password reset, 3rd-floor printer). New tickets continue that number sequence.

On a ticket, `<worktual-desk-assist>` opens a suggestion from the recommendation service. Closing it posts the text to `/tickets/:number/suggestion`, which saves it on that ticket beside the notes. The chat button is `<worktual-chat-launcher>`. It calls the recommendation service, not the Worktual coworker on 8012.

The desk server also accepts these posts. The current HTML does not draw a form for them:

| Route | What the handler does |
|---|---|
| `POST /documents` | Forwards each file to the knowledge service `POST /documents`. |
| `POST /tickets/:number/reply` | Stores an agent message on the desk. |
| `POST /tickets/:number/knowledge` | After a resolved ticket, sends the written solution to `POST /store`. |
| `GET /tickets/:number/files/:id` | Downloads a file previously saved on the desk under `uploads/`. |

`listPage` in `html.mjs` does not render the knowledge upload control, even though `server.mjs` loads the document list and handles `POST /documents`.

## Suggest, retrieve, and rephrase

`<worktual-note-recommend>` in `packages/ticketing-ui-v3` is the button that does the full path. It is not mounted on the current ticket page. When a host sets `rag-url` and `recommend-url` and the agent clicks Suggest:

1. `POST` the ticket text to `{RAG_URL}/search`.
2. If `found` is true, `POST` that passage as `knowledge` to the recommendation service.
3. The model rephrases it. The button writes that reply into the textarea named `target` (default `body`).
4. If nothing matches, the recommendation call uses `grounded: false`, and the reply starts with `I don't have knowledge on this.`

Nothing runs when the ticket page opens. The click starts the search.

A sample passage for that test is `Ticketing_SDK_Testing/loading-bay-key.txt`. Upload it with `POST /documents` on the knowledge service (or through the desk route). Then search with an issue about the blue locker in the loading bay. The reply should mention hook 7 and should not tell anyone to cut the lock.

## Code map

### Acme desk — `Ticketing_SDK_Testing/`

| File | Role |
|---|---|
| `server.mjs` | HTTP server, cookies, pages, Worktual session, knowledge calls. |
| `html.mjs` | Login, list, new ticket, ticket page, assist popup, chat launcher. |
| `db.mjs` | Postgres schema, seed, tickets, notes, messages, suggestions, attachments. |
| `upload.mjs` | URL-encoded bodies and multipart files. |
| `worktual.mjs` | Loads `.env` and builds the SDK client plus service URLs. |
| `public/desk.css` | Desk layout. |
| `public/ticketing-browser.js` | Tiny browser shim so the chat widget can import `@worktual/ticketing`. |

Desk tables: `users`, `sessions`, `tickets`, `notes`, `suggestions`, `messages`, `attachments`.

### Knowledge service — `rag-service/`

| File | Role |
|---|---|
| `server.mjs` | HTTP API, article loader, document store, search. |
| `embed.mjs` | Text extraction, chunking, and the stored vectors. |
| `kb/*.md` | Starter articles. |

### Recommendation service — `recommend-service/server.mjs`

One file. It loads `.env`, calls the OpenAI-compatible chat endpoint, and shapes `GUIDANCE` plus `REPLY`.

### Partner SDK — `packages/ticketing-sdk`

Package name `@worktual/ticketing`. Entry `createTicketingClient`.

| Client field | Folder | What it calls |
|---|---|---|
| `auth` | `src/resources/sessions.ts`, `login.ts` | Partner session and login. |
| `ai` | `src/resources/ai.ts`, `tasks.ts`, `proposals.ts` | Coworker turns, named tasks, proposal decisions. |
| `tickets`, `notes`, `customers`, `queues` | matching files under `src/resources/` | Staff ticket routes. |
| `intake` | `intake.ts` | Create a ticket through the API. That ticket is stored in Worktual, not in `ticketing_sdk`. |
| `widgets` | `widgets.ts` | Help widget records. |
| `usage` | `usage.ts` | Partner usage. |
| `inbox` | `inbox.ts` | Inbox items. |

Shared pieces: `src/http.ts`, `auth.ts`, `types.ts`, `errorText.ts`, `locale.ts`.

### Widgets — `packages/ticketing-ui`

Package name `@worktual/ticketing-ui`. Custom elements are registered from `src/index.ts`.

| Tag | File |
|---|---|
| `worktual-chat`, `worktual-chat-launcher` | `chat-element.ts`, `launcher-element.ts` |
| `worktual-login` | `login-element.ts` |
| `worktual-inbox` | `inbox-element.ts` |
| `worktual-approvals` | `approvals-element.ts` |
| `worktual-insights` | `insights-element.ts` |
| `worktual-summary`, `worktual-classify-card`, `worktual-reply-draft`, `worktual-similar-tickets`, `worktual-kb-suggest`, `worktual-deflection`, `worktual-assign-card`, `worktual-resolve-card`, `worktual-quality-card`, `worktual-sla-card`, `worktual-workload` | `task-element.ts` |

`src/embed.ts` mounts an iframe. `src/i18n.ts` holds the visible strings. The browser must receive a session token, not the org API key.

### Desk assist and suggest

| Package | Tag | File |
|---|---|---|
| `@worktual/ticketing-ui-v2` | `worktual-desk-assist` | `src/desk-assist-element.ts` |
| `@worktual/ticketing-ui-v3` | `worktual-note-recommend` | `src/note-recommend-element.ts` |

v2 asks the recommendation service and can keep the suggestion on the ticket. v3 searches the knowledge service first, then asks the model to rephrase.

### Other partner clients

| Language | Folder | Entry |
|---|---|---|
| Python | `packages/ticketing-sdk-python` | `create_ticketing_client` in `worktual_ticketing` |
| C# | `packages/ticketing-sdk-dotnet` | `TicketingClient` in `Worktual.Ticketing` |

Python and C# cover sessions, AI, proposals, login, inbox, usage, and widgets. Ticket list and update stay in the TypeScript package.

### Worktual API pieces touched for the SDK

| Path | Role |
|---|---|
| `ui-backend/src/server/sdkPartner.ts` | Org key to staff session, metering. |
| `ui-backend/src/server/sdkPartnerRoutes.ts` | HTTP routes. |
| `ui-backend/src/server/sdkTasks.ts` | Named SDK tasks. |
| `ui-backend/src/server/sdkProposals.ts` | Proposal decisions. |
| `ui-backend/src/server/sdkProposalStore.ts` | Proposal storage. |
| `ai-agents/app/sdk_tasks.py` | Agent-side task handling. |
| `docs/local-partner-sdk.md` | How to install the unpublished packages from this repo. |
| `docs/partner-sdk-features-and-flows.md` | Feature and flow notes. |

## Tests

From the repo root:

```bash
npm run sdk:test
npm run sdk:test:ui
npm run sdk:test:python
npm run sdk:test:dotnet
```

v2 and v3 use the test runner from `packages/ticketing-ui` because they do not install their own copy unless you run `npm install` inside each folder:

```bash
cd packages/ticketing-ui-v3
NODE_PATH=../ticketing-ui/node_modules ../ticketing-ui/node_modules/.bin/vitest run tests
```

## What is not committed

These stay on the machine and are listed in `.gitignore`:

- `.env` files, including API keys and `LLM_BASE_URL`
- `rag-service/data/` (uploaded files, vectors, stored solutions)
- `Ticketing_SDK_Testing/uploads/`
- `node_modules/` and package `dist/` folders

After a fresh clone, install dependencies, build the SDK and widget packages, create the env files, and start the six processes above. The starter articles in `rag-service/kb/` are in git. Uploads you make in the running knowledge service are not.
