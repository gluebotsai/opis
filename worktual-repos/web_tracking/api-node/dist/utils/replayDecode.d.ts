/** Decode replay_chunk_v1 eventsData (gzip + base64) into rrweb event array. */
export declare function decodeReplayEventsData(encoding: string, eventsData: string): unknown[];
/** Merge chunk arrays in order, then stable-sort by timestamp + rrweb event type. */
export declare function mergeRrwebEvents(chunks: unknown[][]): unknown[];
export declare function replayHasFullSnapshot(events: unknown[]): boolean;
export declare function replayHasIncrementals(events: unknown[]): boolean;
