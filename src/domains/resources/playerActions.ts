/**
 * 玩家在物资面板上的操作：采集、制作、解锁/删除配方、让 AI 按当前物资设计新配方。
 *
 * 只向引擎提议状态：所有计算走资源模块命令，成功后一次性 commitPlayerState。
 * 回合进行中、只读存档、战斗中一律拒绝；AI 生成配方期间如果存档、世界或物资变化，结果作废。
 */
import type { ApiConfig } from '../../api/types';
import type { GameEngine } from '../../engine/types';
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import { createGameplayHost } from '../../core/registry';
import type { HostOutcome } from '../../core/host';
import { recoveryVersion } from '../../engine/turnRecovery';
import { normalizeRecipeInputs, normalizeRecipeOutput } from '../../utils/formatNormalize';
import { activeResourceDefs, allRecipes, resourceCapacity, resourceDef, resourcesConfigFromWorld } from './module';
import type { RecipeDef, ResourcesConfig } from './config';

export type ResourceAction = { type: 'gather'; resourceId: string } | { type: 'craft' | 'unlock-recipe' | 'delete-recipe'; recipeId: string };
export interface ResourceActionResult { status: 'accepted' | 'rejected'; feedback: string }
export interface RecipeGenerationRequest { config: ApiConfig; currentResources: Array<{ id: string; name: string; amount: number; max: number }>; playerRequest: string; worldTheme: string }
export interface ResourceActionHost {
  getEngine(): Pick<GameEngine, 'variableManager' | 'isGenerating' | 'isReadOnly' | 'commitPlayerState'>;
  getWorld(): WorldDef | undefined;
  getSaveId(): string | null;
  getApiConfig(): ApiConfig | null;
  publish(text: string): void;
  busy(value: boolean): void;
  accepted(): void;
}
interface RecipeTicket {
  controller: AbortController;
  manager: GameEngine['variableManager'];
  saveId: string | null;
  worldVersion: string;
  resourceVersion: string;
}
type GenerateRecipe = (request: RecipeGenerationRequest, signal: AbortSignal) => Promise<string>;

/** 当前物资读集（给 AI 生成配方与变化检测）。 */
export function resourceReadSet(state: GameState, world?: WorldDef): RecipeGenerationRequest['currentResources'] {
  const config = resourcesConfigFromWorld(world);
  if (!config) return [];
  const prepared = createGameplayHost(world, state).prepare(state);
  return activeResourceDefs(config, prepared).map(def => ({
    id: def.id, name: def.name, amount: Number(prepared.resources?.stocks?.[def.id] ?? 0), max: resourceCapacity(config, prepared, def.id),
  })).sort((first, second) => first.id.localeCompare(second.id));
}

async function productionRecipeRequest(input: RecipeGenerationRequest, signal: AbortSignal): Promise<string> {
  const { buildRecipeGenPrompt } = await import('../../modules/prompts');
  const { requestStreamWithRetry } = await import('../../api/client');
  if (signal.aborted) throw signal.reason;
  const prompt = buildRecipeGenPrompt(input);
  return (await requestStreamWithRetry(input.config, [{ role: 'user', content: prompt }], { signal, onDelta: () => {} })).text;
}

