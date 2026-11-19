/**
 * 内核模块：所有世界都有的基础变量（时间、地点、主角、货币、物品、人物关系、标记、任务）。
 * 旧中文路径与自创模块的 `game.* / player.*` 输入路径都登记为别名。
 */
import type { GameState, InventoryItem } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { setGameplayPath } from './state';
import type { GameplayStateRoot } from '../gameplay/types';
import { getTimeSystemFromWorld, getWorldClockIndices, normalizeTimeSystemConfig } from '../time/worldClock';
import type { FactSpec, WriteSource } from './facts';
import type { GameplayModule } from './host';

export interface CoreModuleConfig {
  world?: WorldDef;
}

const NARRATIVE_WRITERS: readonly WriteSource[] = ['ai', 'event', 'director', 'custom', 'player'];
const MECHANICAL_WRITERS: readonly WriteSource[] = ['ai', 'event', 'custom'];

function root(state: GameState): GameplayStateRoot {
  return state as unknown as GameplayStateRoot;
}

function dayNumber(state: GameState, world: WorldDef | undefined): number {
  const clock = state.世界?.时间系统?.时钟;
  if (!clock) return 1;
  const config = normalizeTimeSystemConfig(getTimeSystemFromWorld(world));
  const now = getWorldClockIndices(clock, config).day;
  const start = getWorldClockIndices({ ...clock, elapsedMinutes: 0 }, config).day;
  return now - start + 1;
}

function questStatus(state: GameState, name: string): string {
  const tasks = state.玩家?.任务系统;
  if (tasks?.活跃任务?.[name]) return '进行中';
  if (tasks?.已完成任务?.[name]) return '已完成';
  if (tasks?.已失败任务?.[name]) return '已失败';
  return '未接取';
}

/** 规范属性键：attrA/attrB 对应存档里的 血量/体力值。 */
export function statField(id: string): string {
  return id === 'attrA' || id === 'hp' ? '血量' : id === 'attrB' || id === 'stamina' ? '体力值' : id;
}

function ensureItem(state: GameState, name: string): InventoryItem {
  const player = state.玩家;
  player.物品栏 ??= {};
  player.物品栏[name] ??= { 数量: 0, 类型: '杂物', 品质: '普通', 备注: '' };
  return player.物品栏[name];
}

