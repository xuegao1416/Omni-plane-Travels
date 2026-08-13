export const MESSAGE_BATCH_SIZE = 80;

/** Start at the recent end of a long history so entering chat stays fast. */
export function getInitialMessageStart(totalMessages: number): number {
  return Math.max(0, totalMessages - MESSAGE_BATCH_SIZE);
}

/** Reveal one older batch when the reader reaches the top. */
export function getPreviousMessageStart(currentStart: number): number {
  return Math.max(0, currentStart - MESSAGE_BATCH_SIZE);
}
