import type { WorldModule } from '../data/worlds-schema';
import type { CustomModuleAgentWorldContext } from './agentSession';

export const CUSTOM_MODULE_LIFECYCLES = ['onGameStart', 'onTurnEnd', 'onTick', 'onChoice', 'onButton'] as const;
export const CUSTOM_MODULE_STATE_FIELD_TYPES = ['number', 'string', 'boolean', 'enum', 'array', 'object'] as const;
export const CUSTOM_MODULE_CONDITION_KINDS = ['compare', 'all', 'any', 'not'] as const;
export const CUSTOM_MODULE_ACTION_KINDS = ['set', 'add', 'subtract', 'toggle', 'append', 'remove', 'log'] as const;
export const CUSTOM_MODULE_VIEW_COMPONENTS = ['section', 'card', 'text', 'number', 'progress', 'badge', 'list', 'table', 'divider', 'conditional', 'button'] as const;

export type CustomModuleValueType = 'number' | 'string' | 'boolean' | 'array' | 'object';

type InputCapability = { type: CustomModuleValueType; description: string };

const BASE_INPUT_PATHS = {
  'game.round': { type: 'number', description: '当前玩家回合序号' },
  'game.time': { type: 'string', description: '当前世界时间' },
  'player.stats.attrA': { type: 'number', description: '玩家规范属性 attrA' },
  'player.stats.attrB': { type: 'number', description: '玩家规范属性 attrB' },
} as const satisfies Record<string, InputCapability>;

const STAT_INPUT_PATHS = {
  'player.stats.dim1': { type: 'number', description: '玩家规范属性 dim1' },
  'player.stats.dim2': { type: 'number', description: '玩家规范属性 dim2' },
  'player.stats.dim3': { type: 'number', description: '玩家规范属性 dim3' },
  'player.stats.dim4': { type: 'number', description: '玩家规范属性 dim4' },
  'player.stats.dim5': { type: 'number', description: '玩家规范属性 dim5' },
  'player.stats.dim6': { type: 'number', description: '玩家规范属性 dim6' },
} as const satisfies Record<string, InputCapability>;

const OPTIONAL_INPUT_PATHS = {
  'player.currency.primary': { type: 'number', description: '玩家主货币数量' },
  'player.business.funds': { type: 'number', description: '经营模块可用资金' },
  'player.business.assetCount': { type: 'number', description: '经营模块资产数量' },
} as const satisfies Record<string, InputCapability>;

const EVENT_INPUT_PATHS = {
  'event.choice': { type: 'object', description: '当前选择事件只读快照' },
  'event.choice.type': { type: 'string', description: '选择事件类型' },
  'event.choice.eventPackId': { type: 'string', description: '选择所属事件包 ID' },
  'event.choice.cardId': { type: 'string', description: '选择所属卡片 ID' },
  'event.choice.blockId': { type: 'string', description: '选择块 ID' },
  'event.choice.selectedIndex': { type: 'number', description: '当前选择序号' },
  'event.choice.label': { type: 'string', description: '当前选择标签' },
  'event.button': { type: 'object', description: '当前模块按钮事件只读快照' },
  'event.button.type': { type: 'string', description: '按钮事件类型' },
  'event.button.moduleId': { type: 'string', description: '触发按钮的模块 ID' },
  'event.button.event': { type: 'string', description: '触发按钮事件名' },
} as const satisfies Record<string, InputCapability>;

/** Global validator/runtime allow-list. The Agent catalog below narrows this to the selected world. */
export const CUSTOM_MODULE_SAFE_INPUT_PATHS = {
  ...BASE_INPUT_PATHS,
  ...STAT_INPUT_PATHS,
  ...OPTIONAL_INPUT_PATHS,
  ...EVENT_INPUT_PATHS,
} as const;

export const CUSTOM_MODULE_SAFE_EVENT_PATHS = {
  choice: 'object',
  'choice.type': 'string',
  'choice.eventPackId': 'string',
  'choice.cardId': 'string',
  'choice.blockId': 'string',
  'choice.selectedIndex': 'number',
  'choice.label': 'string',
  button: 'object',
  'button.type': 'string',
  'button.moduleId': 'string',
  'button.event': 'string',
} as const satisfies Record<string, CustomModuleValueType>;

const SAFE_SEGMENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const SURVIVAL_LEAF = /^player\.survival\.([A-Za-z][A-Za-z0-9_]*)\.(amount|max)$/;

export function isSafeCustomModuleResourceId(id: string): boolean {
  return SAFE_SEGMENT.test(id);
}