export function coreFactSpecs(world?: WorldDef): FactSpec[] {
  return [
    { id: 'turn', module: 'core', type: 'number', label: '当前回合', aliases: ['game.round', 'simulationRuntime.tick'],
      read: state => Math.max(0, Math.trunc(Number(state.simulationRuntime?.tick) || 0)), writable: [] },
    { id: 'world.time', module: 'core', type: 'string', label: '世界时间', aliases: ['世界.时间系统.当前时间', 'game.time'],
      storage: '世界.时间系统.当前时间', writable: [] },
    { id: 'world.minutes', module: 'core', type: 'number', label: '世界已过分钟', aliases: ['game.elapsedMinutes'],
      read: state => state.世界?.时间系统?.时钟?.elapsedMinutes ?? 0, writable: [] },
    { id: 'world.hour', module: 'core', type: 'number', label: '当前钟点（0-23）',
      read: state => {
        const clock = state.世界?.时间系统?.时钟;
        return clock ? getWorldClockIndices(clock, getTimeSystemFromWorld(world)).hourOfDay : undefined;
      }, writable: [] },
    { id: 'world.day', module: 'core', type: 'number', label: '第几天（从开局算起）', read: state => dayNumber(state, world), writable: [] },
    { id: 'world.weather', module: 'core', type: 'string', label: '天气', aliases: ['世界.时间系统.当前天气'],
      storage: '世界.时间系统.当前天气', writable: NARRATIVE_WRITERS },
    { id: 'world.location', module: 'core', type: 'string', label: '当前位置', aliases: ['世界.空间定位.当前位置', 'game.location'],
      storage: '世界.空间定位.当前位置', writable: NARRATIVE_WRITERS },
    { id: 'world.axis.{axis}.{field}', module: 'core', type: 'string', label: '世界状态·{axis}·{field}',
      aliases: ['世界.状态轴.{axis}.{field}'], storage: '世界.状态轴.{axis}.{field}', writable: ['ai', 'event', 'director', 'custom'],
      enumerate: state => Object.entries(state.世界?.状态轴 ?? {}).flatMap(([axis, fields]) =>
        Object.keys(fields ?? {}).map(field => ({ params: { axis, field } }))) },
    { id: 'player.name', module: 'core', type: 'string', label: '主角姓名', aliases: ['玩家.姓名'], storage: '玩家.姓名', writable: [] },
    { id: 'player.goal', module: 'core', type: 'string', label: '当前目标', aliases: ['玩家.当前目标'], storage: '玩家.当前目标', writable: NARRATIVE_WRITERS },
    { id: 'player.hp', module: 'core', type: 'number', label: '生命', aliases: ['玩家.生存状态.血量', 'player.stats.hp'],
      storage: '玩家.生存状态.血量', bounds: { min: 0 }, writable: MECHANICAL_WRITERS },
    { id: 'player.stamina', module: 'core', type: 'number', label: '体力', aliases: ['玩家.生存状态.体力值', 'player.stats.stamina'],
      storage: '玩家.生存状态.体力值', bounds: { min: 0 }, writable: MECHANICAL_WRITERS },
    {
      id: 'player.stats.{id}', module: 'core', type: 'number', label: '属性·{id}', aliases: ['玩家.生存状态.{id}', 'stats.{id}'],
      bounds: { min: 0 }, writable: MECHANICAL_WRITERS,
      description: 'attrA=生命、attrB=体力、dim1~dim6=六维，其余为世界特色属性。',
      read: (state, { id }) => state.玩家?.生存状态?.[statField(id)],
      write: (state, { id }, value) => {
        const stats = state.玩家?.生存状态;
        if (!stats) return '没有属性数据';
        const field = statField(id);
        if (!(field in stats)) return `未知属性「${id}」；可用：${Object.keys(stats).join('、')}`;
        stats[field] = Number(value);
        return true;
      },
      enumerate: state => Object.keys(state.玩家?.生存状态 ?? {}).map(id => ({ params: { id } })),
    },
    { id: 'player.combatState', module: 'core', type: 'string', label: '战斗状态', aliases: ['玩家.战斗状态'], storage: '玩家.战斗状态', writable: [] },
    { id: 'player.currency', module: 'core', type: 'number', label: '钱袋（主货币）',
      aliases: ['玩家.货币资源.主货币.数量', '货币资源.主货币', 'player.currency.primary', 'currency'],
      storage: '玩家.货币资源.主货币.数量', bounds: { min: 0 }, writable: MECHANICAL_WRITERS,
      description: '主货币（钱袋）。经营收支也走这里。' },
    { id: 'player.currencyName', module: 'core', type: 'string', label: '货币名称', aliases: ['玩家.货币资源.主货币.名称'],
      storage: '玩家.货币资源.主货币.名称', writable: [] },
    { id: 'player.items.{name}', module: 'core', type: 'number', label: '物品·{name}', unit: '件',
      aliases: ['玩家.物品栏.{name}.数量'], bounds: { min: 0, integer: true }, writable: MECHANICAL_WRITERS,
      read: (state, { name }) => state.玩家?.物品栏?.[name]?.数量 ?? 0,
      write: (state, { name }, value) => {
        const quantity = Math.max(0, Math.round(Number(value) || 0));
        if (quantity <= 0) {
          if (state.玩家?.物品栏?.[name]) delete state.玩家.物品栏[name];
          return true;
        }
        ensureItem(state, name).数量 = quantity;
        return true;
      },
      enumerate: state => Object.keys(state.玩家?.物品栏 ?? {}).map(name => ({ params: { name } })) },
    { id: 'npc.{id}.affinity', module: 'core', type: 'number', label: '{id}·好感度', aliases: ['人物档案.{id}.关系数据.好感度'],
      storage: '人物档案.{id}.关系数据.好感度', bounds: { min: -100, max: 100 }, writable: MECHANICAL_WRITERS,
      enumerate: state => Object.keys(state.人物档案 ?? {}).map(id => ({ params: { id } })) },
    { id: 'npc.{id}.relation', module: 'core', type: 'string', label: '{id}·关系', aliases: ['人物档案.{id}.关系数据.关系类型'],
      storage: '人物档案.{id}.关系数据.关系类型', writable: NARRATIVE_WRITERS,
      enumerate: state => Object.keys(state.人物档案 ?? {}).map(id => ({ params: { id } })) },
    { id: 'npc.{id}.location', module: 'core', type: 'string', label: '{id}·位置', aliases: ['人物档案.{id}.个人信息.当前位置'],
      storage: '人物档案.{id}.个人信息.当前位置', writable: NARRATIVE_WRITERS,
      enumerate: state => Object.keys(state.人物档案 ?? {}).map(id => ({ params: { id } })) },
    { id: 'npc.{id}.present', module: 'core', type: 'boolean', label: '{id}·在场', writable: [],
      read: (state, { id }) => state.人物档案?.[id]?.人物分类 === '在场',
      enumerate: state => Object.keys(state.人物档案 ?? {}).map(id => ({ params: { id } })) },
    { id: 'npc.{id}.known', module: 'core', type: 'boolean', label: '认识{id}', writable: [],
      read: (state, { id }) => Boolean(state.人物档案?.[id]),
      enumerate: state => Object.keys(state.人物档案 ?? {}).map(id => ({ params: { id } })) },
    { id: 'flags.{key}', module: 'core', type: 'any', label: '标记·{key}', storage: 'flags.{key}',
      writable: ['ai', 'event', 'director', 'custom', 'player'],
      enumerate: state => Object.keys((state as unknown as { flags?: Record<string, unknown> }).flags ?? {}).map(key => ({ params: { key } })) },
    { id: 'quest.{name}.status', module: 'core', type: 'string', label: '任务「{name}」状态', writable: [],
      read: (state, { name }) => questStatus(state, name),
      enumerate: state => {
        const tasks = state.玩家?.任务系统;
        return [...new Set([...Object.keys(tasks?.活跃任务 ?? {}), ...Object.keys(tasks?.已完成任务 ?? {}), ...Object.keys(tasks?.已失败任务 ?? {})])]
          .map(name => ({ params: { name } }));
      } },
    { id: 'quest.{name}.progress', module: 'core', type: 'number', label: '任务「{name}」进度', aliases: ['玩家.任务系统.活跃任务.{name}.进度'],
      storage: '玩家.任务系统.活跃任务.{name}.进度', bounds: { min: 0, max: 100 }, writable: MECHANICAL_WRITERS,
      enumerate: state => Object.keys(state.玩家?.任务系统?.活跃任务 ?? {}).map(name => ({ params: { name } })) },
  ];
}

