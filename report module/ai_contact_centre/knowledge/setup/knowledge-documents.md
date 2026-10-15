# Setup — knowledge documents

## Purpose

Upload org knowledge files (PDF/Office/text) for bot / agent assist. Lola and CCaaS can list documents by category; storage is local under `uploads/knowledge/`.

## Auth

Customer Bearer + org admin for uploads/deletes.

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/setup/setupApi.js`](../../src/lib/setup/setupApi.js) |
| Server | [`server/setupKnowledge.js`](../../server/setupKnowledge.js) |
| Repo | [`server/repositories/raw/setupKnowledge.repo.js`](../../server/repositories/raw/setupKnowledge.repo.js) |
| Storage | `uploads/knowledge/<organizationId>/` |

## Endpoints

| Method | Path | Client helper | Body / query | Response | Notes |
|--------|------|---------------|--------------|----------|-------|
| GET | `/api/v1/me/setup/knowledge-documents` | `listKnowledgeDocuments` | optional `?category=` | `{ documents }` | |
| POST | `/api/v1/me/setup/knowledge-documents` | `uploadKnowledgeDocument` | multipart `file`, category, branch flags | `{ document }` | Max ~15MB |
| DELETE | `/api/v1/me/setup/knowledge-documents/:id` | `deleteKnowledgeDocument` | — | `204` | Unlinks file |

### Upload form fields

| Field | Meaning |
|-------|---------|
| `file` | Binary |
| `category` | `business` / `product` / `customer_support` (see `KNOWLEDGE_CATEGORY_TABS`) |
| `allBranches` | boolean |
| `assignedBranchIds` | JSON / repeated ids |

## Dependencies / gates

Customer org membership; file type allowlist enforced server-side.

## Reuse notes

- **Lola:** index or fetch document metadata via list API; do not read raw `storage_path` from the browser — add a download route if spokes need content.
- Distinct from web chat **image** assets (`channels-webchat.md`).
