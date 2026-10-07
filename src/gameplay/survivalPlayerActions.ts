import type { ApiConfig } from '../api/types';
import type { GameEngine } from '../engine/types';
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import type { SurvivalModuleSchema, SurvivalRecipe } from '../modules/schema';
import type { GameplayChange, GameplayValue } from './types';
import { getGameplayPath, executeGameplayTransaction } from './kernel';
import { craftSurvivalRecipe, gatherSurvivalResource, unlockSurvivalRecipe } from './modules/survival';
import { getTimeSystemFromWorld } from '../time/worldClock';
import { normalizeRecipeInputs, normalizeRecipeOutput } from '../utils/formatNormalize';
import { recoveryVersion } from '../engine/turnRecovery';

export type SurvivalAction = { type: 'gather'; resourceId: string } | { type: 'craft' | 'unlock-recipe' | 'delete-recipe'; recipeId: string };
export interface SurvivalActionResult { status: 'accepted' | 'rejected'; feedback: string }
export interface RecipeGenerationRequest { config: ApiConfig; currentResources: Array<{ id: string; name: string; amount: number; max: number }>; playerRequest: string; worldTheme: string }
export interface SurvivalActionHost {
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

function survivalConfig(world?: WorldDef): SurvivalModuleSchema | undefined {
  return world?.modules?.find(module => module.moduleId === 'survival' && module.enabled)?.moduleConfig as SurvivalModuleSchema | undefined;
}
export function survivalResourceReadSet(state: GameState, world?: WorldDef): RecipeGenerationRequest['currentResources'] {
  const config = survivalConfig(world);
  return Object.entries(state.玩家.生存资源 ?? {}).map(([id, value]) => ({
    id, name: config?.resources?.find(resource => resource.id === id)?.name ?? value.name ?? id,
    amount: value.数量, max: value.最大值 ?? config?.resources?.find(resource => resource.id === id)?.max ?? 9999,
  })).sort((first, second) => first.id.localeCompare(second.id));
}
async function productionRecipeRequest(input: RecipeGenerationRequest, signal: AbortSignal): Promise<string> {
  const { buildRecipeGenPrompt } = await import('../modules/prompts');
  const { requestStreamWithRetry } = await import('../api/client');
  if (signal.aborted) throw signal.reason;
  const prompt = buildRecipeGenPrompt(input);
  return (await requestStreamWithRetry(input.config, [{ role: 'user', content: prompt }], { signal, onDelta: () => {} })).text;
}
function parseRecipe(text: string): SurvivalRecipe {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  if (!match) throw new Error('模型没有返回有效的配方 JSON，请重试。');
  const raw = JSON.parse(match[1].trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/、/g, ','));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配方格式无效，请重试。');
  // Reject invalid declared costs before the tolerant legacy format normalizer can drop them.
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
  return { id: String(raw.id || `recipe_${crypto.randomUUID()}`), name: String(raw.name || '未知配方'), description: String(raw.description || ''),
    inputs: normalizeRecipeInputs(raw.inputs), output, craftTimeMinutes: Math.min(1440, Math.max(1, Math.trunc(Number(raw.craftTimeMinutes) || 30))) };
}
function numberText(value: number): string { return String(Math.round(value * 1000) / 1000); }
function summarizeChanges(after: GameState, changes: readonly GameplayChange[], config: SurvivalModuleSchema, requested?: { resourceId: string; amount: number }): string[] {
  return changes.flatMap(change => {
    if (typeof change.before !== 'number' || typeof change.after !== 'number') return [];
    const resource = /^玩家\.生存资源\.([^.]+)\.数量$/.exec(change.path), inventory = /^玩家\.物品栏\.([^.]+)\.数量$/.exec(change.path);
    if (!resource && !inventory && change.path !== '玩家.生存状态.体力值') return [];
    const id = resource?.[1] ?? inventory?.[1];
    const label = resource ? config.resources.find(value => value.id === id)?.name ?? after.玩家.生存资源?.[id!]?.name ?? id!
      : inventory ? `物品「${id}」` : '体力';
    // A later production into the same resource must not hide its earlier material cost.
    const actual = change.operation === 'cost' ? change.after : Number(getGameplayPath(after, change.path));
    if (!Number.isFinite(actual)) return [];
    const delta = actual - change.before;
    const output = resource && requested?.resourceId === id && change.operation === 'add' ? requested : undefined;
    const limited = output ? Math.max(0, output.amount - Math.max(0, delta)) : 0;
    return [`${label} ${delta >= 0 ? '+' : ''}${numberText(delta)}${limited > 0 ? `（容量限制，${numberText(limited)} 未收纳）` : ''}`];
  });
}
async function cancellable(pending: Promise<string>, signal: AbortSignal): Promise<string> {
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); });
  try { return await Promise.race([pending, aborted]); } finally { signal.removeEventListener('abort', onAbort); }
}

