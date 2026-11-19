import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import { createGameplayHost } from '../../core/registry';

/**
 * 存档兼容测试的「玩家可见数值」摘要。
 *
 * 期望值由基线 10b4eec 的旧代码生成（scripts/fixtures/generateMidgameSaves.ts）。
 * 重构改变内部存储位置时，只改这里的读取方式；摘要里的数值保持不变，
 * 有意的语义变化必须在 saveCompat.test.ts 里逐条写明。
 */
function survivalSummary(state: GameState, world: WorldDef | undefined) {
  if (state.resources) {
    // 资源模块（v2）：数量与上限经变量注册表读取，与旧版 生存资源.数量/最大值 一一对应。
    const facts = createGameplayHost(world, state).facts;
    return Object.keys(state.resources.stocks)
      .map(id => [id, facts.read(state, `player.resources.${id}`) as number ?? null, facts.read(state, `player.resources.${id}.max`) as number ?? null] as const)
      .sort(([left], [right]) => left.localeCompare(right));
  }
  return Object.entries(state.玩家.生存资源 ?? {})
    .map(([id, resource]) => [id, resource?.数量 ?? null, resource?.最大值 ?? null] as const)
    .sort(([left], [right]) => left.localeCompare(right));
}

export function summarizeCompatState(state: GameState, world?: WorldDef) {
  const player = state.玩家;
  const vitals = player.生存状态 ?? ({} as Record<string, number>);
  const stats = Object.entries(vitals)
    .filter(([key]) => key !== '血量' && key !== '体力值')
    .map(([key, value]) => [key, value] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const abilities = player.能力系统;
  const business = player.经营资产;
  const npcs = Object.entries(state.人物档案 ?? {})
    .map(([id, npc]) => [id, npc?.关系数据?.好感度 ?? null, npc?.关系数据?.关系类型 ?? null] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const tasks = player.任务系统;
  return {
    player: {
      name: player.姓名,
      age: String(player.年龄 ?? ''),
      gender: player.性别,
      job: player.身份信息?.职业 ?? '',
      goal: player.当前目标 ?? '',
    },
    world: {
      time: state.世界?.时间系统?.当前时间 ?? '',
      elapsedMinutes: state.世界?.时间系统?.时钟?.elapsedMinutes ?? null,
      location: state.世界?.空间定位?.当前位置 ?? '',
    },
    vitals: { hp: vitals.血量 ?? null, stamina: vitals.体力值 ?? null },
    stats,
    currency: { name: player.货币资源?.主货币?.名称 ?? '', amount: player.货币资源?.主货币?.数量 ?? null },
    items: Object.entries(player.物品栏 ?? {}).map(([name, item]) => [name, item?.数量 ?? null] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    skills: Object.keys(player.技能系统 ?? {}).sort(),
    abilities: abilities ? {
      talentPoints: abilities.天赋点 ?? 0,
      skillPoints: abilities.技能点 ?? 0,
      professionId: abilities.职业状态?.职业ID ?? null,
      professionLevel: abilities.职业状态?.职业等级 ?? null,
      abilityPoints: abilities.职业状态?.能力点 ?? null,
      unlocked: Object.keys(abilities.职业状态?.已解锁能力 ?? {}).sort(),
      innate: Object.keys(abilities.先天天赋 ?? {}).sort(),
    } : null,
    progression: {
      tier: player.当前段位索引 ?? null,
      xp: player.当前经验值 ?? null,
      statPoints: player.可用属性点 ?? null,
    },
    survival: survivalSummary(state, world),
    business: state.economy ? {
      // 经营模块（v2）：资金已并入钱袋，这里记 null；产业与仓库一一对应旧版资产列表与库存。
      funds: null,
      assets: Object.entries(state.economy.holdings).map(([id, holding]) => [id, holding.level, holding.status] as const),
      inventory: Object.entries(state.economy.warehouse).sort(([left], [right]) => left.localeCompare(right)),
    } : business ? {
      funds: business.资金 ?? null,
      assets: (business.资产列表 ?? []).map(asset => [asset.id, asset.等级, asset.状态] as const),
      inventory: Object.entries(business.库存 ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    } : null,
    dice: { count: state.dice?.history?.length ?? 0, lastTotal: state.dice?.lastRoll?.total ?? state.dice?.history?.at(-1)?.total ?? null },
    npcs,
    tasks: {
      active: Object.keys(tasks?.活跃任务 ?? {}).sort(),
      done: Object.keys(tasks?.已完成任务 ?? {}).sort(),
      failed: Object.keys(tasks?.已失败任务 ?? {}).sort(),
    },
    chronicle: Object.keys(player.纪事系统?.纪事 ?? {}).sort(),
    tick: state.simulationRuntime?.tick ?? 0,
  };
}

export type CompatSummary = ReturnType<typeof summarizeCompatState>;
