import type { GameState } from '../../../../schema/variables';
import type { ChatMessage } from '../../../../engine/types';

export interface CurrentVariableHost {
  readState(): GameState;
  /** Rejects a replaced manager, save or world and a closed editing surface. */
  isCurrent(): boolean;
  prepare(json: string): GameState | null;
}
export interface CurrentVariableProposal { state?: GameState; reason?: string }

export function prepareCurrentVariableJSON(params: {
  host: CurrentVariableHost; json: string; expectedState: string; signal?: AbortSignal;
}): CurrentVariableProposal {
  const { host, json, expectedState, signal } = params;
  if (signal?.aborted || !host.isCurrent() || JSON.stringify(host.readState()) !== expectedState) {
    return { reason: '当前变量或旅程在等待期间已变化，请保留草稿并载入最新状态后再应用。' };
  }
  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: '内容需要是当前变量对象。' };
    if ('layers' in raw && !('snapshot' in raw)) return { reason: '这是历史快照资料包，请选择一个具体 snapshot；不能把整包当作当前变量导入。' };
    const candidate = 'snapshot' in raw ? raw.snapshot : raw;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
      || !('玩家' in candidate) || !('世界' in candidate)) return { reason: '文件缺少玩家或世界变量，无法应用。' };
    const state = host.prepare(JSON.stringify(candidate));
    return state ? { state } : { reason: '变量内容无法应用，请检查数据后重试。' };
  } catch (error) {
    return { reason: `变量 JSON 无效：${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function importCurrentVariableJSON(params: {
  host: CurrentVariableHost; readText(): Promise<string>; signal?: AbortSignal;
}): Promise<CurrentVariableProposal> {
  const expectedState = JSON.stringify(params.host.readState());
  try {
    params.signal?.throwIfAborted();
    const json = await params.readText();
    return prepareCurrentVariableJSON({ ...params, json, expectedState });
  } catch (error) {
    return { reason: params.signal?.aborted ? '变量导入已取消。' : `导入失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** A confirmation belongs to a particular historical message and its displayed version. */
export function resolveCurrentRollbackIndex(params: {
  messages: ChatMessage[]; messageId: string; snapshot: GameState; isCurrent(): boolean;
}): number {
  if (!params.isCurrent()) return -1;
  const index = params.messages.findIndex(message => message.id === params.messageId);
  return index >= 0 && params.messages[index].snapshot
    && JSON.stringify(params.messages[index].snapshot) === JSON.stringify(params.snapshot) ? index : -1;
}