/** 解析模型返回的配方；数量非法直接拒绝，不让宽松的格式归一化吞掉成本。 */
export function parseGeneratedRecipe(text: string): Pick<RecipeDef, 'id' | 'name' | 'description' | 'inputs' | 'outputs' | 'minutes'> {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  if (!match) throw new Error('模型没有返回有效的配方 JSON，请重试。');
  const raw = JSON.parse(match[1].trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/、/g, ','));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配方格式无效，请重试。');
  if (raw.inputs && typeof raw.inputs === 'object') {
    const amounts = Array.isArray(raw.inputs) ? raw.inputs.map((item: any) => item?.amount ?? item?.count ?? item?.qty ?? 1) : Object.values(raw.inputs);
    if (amounts.some((amount: unknown) => !Number.isFinite(Number(amount)) || Number(amount) <= 0)) throw new Error('配方材料数量必须为有限正数，请重试。');
  } else if (raw.inputs !== undefined) throw new Error('配方材料格式无效，请重试。');
  if (raw.output && typeof raw.output === 'object') {
    const amount = raw.output.amount ?? raw.output.count ?? raw.output.qty ?? 1;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('配方产出数量必须为有限正数，请重试。');
  }
  const output = normalizeRecipeOutput(raw.output);
  if (!output.resourceId || !Number.isFinite(output.amount) || output.amount <= 0) throw new Error('配方产出数量无效，请重试。');
  return {
    id: String(raw.id || `recipe_${crypto.randomUUID()}`).replace(/[.\s]+/g, '_'),
    name: String(raw.name || '未知配方'),
    description: String(raw.description || ''),
    inputs: normalizeRecipeInputs(raw.inputs),
    outputs: { [output.resourceId]: output.amount },
    minutes: Math.min(1440, Math.max(1, Math.trunc(Number(raw.craftTimeMinutes ?? raw.minutes) || 30))),
  };
}

function numberText(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** 把一次命令的实际变化写成反馈：数量、体力、物品、耗时与容量限制。 */
export function describeOutcome(outcome: HostOutcome, config: ResourcesConfig, before: GameState, requested?: Record<string, number>): string[] {
  const after = outcome.state;
  const details: string[] = [];
  const stockChanges = new Map<string, number>();
  for (const change of outcome.changes) {
    const stock = /^resources\.stocks\.([^.]+)$/.exec(change.path);
    if (stock) {
      stockChanges.set(stock[1], (Number(change.after) || 0) - (Number(change.before) || 0));
      continue;
    }
    const item = /^玩家\.物品栏\.([^.]+)(?:\.数量)?$/.exec(change.path);
    if (item) {
      const beforeCount = Number(before.玩家.物品栏?.[item[1]]?.数量 ?? 0);
      const afterCount = Number(after.玩家.物品栏?.[item[1]]?.数量 ?? 0);
      if (beforeCount !== afterCount) details.push(`物品「${item[1]}」${afterCount >= beforeCount ? '+' : ''}${numberText(afterCount - beforeCount)}`);
      continue;
    }
    if (change.path === '玩家.生存状态.体力值' && typeof change.before === 'number' && typeof change.after === 'number') {
      details.push(`体力 ${change.after >= change.before ? '+' : ''}${numberText(change.after - change.before)}`);
    }
  }
  for (const [id, delta] of stockChanges) {
    const name = resourceDef(config, after, id)?.name ?? id;
    const wanted = requested?.[id];
    const limited = wanted !== undefined && delta >= 0 ? Math.max(0, wanted - delta) : 0;
    details.push(`${name} ${delta >= 0 ? '+' : ''}${numberText(delta)}${limited > 0 ? `（容量限制，${numberText(limited)} 未收纳）` : ''}`);
  }
  const minutes = Math.max(0, (after.世界.时间系统.时钟?.elapsedMinutes ?? 0) - (before.世界.时间系统.时钟?.elapsedMinutes ?? 0));
  if (minutes > 0) details.push(`耗时${numberText(minutes)}分钟`);
  return details;
}

async function cancellable(pending: Promise<string>, signal: AbortSignal): Promise<string> {
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); });
  try { return await Promise.race([pending, aborted]); } finally { signal.removeEventListener('abort', onAbort); }
}

export class ResourcePlayerActions {
  private ticket: RecipeTicket | undefined;
  private disposed = false;
  constructor(private readonly host: ResourceActionHost, private readonly request: GenerateRecipe = productionRecipeRequest) {}

  activate(): void { this.disposed = false; }
  dispose(): void { this.cancel(); this.disposed = true; }

