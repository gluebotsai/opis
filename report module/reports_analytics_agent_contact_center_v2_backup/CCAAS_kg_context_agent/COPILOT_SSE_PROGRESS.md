# Copilot SSE progress (activity loader)

## Summary

Copilot progress text (“Understanding your question…”, “Writing the analytics query…”, “Writing my reply…”) is **not** an LLM tool the model calls. The NLP agent runtime **yields Server-Sent Events** of type `status`. The web app updates the activity loader from those events.

| Piece | Role |
|-------|------|
| `sse_status(phase, label)` | Core emitter — SSE event `status` |
| `sse_tool_progress(tool)` | Maps agent tools → one or more progress phases |
| `sse_thinking` / `sse_understanding` | “Understanding your question…” |
| `sse_querying` | “Writing the analytics query…” |
| `sse_fetching` | “Fetching the numbers…” |
| `sse_charting` | “Preparing your chart…” |
| `sse_writing` | “Writing my reply…” |

Source of truth: `apps/nlp/src/app/runtime/sse.py`

## Architecture

```
┌──────────────────┐  POST /assistant/copilot/stream  ┌──────────┐  proxy  ┌─────────────────────┐
│ Web (browser)    │ ────────────────────────────────▶│ cc-core  │───────▶│ NLP /api/v1/copilot │
│ use-copilot-     │◀──── text/event-stream ──────────│ proxy    │◀───────│ /stream             │
│ runner           │                                  └──────────┘        │ AgentRuntime        │
└────────┬─────────┘                                                      └──────────┬──────────┘
         │                                                                           │
         │ onEvent({ event: "status", data: { phase, label }})                       │
         ▼                                                                           ▼
   statusLabel UI                                                         yield sse_status(...)
                                                                          yield sse_tool_progress(tool)
                                                                          yield sse_writing()
                                                                          yield sse_text_delta(...)
                                                                          yield sse_done(...)
```

### Layers

1. **NLP runtime** (`agent.py` / `router.py`) yields SSE strings while the turn runs.
2. **NLP HTTP** (`apps/nlp/src/app/api/copilot.py`) — `StreamingResponse(..., media_type="text/event-stream")`.
3. **cc-core proxy** (`apps/cc-core/src/services/copilot-stream-proxy.ts`) — forwards the stream to the browser.
4. **Web client** (`assistant-api.ts` → `use-copilot-runner.ts`) — parses frames and sets the loader label.

## SSE wire format

```
event: <name>
data: <json>

```

Empty line (`\n\n`) ends each frame. JSON is compact (`separators=(",", ":")`).

### Progress event

| Field | Type | Meaning |
|-------|------|---------|
| `event` | `"status"` | Progress / phase update |
| `data.phase` | string | Machine id: `understanding`, `querying`, `fetching`, `charting`, `writing`, `tool`, … |
| `data.label` | string | Human copy for the loader |

Example frame:

```
event: status
data: {"phase":"understanding","label":"Understanding your question…"}

```

### Other events on the same stream

| Event | Purpose |
|-------|---------|
| `status` | Activity loader phase |
| `tool_call` | Tool about to run |
| `block` | Tool card (`running` / `success` / `error`) |
| `text_delta` | Assistant reply chunks |
| `action` / `contact_draft` / `queue_draft` / `confirmation_required` | Side effects |
| `error` | Failure |
| `done` | End of turn (`turnId`, optional `route`) |

## How progress is chosen

### Turn start

```python
yield sse_thinking(context.surface)
# → phase=understanding, label="Understanding your question…"
```

### Before each tool

```python
for event in sse_tool_progress(name, has_presentation=bool(arguments.get("presentation"))):
    yield event
```

| Tool | Progress phases |
|------|-----------------|
| `ask_semantic_layer` | `fetching` — “Checking predefined metrics…” |
| `sql_analytics` | `querying` → `fetching` → optional `charting` |
| `generate_performance_report` | `fetching` — “Pulling your metrics…” |
| `generate_plot` | `charting` |
| other | `phase=tool`, label = tool name |

