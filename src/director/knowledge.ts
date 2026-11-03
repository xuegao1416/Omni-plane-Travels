/** Transitional import adapter. Observation state and mutations belong to variables. */
import type { GameState } from '../schema/variables';
import { initializePlayerKnowledge, selectPlayerKnownNPCs } from '../engine/playerKnowledge';

/** Called only by state loading/normalization, never by readers or UI. */
export function ensureKnowledgeState(gameState: GameState) {
  const initialized = initializePlayerKnowledge(gameState, {
    turnId: 'knowledge-baseline', eventId: 'knowledge-baseline', quote: '开局或旧存档已有的人物资料',
  });
  gameState.playerKnowledge = initialized.playerKnowledge;
  delete (gameState as GameState & { 人物已知资料?: unknown }).人物已知资料;
  return gameState.playerKnowledge!;
}

export const projectKnownRoster = selectPlayerKnownNPCs;
export const projectKnownRosterFromGameState = selectPlayerKnownNPCs;