  cancel = (): void => {
    const ticket = this.ticket;
    if (!ticket) return;
    this.ticket = undefined;
    ticket.controller.abort(new DOMException('配方生成已停止', 'AbortError'));
    if (!this.disposed) this.host.busy(false);
  };

  private blocked(): string | undefined {
    const engine = this.host.getEngine();
    if (this.disposed) return '当前页面已离开。';
    if (engine.isReadOnly) return '当前旅程为只读，无法执行物资操作。';
    if (engine.isGenerating) return '当前回合正在处理，请完成或停止后再执行物资操作。';
    const state = engine.variableManager.getState();
    if (state.v3?.pendingEncounterRequest || (state.v3?.combatSession && state.v3.combatSession.lifecycle !== 'terminal')) return '当前正在处理战斗，请完成后再执行物资操作。';
    if (!resourcesConfigFromWorld(this.host.getWorld())) return '当前世界没有启用物资玩法。';
    return undefined;
  }

  private ownerCurrent(ticket: RecipeTicket): boolean {
    return !this.disposed && this.ticket === ticket && !ticket.controller.signal.aborted
      && this.host.getEngine().variableManager === ticket.manager && this.host.getSaveId() === ticket.saveId
      && recoveryVersion(this.host.getWorld()) === ticket.worldVersion;
  }

  cancelIfInvalid = (): void => {
    const ticket = this.ticket;
    if (ticket && (!this.ownerCurrent(ticket) || this.blocked()
      || recoveryVersion(resourceReadSet(ticket.manager.getState(), this.host.getWorld())) !== ticket.resourceVersion)) this.cancel();
  };

  private reject(feedback: string, publish = true): ResourceActionResult {
    if (publish && !this.disposed) this.host.publish(feedback);
    return { status: 'rejected', feedback };
  }

  perform = (command: ResourceAction): ResourceActionResult => {
    const blocked = this.blocked(); if (blocked) return this.reject(blocked);
    if (this.ticket) return this.reject('配方正在生成，请等待或取消后再执行其他物资操作。');
    const world = structuredClone(this.host.getWorld())!;
    const engine = this.host.getEngine();
    const gameplay = createGameplayHost(world, engine.variableManager.getState());
    const config = gameplay.configOf<{ config: ResourcesConfig }>('resources')!.config;
    const state = gameplay.prepare(engine.variableManager.getState());
    let label: string;
    let requested: Record<string, number> | undefined;
    let outcome: HostOutcome;
    if (command.type === 'gather') {
      const def = resourceDef(config, state, command.resourceId);
      if (!def) return this.reject('该资源不在当前世界中，无法采集。');
      if (Number(state.resources?.stocks?.[def.id] ?? 0) >= resourceCapacity(config, state, def.id)) return this.reject(`「${def.name}」容量已满，先使用资源再采集。`);
      label = `采集「${def.name}」`;
      requested = { [def.id]: def.gather?.amount ?? 1 };
      outcome = gameplay.dispatch(state, 'resources.gather', { id: def.id }, { label });
    } else {
      const recipe = allRecipes(config, state).find(item => item.id === command.recipeId);
      if (!recipe) return this.reject('配方已被删除或不属于当前旅程，请重新选择。');
      if (command.type === 'delete-recipe') {
        if (!recipe.custom) return this.reject('世界自带配方不能从当前存档删除。');
        label = `配方「${recipe.name}」已删除`;
        outcome = gameplay.dispatch(state, 'resources.removeRecipe', { id: recipe.id }, { label });
      } else if (command.type === 'unlock-recipe') {
        label = `配方「${recipe.name}」已解锁`;
        outcome = gameplay.dispatch(state, 'resources.unlockRecipe', { id: recipe.id }, { label });
      } else {
        const outputs = Object.entries(recipe.outputs).filter(([key]) => !key.startsWith('item:'));
        const full = outputs.length > 0 && outputs.every(([key]) => {
          const id = resourceDef(config, state, key)?.id ?? key;
          const consumedOwn = Number(recipe.inputs[id] ?? 0);
          return Number(state.resources?.stocks?.[id] ?? 0) - consumedOwn >= resourceCapacity(config, state, id);
        });
        if (full) return this.reject('产出资源容量已满，未消耗材料；请先腾出容量。');
        label = `制作「${recipe.name}」`;
        requested = Object.fromEntries(outputs);
        outcome = gameplay.dispatch(state, 'resources.craft', { id: recipe.id }, { label });
      }
    }
    if (outcome.status !== 'applied') return this.reject(outcome.reason ?? '当前条件不满足，行动未执行。');
    if (!engine.commitPlayerState(outcome.state)) return this.reject('当前旅程已变化，行动未执行，请重试。');
    const feedback = [label, ...describeOutcome(outcome, config, state, requested)].join('；');
    this.host.accepted(); this.host.publish(feedback);
    return { status: 'accepted', feedback };
  };