### Before final text

```python
yield sse_writing()
yield sse_text_delta(content)
```

## End-to-end flow (analytics)

```
User: "Show missed contacts this week"
        │
        ▼
Web POST /api/v1/assistant/copilot/stream
        │
        ▼
NLP Agent.run_stream
        │
        ├─▶ event: status  phase=understanding
        │     UI: "Understanding your question…"
        │
        ├─ LLM returns tool_calls: [{ name: "sql_analytics", ... }]
        │
        ├─▶ event: status  phase=querying
        │     UI: "Writing the analytics query…"
        ├─▶ event: status  phase=fetching
        │     UI: "Fetching the numbers…"
        ├─▶ event: status  phase=charting   (if presentation set)
        │     UI: "Preparing your chart…"
        ├─▶ event: tool_call / block running → success
        │
        ├─ LLM returns final text (no more tools)
        │
        ├─▶ event: status  phase=writing
        ├─▶ event: text_delta  (reply)
        └─▶ event: done
```

## Key files

| Path | Role |
|------|------|
| `apps/nlp/src/app/runtime/sse.py` | SSE serializers + progress helpers |
| `apps/nlp/src/app/runtime/agent.py` | Yields progress around tools / reply |
| `apps/nlp/src/app/runtime/router.py` | Alternate path; same helpers |
| `apps/nlp/src/app/api/copilot.py` | `/copilot/stream` SSE endpoint |
| `apps/cc-core/src/services/copilot-stream-proxy.ts` | Auth + proxy to NLP |
| `apps/web/src/features/assistant/assistant-api.ts` | SSE client parse |
| `apps/web/src/features/assistant/use-copilot-runner.ts` | Apply `status` → loader |
| `apps/web/src/features/assistant/copilot-status-labels.ts` | Phase/tool → display labels |

---

## Sample code: server (Python / FastAPI)

Minimal stand-alone pattern matching this repo’s helpers. Production code lives in `sse.py` + `agent.py` + `api/copilot.py`.

```python
"""Minimal Copilot-style SSE progress server (illustrative)."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def encode_sse(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def sse_status(phase: str, label: str | None = None) -> str:
    return encode_sse(
        "status",
        {
            "phase": phase,
            "label": label or phase.replace("_", " ").title(),
        },
    )


def sse_tool_progress(tool: str, *, has_presentation: bool = False) -> list[str]:
    if tool == "sql_analytics":
        events = [
            sse_status("querying", "Writing the analytics query…"),
            sse_status("fetching", "Fetching the numbers…"),
        ]
        if has_presentation:
            events.append(sse_status("charting", "Preparing your chart…"))
        return events
    return [sse_status("tool", tool)]


def sse_text_delta(delta: str) -> str:
    return encode_sse("text_delta", {"delta": delta})


def sse_done(turn_id: str | None = None) -> str:
    return encode_sse("done", {"turnId": turn_id or str(uuid.uuid4())})


async def copilot_turn_stream(message: str) -> AsyncIterator[str]:
    # 1) Always start with understanding
    yield sse_status("understanding", "Understanding your question…")

    # 2) Pretend the LLM chose sql_analytics
    tool = "sql_analytics"
    for event in sse_tool_progress(tool, has_presentation=True):
        yield event
    yield encode_sse("tool_call", {"tool": tool, "args": {"question": message}})

    # … run the tool …

    # 3) Final reply
    yield sse_status("writing", "Writing my reply…")
    yield sse_text_delta("Here are your missed contacts for this week.")
    yield sse_done()


@app.post("/api/v1/copilot/stream")
async def copilot_stream(body: dict[str, Any]) -> StreamingResponse:
    message = str(body.get("message") or "")

    async def generate() -> AsyncIterator[str]:
        async for frame in copilot_turn_stream(message):
            yield frame

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
```

### Emitting from the real agent loop