export function getCustomModuleSafeInputType(path: string): CustomModuleValueType | undefined {
  const exact = (CUSTOM_MODULE_SAFE_INPUT_PATHS as Record<string, InputCapability>)[path];
  if (exact) return exact.type;
  return SURVIVAL_LEAF.test(path) ? 'number' : undefined;
}

export function getCustomModuleSafeEventType(path: string): CustomModuleValueType | undefined {
  return (CUSTOM_MODULE_SAFE_EVENT_PATHS as Record<string, CustomModuleValueType>)[path];
}

export interface CustomModuleWorldCapabilitySource {
  id: string;
  name: string;
  description?: string;
  modules?: Array<Pick<WorldModule, 'moduleId' | 'enabled' | 'moduleConfig'> & Partial<Pick<WorldModule, 'name'>>>;
}

export function buildCustomModuleAgentWorldContext(
  world: CustomModuleWorldCapabilitySource,
): CustomModuleAgentWorldContext {
  const enabled = world.modules?.filter((module) => module.enabled) ?? [];
  const stat = enabled.some((module) => module.moduleId === 'stat');
  const survivalModule = enabled.find((module) => module.moduleId === 'survival');
  const business = enabled.some((module) => module.moduleId === 'business');
  const resources = survivalModule?.moduleConfig?.resources;
  const survivalResourceIds = Array.isArray(resources)
    ? [...new Set(resources.flatMap((resource) => {
      if (!resource || typeof resource !== 'object' || !('id' in resource)) return [];
      const id = (resource as { id?: unknown }).id;
      return typeof id === 'string' && isSafeCustomModuleResourceId(id) ? [id] : [];
    }))]
    : [];

  return {
    id: world.id,
    name: world.name,
    ...(world.description ? { description: world.description } : {}),
    availability: {
      stat,
      survival: Boolean(survivalModule),
      business,
      currency: !business,
    },
    survivalResourceIds,
  };
}

export interface CustomModuleCapabilityCatalog {
  version: 1;
  world: CustomModuleAgentWorldContext & {
    availability: { stat: boolean; survival: boolean; business: boolean; currency: boolean };
    survivalResourceIds: string[];
  };
  lifecycles: readonly string[];
  safeInputPaths: Record<string, InputCapability>;
  stateFieldTypes: readonly string[];
  conditions: readonly string[];
  actions: readonly string[];
  viewComponents: readonly string[];
  writes: 'own-state-only';
}

export function buildCustomModuleCapabilityCatalog(
  world: CustomModuleAgentWorldContext,
): CustomModuleCapabilityCatalog {
  const availability = {
    stat: world.availability?.stat ?? false,
    survival: world.availability?.survival ?? false,
    business: world.availability?.business ?? false,
    currency: world.availability?.currency ?? !world.availability?.business,
  };
  const survivalResourceIds = availability.survival
    ? [...new Set((world.survivalResourceIds ?? []).filter(isSafeCustomModuleResourceId))]
    : [];
  const safeInputPaths: Record<string, InputCapability> = {
    ...BASE_INPUT_PATHS,
    ...EVENT_INPUT_PATHS,
  };

  if (availability.stat) Object.assign(safeInputPaths, STAT_INPUT_PATHS);
  if (availability.currency && !availability.business) {
    safeInputPaths['player.currency.primary'] = OPTIONAL_INPUT_PATHS['player.currency.primary'];
  }
  if (availability.business) {
    safeInputPaths['player.business.funds'] = OPTIONAL_INPUT_PATHS['player.business.funds'];
    safeInputPaths['player.business.assetCount'] = OPTIONAL_INPUT_PATHS['player.business.assetCount'];
  }
  for (const resourceId of survivalResourceIds) {
    safeInputPaths[`player.survival.${resourceId}.amount`] = { type: 'number', description: `生存资源 ${resourceId} 当前数量` };
    safeInputPaths[`player.survival.${resourceId}.max`] = { type: 'number', description: `生存资源 ${resourceId} 上限` };
  }

  return {
    version: 1,
    world: { ...world, availability, survivalResourceIds },
    lifecycles: [...CUSTOM_MODULE_LIFECYCLES],
    safeInputPaths,
    stateFieldTypes: [...CUSTOM_MODULE_STATE_FIELD_TYPES],
    conditions: [...CUSTOM_MODULE_CONDITION_KINDS],
    actions: [...CUSTOM_MODULE_ACTION_KINDS],
    viewComponents: [...CUSTOM_MODULE_VIEW_COMPONENTS],
    writes: 'own-state-only',
  };
}