/** One original engine owns gameplay and persistence; this service only proposes player changes. */
export class SurvivalPlayerActions {
  private ticket: RecipeTicket | undefined;
  private disposed = false;
  constructor(private readonly host: SurvivalActionHost, private readonly request: GenerateRecipe = productionRecipeRequest) {}
  activate(): void { this.disposed = false; }
  dispose(): void { this.cancel(); this.disposed = true; }
  cancel = (): void => {
    const ticket = this.ticket;
    if (!ticket) return;
    this.ticket = undefined; ticket.controller.abort(new DOMException('配方生成已停止', 'AbortError'));
    if (!this.disposed) this.host.busy(false);
  };
  private blocked(): string | undefined {
    const engine = this.host.getEngine();
    if (this.disposed) return '当前页面已离开。';
    if (engine.isReadOnly) return '当前旅程为只读，无法执行生存操作。';
    if (engine.isGenerating) return '当前回合正在处理，请完成或停止后再执行生存操作。';
    const state = engine.variableManager.getState();
    if (state.v3?.pendingEncounterRequest || (state.v3?.combatSession && state.v3.combatSession.lifecycle !== 'terminal')) return '当前正在处理战斗，请完成后再执行生存操作。';
    if (!survivalConfig(this.host.getWorld())) return '当前世界没有启用生存资源玩法。';
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
      || recoveryVersion(survivalResourceReadSet(ticket.manager.getState(), this.host.getWorld())) !== ticket.resourceVersion)) this.cancel();
  };
  private reject(feedback: string, publish = true): SurvivalActionResult {
    if (publish && !this.disposed) this.host.publish(feedback);
    return { status: 'rejected', feedback };
  }
  perform = (command: SurvivalAction): SurvivalActionResult => {
    const blocked = this.blocked(); if (blocked) return this.reject(blocked);
    if (this.ticket) return this.reject('配方正在生成，请等待或取消后再执行其他生存操作。');
    const world = structuredClone(this.host.getWorld())!, config = survivalConfig(world)!;
    const engine = this.host.getEngine(), state = engine.variableManager.getState();
    const context = { tick: state.simulationRuntime?.tick ?? 0, enabledModules: ['survival'], worldClockConfig: getTimeSystemFromWorld(world) };
    let result, label: string, requested: { resourceId: string; amount: number } | undefined;
    if (command.type === 'gather') {
      const resource = config.resources.find(value => value.id === command.resourceId), current = state.玩家.生存资源?.[command.resourceId];
      if (!resource || !current) return this.reject('该资源不在当前世界中，无法采集。');
      if (current.数量 >= (current.最大值 ?? resource.max)) return this.reject(`「${resource.name}」容量已满，先使用资源再采集。`);
      label = `采集「${resource.name}」`; requested = { resourceId: resource.id, amount: Math.max(1, Math.trunc(Number(resource.gatherAmount) || 1)) };
      result = gatherSurvivalResource(state, config, resource.id, context);
    } else {
      const runtime = state.玩家.生存配方 ?? [], fixed = config.recipes?.find(recipe => recipe.id === command.recipeId);
      const recipe = fixed ?? runtime.find(recipe => recipe.id === command.recipeId);
      if (!recipe) return this.reject('配方已被删除或不属于当前旅程，请重新选择。');
      if (command.type === 'delete-recipe') {
        if (fixed || !runtime.some(value => value.id === recipe.id)) return this.reject('世界自带配方不能从当前存档删除。');
        label = `配方「${recipe.name}」已删除`;
        result = executeGameplayTransaction(state, { id: `survival:delete:${crypto.randomUUID()}`, moduleId: 'survival', source: 'player', label,
          effects: [{ set: { path: '玩家.生存配方', value: runtime.filter(value => value.id !== recipe.id) as unknown as GameplayValue } }] }, context);
      } else if (command.type === 'unlock-recipe') {
        label = `配方「${recipe.name}」已解锁`; result = unlockSurvivalRecipe(state, recipe, context);
      } else {
        const output = state.玩家.生存资源?.[recipe.output.resourceId];
        const maximum = output?.最大值 ?? config.resources.find(resource => resource.id === recipe.output.resourceId)?.max;
        if (output && maximum !== undefined && output.数量 - (recipe.inputs[recipe.output.resourceId] ?? 0) >= maximum) return this.reject('产出资源容量已满，未消耗材料；请先腾出容量。');
        if ((recipe.unlockConditions?.length || recipe.unlockCost?.length) && !state.gameplay?.survival?.unlockedRecipes.includes(recipe.id)) return this.reject('请先满足条件并解锁该配方。');
        label = `制作「${recipe.name}」`; requested = recipe.output; result = craftSurvivalRecipe(state, recipe, context, maximum);
      }
    }
    if (result.status !== 'applied') return this.reject(result.reason ?? '当前条件不满足，行动未执行。');
    if (!engine.commitPlayerState(result.state)) return this.reject('当前旅程已变化，行动未执行，请重试。');
    const actual = engine.variableManager.getState();
    const minutes = Math.max(0, (actual.世界.时间系统.时钟?.elapsedMinutes ?? 0) - (state.世界.时间系统.时钟?.elapsedMinutes ?? 0));
    const details = summarizeChanges(actual, result.changes, config, requested);
    if (minutes > 0) details.push(`耗时${numberText(minutes)}分钟`);
    const feedback = [label, ...details].join('；');
    this.host.accepted(); this.host.publish(feedback); return { status: 'accepted', feedback };
  };
  generate = async (playerRequest: string): Promise<SurvivalActionResult> => {
    const blocked = this.blocked(); if (blocked) return this.reject(blocked);
    const api = this.host.getApiConfig(); if (!api) return this.reject('请先配置模型，再创建配方。');
    if (!playerRequest.trim()) return this.reject('请说明想制作什么。');
    this.cancel();
    const world = structuredClone(this.host.getWorld())!, config = survivalConfig(world)!;
    const engine = this.host.getEngine(), state = engine.variableManager.getState(), currentResources = survivalResourceReadSet(state, world);
    const ticket: RecipeTicket = { controller: new AbortController(), manager: engine.variableManager, saveId: this.host.getSaveId(), worldVersion: recoveryVersion(world), resourceVersion: recoveryVersion(currentResources) };
    this.ticket = ticket; this.host.busy(true);
    try {
      const text = await cancellable(this.request({ config: structuredClone(api), currentResources, playerRequest, worldTheme: world.name ?? '生存世界' }, ticket.controller.signal), ticket.controller.signal);
      if (!this.ownerCurrent(ticket) || this.blocked()) return this.reject('操作已停止或当前旅程已变化，未创建配方。', false);
      const latest = ticket.manager.getState();
      if (recoveryVersion(survivalResourceReadSet(latest, world)) !== ticket.resourceVersion) return this.reject('资源在生成期间已变化，未创建配方；请按当前资源重新生成。');
      const recipe = parseRecipe(text), valid = new Set([...config.resources.map(resource => resource.id), ...Object.keys(latest.玩家.生存资源 ?? {})]);
      const unknown = Object.keys(recipe.inputs).filter(id => !valid.has(id));
      if (unknown.length) return this.reject(`配方使用了不存在的材料「${unknown.join('、')}」，请重试。`);
      if (!valid.has(recipe.output.resourceId)) return this.reject(`当前世界还没有「${recipe.output.resourceId}」，不能创建该资源。`);
      if ([...(config.recipes ?? []), ...(latest.玩家.生存配方 ?? [])].some(value => value.id === recipe.id)) return this.reject('配方标识与已有配方重复，请重试。');
      const result = executeGameplayTransaction(latest, { id: `survival:recipe:${crypto.randomUUID()}`, moduleId: 'survival', source: 'player', label: `创建配方「${recipe.name}」`,
        effects: [{ set: { path: '玩家.生存配方', value: [...(latest.玩家.生存配方 ?? []), recipe] as unknown as GameplayValue } }] }, { tick: latest.simulationRuntime?.tick ?? 0, enabledModules: ['survival'] });
      if (result.status !== 'applied' || !this.ownerCurrent(ticket) || !this.host.getEngine().commitPlayerState(result.state)) return this.reject('当前旅程已变化，未创建配方。', this.ownerCurrent(ticket));
      const feedback = `配方「${recipe.name}」已创建`; this.host.accepted(); this.host.publish(feedback);
      return { status: 'accepted', feedback };
    } catch (error) {
      return this.reject(`配方生成失败：${error instanceof Error ? error.message : String(error)}`, this.ownerCurrent(ticket));
    } finally {
      if (this.ticket === ticket) { this.ticket = undefined; if (!this.disposed) this.host.busy(false); }
    }
  };
}