```python
# apps/nlp/src/app/runtime/agent.py (pattern)

yield sse_thinking(context.surface)

# … LLM round …

for tool_call in response["tool_calls"]:
    name = tool_call["function"]["name"]
    arguments = _parse_arguments(tool_call["function"]["arguments"])
    for event in sse_tool_progress(
        name,
        has_presentation=bool(arguments.get("presentation")),
    ):
        yield event
    yield sse_tool_call(name, arguments)
    # … execute tool, yield block success/error …

if response["content"]:
    yield sse_writing()
    yield sse_text_delta(response["content"])
yield sse_done(route=self.definition.name)
```

---

## Sample code: client (TypeScript / fetch)

Matches `streamCopilotMessage` in `apps/web/src/features/assistant/assistant-api.ts`.

```typescript
/** Minimal Copilot SSE client (illustrative). */

type StatusEvent = { event: "status"; data: { phase: string; label: string } };
type TextDeltaEvent = { event: "text_delta"; data: { delta: string } };
type DoneEvent = { event: "done"; data: { turnId: string; route?: string } };
type CopilotStreamEvent =
  | StatusEvent
  | TextDeltaEvent
  | DoneEvent
  | { event: string; data: unknown };

const PHASE_LABELS: Record<string, string> = {
  understanding: "Understanding your question…",
  querying: "Writing the analytics query…",
  fetching: "Fetching the numbers…",
  charting: "Preparing your chart…",
  writing: "Writing my reply…",
};

function parseSseFrame(frame: string): CopilotStreamEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: JSON.parse(dataLines.join("\n")) } as CopilotStreamEvent;
}

export async function streamCopilotMessage(options: {
  url: string; // e.g. `${ccCoreUrl}/api/v1/assistant/copilot/stream`
  message: string;
  token?: string;
  onStatus?: (label: string, phase: string) => void;
  onTextDelta?: (delta: string) => void;
  onDone?: (turnId: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(options.url, {
    method: "POST",
    headers,
    signal: options.signal,
    body: JSON.stringify({
      message: options.message,
      role: "admin",
      context: { path: "/admin/monitoring", surface: "monitoring" },
      history: [],
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Copilot stream failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const parsed = parseSseFrame(frame);
      if (!parsed) continue;

      if (parsed.event === "status") {
        const { phase, label } = parsed.data as StatusEvent["data"];
        const display = PHASE_LABELS[phase] ?? label;
        options.onStatus?.(display, phase);
      }

      if (parsed.event === "text_delta") {
        options.onStatus?.("Writing my reply…", "writing");
        options.onTextDelta?.((parsed.data as TextDeltaEvent["data"]).delta);
      }

      if (parsed.event === "done") {
        options.onDone?.((parsed.data as DoneEvent["data"]).turnId);
      }
    }

    if (done) break;
  }
}

// Usage
await streamCopilotMessage({
  url: "http://localhost:3001/api/v1/assistant/copilot/stream",
  message: "Show missed contacts this week",
  onStatus: (label) => console.log("[loader]", label),
  onTextDelta: (delta) => process.stdout.write(delta),
  onDone: (turnId) => console.log("\n[done]", turnId),
});
```

### How the real UI applies it

```typescript
// apps/web/src/features/assistant/use-copilot-runner.ts (pattern)

onEvent: (event) => {
  if (event.event === "status") {
    setStatusLabel(
      friendlyStatusLabel(event.data.label, snapshot.surface, event.data.phase),
    );
    return;
  }
  if (event.event === "tool_call") {
    setStatusLabel(toolStatusLabel(event.data.tool));
    return;
  }
  if (event.event === "text_delta") {
    setStatusLabel("Writing my reply…");
    // append delta to streaming message…
  }
};
```

---

## Proxy note (cc-core)

The browser does **not** call NLP directly. It posts to cc-core:

`POST /api/v1/assistant/copilot/stream`

cc-core forwards to:

`POST {NLP_SERVICE_URL}/api/v1/copilot/stream`

and pipes the upstream `text/event-stream` body back with the same SSE frames.
