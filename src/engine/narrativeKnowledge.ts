import type { GameState } from '../schema/variables';
import { applyPlayerObservations, collectSceneObservations, type PlayerObservationReceipt } from './playerKnowledge';

/** Reject a wholly ineffective observation batch instead of silently declaring success. */
export function applyNarrativeKnowledge(state: GameState, receipt: PlayerObservationReceipt): GameState {
  const explicit = receipt.observations.length ? applyPlayerObservations(state, receipt) : { state, applied: 0, rejected: [] };
  const sceneObservations = collectSceneObservations(explicit.state, receipt.text);
  const scene = sceneObservations.length ? applyPlayerObservations(explicit.state, {
    ...receipt, id: `scene:${receipt.eventId}`,
    observations: sceneObservations,
  }) : { state: explicit.state, applied: 0 };
  if (receipt.observations.length && !explicit.applied && !scene.applied && explicit.rejected.length) {
    throw new Error('人物观察未能写入：请按正文登记首次见面的姓名（introduces:true），并更新在场分类；检查引文及字段。');
  }
  return scene.state;
}