/** 写 flags 时确保根存在（旧卡片 effect.flag 直接写 `flags.xxx`）。 */
export function setFlag(state: GameState, key: string, value: unknown): void {
  setGameplayPath(root(state), `flags.${key}`, value);
}

export const coreModule: GameplayModule<CoreModuleConfig> = {
  id: 'core',
  label: '基础',
  order: 0,
  resolveConfig: world => ({ world }),
  facts: config => coreFactSpecs(config.world),
  domainEvents: config => [
    { type: 'turn.started', label: '回合开始（正文生成前）' },
    { type: 'turn.ended', label: '回合结束（正文已接受）' },
    { type: 'time.passed', label: '时间流逝', payload: 'minutes 为本回合经过的分钟数' },
    { type: 'time.hour', label: '跨过整点', payload: 'count 为跨过的小时数' },
    { type: 'time.day', label: '跨过一天', payload: 'count 为跨过的天数' },
    { type: 'time.week', label: '跨过一周' },
    { type: 'time.month', label: '跨过一个月' },
    { type: 'quest.accepted', label: '接取任务', payload: 'name 为任务名' },
    { type: 'quest.completed', label: '完成任务', payload: 'name 为任务名' },
    { type: 'quest.failed', label: '任务失败', payload: 'name 为任务名' },
    { type: 'modifier.expired', label: '临时加成到期', payload: 'id、label' },
    ...(config.world?.modules?.some(module => module.moduleId === 'combat' && module.enabled)
      ? [{ type: 'combat.ended', label: '战斗结束（下一回合开始时送达）', payload: 'status 为 victory/defeat/escaped/draw' }]
      : []),
  ],
  prepare: state => {
    state.玩家.货币资源 ??= { 主货币: { 名称: '', 数量: 0 } };
    state.玩家.货币资源.主货币 ??= { 名称: '', 数量: 0 };
  },
  /** 任务状态多由 AI 改写：一次操作结束后比较前后，补发接取/完成/失败事件（成长、事件规则据此联动）。 */
  onSettle: (state, context, before) => {
    const names = (source: GameState, key: '活跃任务' | '已完成任务' | '已失败任务') => Object.keys(source.玩家?.任务系统?.[key] ?? {});
    const had = (key: '活跃任务' | '已完成任务' | '已失败任务') => new Set(names(before, key));
    const done = had('已完成任务');
    const failed = had('已失败任务');
    const active = had('活跃任务');
    for (const name of names(state, '已完成任务')) if (!done.has(name)) context.emit('quest.completed', { name });
    for (const name of names(state, '已失败任务')) if (!failed.has(name)) context.emit('quest.failed', { name });
    for (const name of names(state, '活跃任务')) if (!active.has(name) && !done.has(name) && !failed.has(name)) context.emit('quest.accepted', { name });
  },
};
