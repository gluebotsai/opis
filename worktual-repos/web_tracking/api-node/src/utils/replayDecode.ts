import { gunzipSync } from "node:zlib";

/** Decode replay_chunk_v1 eventsData (gzip + base64) into rrweb event array. */
export function decodeReplayEventsData(encoding: string, eventsData: string): unknown[] {
  if (!eventsData) return [];
  try {
    if (encoding === "gzip_b64" || encoding === "") {
      const compressed = Buffer.from(eventsData, "base64");
      const json = gunzipSync(compressed).toString("utf8");
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    }
    if (encoding === "json") {
      const parsed = JSON.parse(eventsData) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    /* corrupt or legacy chunk — treat as empty so session list still loads */
    return [];
  }
  return [];
}

function eventSortKey(event: unknown, index: number): [number, number, number] {
  const row = event as { timestamp?: number; type?: number };
  const ts = Number(row.timestamp ?? 0);
  // rrweb: Meta=4, FullSnapshot=2 should precede Incremental=3 at equal timestamps
  const typeOrder = row.type === 4 ? 0 : row.type === 2 ? 1 : row.type === 3 ? 2 : 3;
  return [ts, typeOrder, index];
}

/** Merge chunk arrays in order, then stable-sort by timestamp + rrweb event type. */
export function mergeRrwebEvents(chunks: unknown[][]): unknown[] {
  const merged: unknown[] = [];
  for (const chunk of chunks) {
    for (const event of chunk) merged.push(event);
  }
  return merged
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const ka = eventSortKey(a.event, a.index);
      const kb = eventSortKey(b.event, b.index);
      for (let i = 0; i < 3; i += 1) {
        if (ka[i] !== kb[i]) return ka[i] - kb[i];
      }
      return 0;
    })
    .map(({ event }) => event);
}

export function replayHasFullSnapshot(events: unknown[]): boolean {
  return events.some((event) => {
    const type = typeof event === "object" && event && "type" in event ? Number((event as { type: number }).type) : 0;
    return type === 2;
  });
}

export function replayHasIncrementals(events: unknown[]): boolean {
  return events.some((event) => {
    const type = typeof event === "object" && event && "type" in event ? Number((event as { type: number }).type) : 0;
    return type === 3;
  });
}