  generate = async (playerRequest: string): Promise<ResourceActionResult> => {
    const blocked = this.blocked(); if (blocked) return this.reject(blocked);
    const api = this.host.getApiConfig(); if (!api) return this.reject('请先配置模型，再创建配方。');
    if (!playerRequest.trim()) return this.reject('请说明想制作什么。');
    this.cancel();
    const world = structuredClone(this.host.getWorld())!;
    const engine = this.host.getEngine();
    const currentResources = resourceReadSet(engine.variableManager.getState(), world);
    const ticket: RecipeTicket = { controller: new AbortController(), manager: engine.variableManager, saveId: this.host.getSaveId(), worldVersion: recoveryVersion(world), resourceVersion: recoveryVersion(currentResources) };
    this.ticket = ticket; this.host.busy(true);
    try {
      const text = await cancellable(this.request({ config: structuredClone(api), currentResources, playerRequest, worldTheme: world.name ?? '生存世界' }, ticket.controller.signal), ticket.controller.signal);
      if (!this.ownerCurrent(ticket) || this.blocked()) return this.reject('操作已停止或当前旅程已变化，未创建配方。', false);
      const latest = ticket.manager.getState();
      if (recoveryVersion(resourceReadSet(latest, world)) !== ticket.resourceVersion) return this.reject('资源在生成期间已变化，未创建配方；请按当前资源重新生成。');
      const recipe = parseGeneratedRecipe(text);
      const gameplay = createGameplayHost(world, latest);
      const config = gameplay.configOf<{ config: ResourcesConfig }>('resources')!.config;
      const prepared = gameplay.prepare(latest);
      const unknown = Object.keys(recipe.inputs).filter(id => !resourceDef(config, prepared, id));
      if (unknown.length) return this.reject(`配方使用了不存在的材料「${unknown.join('、')}」，请重试。`);
      const outputId = Object.keys(recipe.outputs)[0];
      if (!resourceDef(config, prepared, outputId)) return this.reject(`当前世界还没有「${outputId}」，不能创建该资源。`);
      if (allRecipes(config, prepared).some(value => value.id === recipe.id)) return this.reject('配方标识与已有配方重复，请重试。');
      const outcome = gameplay.dispatch(prepared, 'resources.addRecipe', { recipe: { ...recipe, craftTimeMinutes: recipe.minutes } }, { label: `创建配方「${recipe.name}」` });
      if (outcome.status !== 'applied' || !this.ownerCurrent(ticket) || !this.host.getEngine().commitPlayerState(outcome.state)) return this.reject('当前旅程已变化，未创建配方。', this.ownerCurrent(ticket));
      const feedback = `配方「${recipe.name}」已创建`;
      this.host.accepted(); this.host.publish(feedback);
      return { status: 'accepted', feedback };
    } catch (error) {
      return this.reject(`配方生成失败：${error instanceof Error ? error.message : String(error)}`, this.ownerCurrent(ticket));
    } finally {
      if (this.ticket === ticket) { this.ticket = undefined; if (!this.disposed) this.host.busy(false); }
    }
  };
}
