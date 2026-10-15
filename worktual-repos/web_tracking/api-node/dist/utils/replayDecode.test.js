import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { decodeReplayEventsData, mergeRrwebEvents } from "../../utils/replayDecode.js";
describe("replayDecode", () => {
    it("decodes gzip_b64 rrweb events", () => {
        const events = [{ type: 2, timestamp: 1000 }, { type: 3, timestamp: 2000 }];
        const compressed = gunzipSync(Buffer.from(JSON.stringify(events)));
        const eventsData = compressed.toString("base64");
        const decoded = decodeReplayEventsData("gzip_b64", eventsData);
        expect(decoded).toHaveLength(2);
    });
    it("merges chunks by timestamp", () => {
        const merged = mergeRrwebEvents([
            [{ timestamp: 2000 }, { timestamp: 3000 }],
            [{ timestamp: 1000 }],
        ]);
        expect(merged.map((e) => e.timestamp)).toEqual([1000, 2000, 3000]);
    });
});
