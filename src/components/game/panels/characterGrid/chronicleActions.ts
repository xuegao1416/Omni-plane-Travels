import type { GameState } from '../../../../schema/variables';

export interface ChronicleActionHost {
  readState(): GameState;
  /** Bound to the manager, save and world captured when the UI action begins. */
  isCurrent(): boolean;
  commit(next: GameState): boolean;
}
export interface ChronicleMergeOptions { signal?: AbortSignal; expectedChronicles?: string[] }
export interface ChronicleActionResult { applied: boolean; reason?: string }

const changed = (): ChronicleActionResult => ({ applied: false, reason: '人物事迹或当前旅程已变化，请重新选择记录。' });
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function updateCurrentNpcChronicles(host: ChronicleActionHost, npcId: string, chronicles: string[], expectedChronicles?: string[]): ChronicleActionResult {
  if (!host.isCurrent()) return changed();
  const next = host.readState();
  const npc = next.人物档案[npcId];
  if (!npc || expectedChronicles && !same(npc.人物事迹 ?? [], expectedChronicles)) return changed();
  npc.人物事迹 = [...chronicles];
  return host.commit(next) ? { applied: true } : changed();
}

export async function mergeCurrentNpcChronicles(params: ChronicleMergeOptions & {
  host: ChronicleActionHost; npcId: string; startIndex: number; endIndex: number;
  generate(input: { npcName: string; deeds: string[]; signal?: AbortSignal }): Promise<string>;
}): Promise<ChronicleActionResult> {
  const { host, npcId, startIndex, endIndex, signal } = params;
  if (signal?.aborted || !host.isCurrent()) return changed();
  const npc = host.readState().人物档案[npcId];
  const deeds = npc?.人物事迹;
  if (!npc || !Array.isArray(deeds) || !Number.isInteger(startIndex) || !Number.isInteger(endIndex)
    || startIndex < 0 || endIndex >= deeds.length || startIndex >= endIndex) return { applied: false, reason: '请至少选择两条有效事迹进行合并。' };
  if (params.expectedChronicles && !same(deeds, params.expectedChronicles)) return changed();
  const npcName = npc.姓名 || npcId;
  const source = [...deeds];
  try {
    const merged = (await params.generate({ npcName, deeds: source.slice(startIndex, endIndex + 1), signal })).replace(/^\d+[\.\)、]\s*/, '').trim();
    if (signal?.aborted || !host.isCurrent()) return changed();
    const next = host.readState();
    const target = next.人物档案[npcId];
    if (!target || (target.姓名 || npcId) !== npcName || !same(target.人物事迹, source)) return changed();
    if (!merged) return { applied: false, reason: '模型没有返回合并摘要，请重试。' };
    target.人物事迹 = [...source.slice(0, startIndex), merged, ...source.slice(endIndex + 1)];
    return host.commit(next) ? { applied: true } : changed();
  } catch (error) {
    return { applied: false, reason: signal?.aborted ? '合并已取消。' : `事迹合并失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
