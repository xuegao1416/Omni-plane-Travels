import type { GameState } from '../schema/variables';
import { selectPlayerKnownNPCs } from './playerKnowledge';

/** Narrator-only physical staging, never a player-knowledge update. */
export function buildEncounterContext(state: GameState, plannedParticipants: string[] = []): string {
  const selected = new Set(plannedParticipants);
  const known = selectPlayerKnownNPCs(state);
  const people = Object.entries(state.人物档案).filter(([id, npc]) => npc.人物分类 === '在场' || selected.has(id));
  const rows = people.flatMap(([id, npc]) => {
    const details = npc.个人信息;
    const previous = known[id]?.个人信息;
    const physical = Object.fromEntries(['外貌', '当前穿着', '当前状态', '当前位置'].flatMap(key => {
      const value = details?.[key as keyof typeof details];
      return typeof value === 'string' && value.trim() && value !== previous?.[key as keyof typeof previous] ? [[key, value]] : [];
    }));
    return Object.keys(physical).length ? [{ id, 姓名: npc.姓名, 当前在场: npc.人物分类 === '在场', 可观察状态: physical }] : [];
  });
  if (!rows.length) return '';
  return `【相遇时的场景事实｜仅供叙事者核对，不代表玩家已知】\n${JSON.stringify(rows)}\n这些是真实人物的外在状态，不是要求玩家见面或发现的剧情目标。只有正文中确实接触、看见或得到明确告知的部分才可写入玩家认知。离场人物不能直接出现、传送到玩家身边或被玩家凭空定位；必须先满足自然的地点和接触条件。不得由伤势、穿着或见面推导未公开的原因、经历、内心、目标或精确数值。`;
}
