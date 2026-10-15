const CONVERSATION_PIN_THRESHOLD_PX = 80;

export function isConversationNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight < CONVERSATION_PIN_THRESHOLD_PX;
}

export function didAppendLatestMessage(
  previousCount: number,
  nextCount: number,
  previousLatestMessageId?: string,
  nextLatestMessageId?: string,
): boolean {
  return (
    nextCount > previousCount &&
    Boolean(nextLatestMessageId) &&
    nextLatestMessageId !== previousLatestMessageId
  );
}
