/** A background refresh may replace the open list only when it is still the same lookup. */
export function shouldApplyTransferTargetRefresh(input: {
  dialogOpen: boolean;
  requestedQueueId: string;
  requestedSearch: string;
  currentQueueId: string;
  currentSearch: string;
  generationAtStart: number;
  generationNow: number;
  explicitLoadInFlight: boolean;
  listExtended: boolean;
}): boolean {
  if (!input.dialogOpen || !input.requestedQueueId) return false;
  if (input.explicitLoadInFlight) return false;
  if (input.listExtended) return false;
  if (input.generationAtStart !== input.generationNow) return false;
  return (
    input.requestedQueueId === input.currentQueueId &&
    input.requestedSearch === input.currentSearch
  );
}
