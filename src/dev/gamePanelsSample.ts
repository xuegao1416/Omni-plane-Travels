import { createDefaultGameState, type GameState } from '../schema/variables';

/** Localhost-only sample state for `?plshot=game&panel=…` visual QA. */
export function createSampleGameState(): GameState {
  const state = createDefaultGameState();
  state.世界 = { 时间系统: { 当前时间: '第三日 · 酉时', 当前天气: '微雨' }, 空间定位: { 当前位置: '临安城 · 北城门' } };
  Object.assign(state.玩家, {
    姓名: '林夕', 年龄: '19', 性别: '女', 当前目标: '查明东市更夫失踪的真相',
    身份信息: { 职业: '游方剑客', 背景信息: '出身江南小镖局，镖局败落后独自北上。' },
    性格: '外冷内热，认死理', 外貌: '青衣束发，背一柄旧剑',
    生存状态: { 血量: 82, 体力值: 54 },
    货币资源: { 主货币: { 名称: '铜钱', 数量: 1260 } },
    技能系统: {
      流云剑: { 名称: '流云剑', 品质: '稀有', 描述: '师门剑法，快而不乱。', 类型: '武学' },
      听风: { 名称: '听风', 品质: '精良', 描述: '夜里辨声识位。', 类型: '感知' },
    },
    物品栏: {
      旧剑: { 数量: 1, 类型: '武器', 品质: '精良', 备注: '剑脊有一道旧裂痕' },
      金疮药: { 数量: 3, 类型: '消耗品', 品质: '普通', 备注: '止血' },
      镖局令牌: { 数量: 1, 类型: '信物', 品质: '稀有', 备注: '刻着「顺远」二字' },
    },
    纪事系统: { 纪事: {
      c1: { 标题: '东市更夫失踪', 类型: '线索', 描述: '三天里丢了两个更夫，尸首都没捞着。', 状态: '活跃', $time: 1 },
      c2: { 标题: '别碰河', 类型: '风险', 描述: '守卫提醒走北边巷子，不要靠近河道。', 状态: '活跃', $time: 2 },
    } },
    任务系统: { 活跃任务: {
      t1: { 任务名: '夜探东市', 任务类型: '主线', 描述: '在天黑后前往东市，找到更夫最后出现的地方。', 状态: '进行中', 优先级: '高', 目标: '抵达东市更楼', 进度: 30, 来源: '北城门守卫', $time: 1 },
    }, 已完成任务: {}, 已失败任务: {} },
  } as Partial<GameState['玩家']>);
  const src = { turnId: 't1', eventId: 'e1', quote: '守卫的灯笼被风吹得一晃一晃' };
  const field = (value: unknown) => ({ value, source: src, turnNumber: 1 });
  state.playerKnowledge = { schemaVersion: 1, processedReceiptIds: [], characters: {
    guard: { fields: { 姓名: field('赵守仁'), 性别: field('男'), 年龄: field(42), '社会身份.职业': field('城门守卫'), '关系数据.好感度': field(18), '关系数据.关系类型': field('点头之交'), '个人信息.外貌': field('满脸倦意，灯笼不离手'), '个人信息.当前位置': field('北城门') } },
    widow: { fields: { 姓名: field('柳三娘'), 性别: field('女'), 年龄: field(35), '社会身份.职业': field('茶肆掌柜'), '关系数据.好感度': field(-6), '关系数据.关系类型': field('陌生'), '个人信息.当前位置': field('东市') } },
  } } as GameState['playerKnowledge'];
  return state;
}
