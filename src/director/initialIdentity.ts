import type { DirectorDefinition } from './definitionTypes';
import type { GameState } from '../schema/variables';

export function enforcePlayerIdentity(state: GameState): void {
  const identity = state.playerIdentity;
  if (!identity) return;
  const names = new Set([identity.name, ...identity.aliases].map(name => name.normalize('NFKC').trim()));
  state.玩家.姓名 = identity.name;
  for (const [id, npc] of Object.entries(state.人物档案)) {
    if (id !== identity.actorId && !names.has(npc.姓名?.normalize('NFKC').trim())) continue;
    delete state.人物档案[id];
    if (state.playerKnowledge) delete state.playerKnowledge.characters[id];
  }
}

export interface DirectorPlayerSelection {
  definitionId: string;
  version: string;
  mode: 'custom' | 'original';
  actorId?: string;
  startStageId: string;
}
export function resolveDirectorInitialIdentity(definition: DirectorDefinition, selection: DirectorPlayerSelection | undefined, roster: Record<string, { 姓名: string }>) {
  if (selection && (selection.definitionId !== definition.id || selection.version !== definition.version)) throw new Error('角色选择属于其他剧情版本，请重新选择');
  if (selection && !definition.stages.some(s => s.id === selection.startStageId)) throw new Error('所选剧情起点不存在');
  const actor = selection?.mode === 'original' ? definition.characters.find(c => c.id === selection.actorId) : undefined;
  if (selection?.mode === 'original' && !actor) throw new Error('所选原角色不存在');
  const names = actor ? new Set([actor.name, ...actor.aliases].map(n => n.normalize('NFKC').trim())) : new Set<string>();
  const excludedNpcIds = Object.entries(roster).filter(([id, npc]) => actor && (id === actor.id || names.has(npc.姓名.normalize('NFKC').trim()))).map(([id]) => id);
  const roleBinding: Record<string, string> = {};
  for (const character of definition.characters) {
    if (character.id === actor?.id) { roleBinding[character.id] = 'player'; continue; }
    const matches = Object.entries(roster).filter(([id, npc]) => !excludedNpcIds.includes(id) && (id === character.id || npc.姓名 === character.name || character.aliases.includes(npc.姓名)));
    if (matches.length === 1) roleBinding[character.id] = matches[0]![0];
  }
  return { roleBinding, excludedNpcIds, playerName: actor?.name };
}
