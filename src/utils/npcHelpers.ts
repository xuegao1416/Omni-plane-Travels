// NPC 管理工具
import type { GameState, NPCData } from '../schema/variables';
import { cloneDeep } from 'lodash-es';

// ─── 常量 ───────────────────────────────────────────

export const NPC_CATEGORY_DEFAULT = '在场' as const;
export const NPC_CATEGORY_VALUES = new Set(['在场', '离场', '重点'] as const);

const NPC_CREATION_HINT_KEYS = new Set([
  '姓名', 'name', '性别', 'gender', '年龄', 'age', '种族', 'race',
  '职业', 'job', '等级', 'level', '好感度', 'favor', '关系类型', 'relationshipType',
  '外貌', 'appearance', '穿着', 'clothing', '性格', 'personality',
  '表性格', 'surfacePersonality', '里性格', 'hiddenPersonality',
  '社会身份', 'socialIdentity', '所属势力', 'faction', '社会地位', 'socialStatus',
  '当前位置', 'currentLocation', '当前状态', 'status',
  '特殊能力', 'specialAbility', '背景', 'background',
]);

// ─── NPC 死亡检测 ─────────────────────────────────────

const NPC_DEATH_KEYWORDS = ['死亡', '已死', 'dead', '尸体', '已阵亡', '已故', '遇害', '被杀', '身亡', '阵亡', '去世', '牺牲'];

/**
 * 判断 NPC 是否已死亡
 * 检查血量 <= 0 或当前状态包含死亡关键词
 */
export function isNpcDead(npc: Record<string, unknown> | NPCData | undefined | null): boolean {
  if (!npc || typeof npc !== 'object') return false;
  const n = npc as any;
  // 血量检查
  const hp = n.生存状态?.血量;
  if (typeof hp === 'number' && hp <= 0) return true;
  // 当前状态文本检查
  const status = String(n.个人信息?.当前状态 ?? '').trim();
  if (status && NPC_DEATH_KEYWORDS.some(kw => status.includes(kw))) return true;
  return false;
}

// ─── NPC 分类管理 ─────────────────────────────────────

export function normalizeNpcCategoryValue(value: unknown): '在场' | '离场' | '重点' {
  const raw = String(value ?? '').trim();
  if (NPC_CATEGORY_VALUES.has(raw as any)) return raw as any;
  return NPC_CATEGORY_DEFAULT;
}

export function getNpcCategoryValue(npc: Record<string, unknown> | NPCData | undefined | null): string {
  if (!npc || typeof npc !== 'object') return NPC_CATEGORY_DEFAULT;
  return normalizeNpcCategoryValue(
    (npc as any).人物分类 ??
    (npc as any).在场状态 ??
    (npc as any).登场状态 ??
    (npc as any).category ??
    (npc as any).presenceState
  );
}

export function ensureNpcCategoryDefaults(state: GameState): void {
  const npcs = state.人物档案;
  if (!npcs || typeof npcs !== 'object') return;
  for (const npc of Object.values(npcs)) {
    if (!npc || typeof npc !== 'object') continue;
    const next = getNpcCategoryValue(npc);
    if ((npc as any).人物分类 !== next) {
      (npc as any).人物分类 = next;
    }
  }
}

// ─── NPC 标识解析 ─────────────────────────────────────

export function normalizeNpcIdentifierText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/（已离场）$/, '')
    .trim();
}

export function getNpcDisplayName(npc: Record<string, unknown> | NPCData | undefined | null, fallbackId = ''): string {
  return normalizeNpcIdentifierText((npc as any)?.姓名 ?? (npc as any)?.name ?? fallbackId);
}

export interface NpcResolution {
  ok: boolean;
  npcId?: string;
  matchedBy?: 'id' | 'name';
  reason?: 'empty' | 'not_found' | 'ambiguous';
  rawIdentifier: string;
  normalizedIdentifier: string;
  matchedIds: string[];
}

export function resolveNpcId(npcIdentifier: unknown, state: GameState): NpcResolution {
  const rawIdentifier = String(npcIdentifier ?? '').trim();
  const normalizedIdentifier = normalizeNpcIdentifierText(rawIdentifier);
  const npcMap = state.人物档案 ?? {};

  if (!normalizedIdentifier) {
    return { ok: false, reason: 'empty', rawIdentifier, normalizedIdentifier, matchedIds: [] };
  }

  // 1. 精确 ID 匹配
  if (Object.prototype.hasOwnProperty.call(npcMap, rawIdentifier)) {
    return { ok: true, npcId: rawIdentifier, matchedBy: 'id', rawIdentifier, normalizedIdentifier, matchedIds: [rawIdentifier] };
  }

  // 2. 标准化 ID 匹配
  if (normalizedIdentifier !== rawIdentifier && Object.prototype.hasOwnProperty.call(npcMap, normalizedIdentifier)) {
    return { ok: true, npcId: normalizedIdentifier, matchedBy: 'id', rawIdentifier, normalizedIdentifier, matchedIds: [normalizedIdentifier] };
  }

  // 3. 按姓名匹配
  const matchedIds = Object.entries(npcMap)
    .filter(([id, npc]) => getNpcDisplayName(npc, id) === normalizedIdentifier)
    .map(([id]) => id);

  if (matchedIds.length === 1) {
    return { ok: true, npcId: matchedIds[0], matchedBy: 'name', rawIdentifier, normalizedIdentifier, matchedIds };
  }

  return {
    ok: false,
    reason: matchedIds.length > 1 ? 'ambiguous' : 'not_found',
    rawIdentifier, normalizedIdentifier, matchedIds,
  };
}

export function warnIgnoredNpcPatchUpdate(sourceLabel: string, npcIdentifier: unknown, resolution: NpcResolution): void {
  const identifierLabel = normalizeNpcIdentifierText(npcIdentifier) || String(npcIdentifier ?? '').trim() || '空标识';
  if (resolution.reason === 'ambiguous') {
    console.warn(`[VariableSystem] 已忽略${sourceLabel}中的 NPC 更新：标识"${identifierLabel}"命中多个现有 NPC。`, resolution.matchedIds);
    return;
  }
  console.warn(`[VariableSystem] 已忽略${sourceLabel}中的 NPC 更新：标识"${identifierLabel}"未唯一命中现有 NPC。`);
}

// ─── NPC 事迹管理 ─────────────────────────────────────

export function normalizeNpcChronicles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/\r?\n|[|｜]/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function isSameChronicleList(left: unknown, right: unknown): boolean {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
}

export function ensureNpcChronicleDefaults(state: GameState): void {
  const npcs = state.人物档案;
  if (!npcs || typeof npcs !== 'object') return;
  for (const npc of Object.values(npcs)) {
    if (!npc || typeof npc !== 'object') continue;
    const normalized = normalizeNpcChronicles(
      (npc as any).人物事迹 ?? (npc as any).characterDeeds ?? (npc as any).deeds ?? (npc as any).经历列表
    );
    if (!isSameChronicleList((npc as any).人物事迹, normalized)) {
      (npc as any).人物事迹 = normalized;
    }
  }
}

// ─── NPC 结构默认值 ───────────────────────────────────

export function ensureNpcStructureDefaults(state: GameState): void {
  const npcs = state.人物档案;
  if (!npcs || typeof npcs !== 'object') return;

  for (const npc of Object.values(npcs)) {
    if (!npc || typeof npc !== 'object') continue;
    const n = npc as any;

    // 基础字段默认值 — 缺失时填有意义的值而非空字符串
    if (n.年龄 === undefined) n.年龄 = '';
    if (n.背景 === undefined) n.背景 = '未知';
    if (n.性格 === undefined) n.性格 = '未知';
    if (n.穿着 === undefined) n.穿着 = '未知';
    if (n.外貌 === undefined && n.个人信息) n.外貌 = n.个人信息.外貌 ?? '未知';
    if (n.当前行动 === undefined) n.当前行动 = '未知';
    if (n.短期目标 === undefined) n.短期目标 = '未知';
    if (n.长期目标 === undefined) n.长期目标 = '未知';
    if (n.内心想法 === undefined) n.内心想法 = '暂无';
    if (n.种族描述 === undefined) n.种族描述 = '';
    if (n.种族效果 === undefined) n.种族效果 = '';
    if (n.种族特性 === undefined) n.种族特性 = [];
    if (n.天赋 === undefined) n.天赋 = [];
    if (n.技能列表 === undefined) n.技能列表 = [];
    if (n.物品列表 === undefined) n.物品列表 = [];
    if (n.装备列表 === undefined) n.装备列表 = {};

    // 嵌套对象默认值（AI 创建 NPC 时可能缺失）
    if (!n.生存状态 || typeof n.生存状态 !== 'object') {
      n.生存状态 = { 血量: 100, 体力值: 100 };
    }
    if (!n.社会身份 || typeof n.社会身份 !== 'object') {
      n.社会身份 = { 职业: '未知', 社会地位: '普通' };
    } else {
      if (n.社会身份.职业 === undefined || n.社会身份.职业 === '') n.社会身份.职业 = '未知';
      if (n.社会身份.社会地位 === undefined || n.社会身份.社会地位 === '') n.社会身份.社会地位 = '普通';
    }
    if (!n.关系数据 || typeof n.关系数据 !== 'object') {
      n.关系数据 = { 好感度: 0, 关系类型: '陌生人' };
    } else {
      if (typeof n.关系数据.好感度 !== 'number') n.关系数据.好感度 = 0;
    }
    if (!n.个人信息 || typeof n.个人信息 !== 'object') {
      n.个人信息 = {
        外貌: '未知', 表性格: '未知', 里性格: '未知',
        当前想法: '暂无', 当前穿着: '未知', 当前位置: '未知', 当前状态: '未知',
        备注: '',
      };
    } else {
      if (n.个人信息.外貌 === '') n.个人信息.外貌 = '未知';
      if (n.个人信息.表性格 === '') n.个人信息.表性格 = '未知';
      if (n.个人信息.里性格 === '') n.个人信息.里性格 = '未知';
      if (n.个人信息.当前想法 === '') n.个人信息.当前想法 = '暂无';
      if (n.个人信息.当前状态 === '') n.个人信息.当前状态 = '未知';
      if (n.个人信息.当前穿着 === '') n.个人信息.当前穿着 = '未知';
      if (n.个人信息.当前位置 === '') n.个人信息.当前位置 = '未知';
    }
    if (n.重要NPC === undefined) n.重要NPC = false;
  }
}

// ─── NPC 创建检测 ─────────────────────────────────────

export function countNpcCreationHintFields(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  let count = 0;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (NPC_CREATION_HINT_KEYS.has(key)) count++;
  }
  return count;
}

export function isNpcCreationPayload(value: unknown): boolean {
  return countNpcCreationHintFields(value) >= 2;
}

export function canCreateNpcFromPatch(pathParts: string[], op: string, value: unknown): boolean {
  return (
    Array.isArray(pathParts) &&
    pathParts[0] === '人物档案' &&
    pathParts.length === 2 &&
    ['add', 'replace'].includes(String(op ?? '').toLowerCase()) &&
    isNpcCreationPayload(value)
  );
}

export function getCreatableNpcIdentifier(identifier: unknown): string {
  return normalizeNpcIdentifierText(identifier) || String(identifier ?? '').trim();
}

// ─── 安全快照 ─────────────────────────────────────────

export function createPromptSafeNpcSnapshot(npc: NPCData | Record<string, unknown> | null | undefined, npcId = ''): Record<string, unknown> {
  if (!npc || typeof npc !== 'object') {
    return {
      姓名: normalizeNpcIdentifierText(npcId) || '未知NPC',
      人物分类: '离场',
      人物事迹: [],
    };
  }

  const category = getNpcCategoryValue(npc);
  const rawName = getNpcDisplayName(npc, npcId) || '未知NPC';
  const chronicles = normalizeNpcChronicles(
    (npc as any).人物事迹 ?? (npc as any).characterDeeds ?? (npc as any).deeds ?? (npc as any).经历列表
  );

  // 离场 NPC 精简快照：只保留姓名、分类、最近3条事迹、位置
  if (category === '离场') {
    return {
      姓名: rawName,
      人物分类: '离场',
      人物事迹: chronicles.slice(-3),
      个人信息: { 当前位置: (npc as any).个人信息?.当前位置 ?? '未知' },
    };
  }

  // 在场/重点 NPC 完整快照
  const snapshot = cloneDeep(npc) as any;
  snapshot.姓名 = rawName;
  if (snapshot.name !== undefined) snapshot.name = rawName;
  snapshot.人物分类 = category;
  snapshot.人物事迹 = chronicles;
  return snapshot;
}

// ─── 主 AI 紧凑快照 ─────────────────────────────────

/** 截断文本到指定长度 */
function truncate(text: unknown, maxLen: number): string {
  const s = String(text ?? '').trim();
  if (!s || s === '未知' || s === '无' || s === '暂无') return '';
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

/** 格式化单个 NPC 为紧凑文本 */
function formatNpcCompact(npc: Record<string, unknown>, npcId: string): string {
  const n = npc as any;
  const name = String(n.姓名 ?? npcId).trim() || npcId;
  const category = String(n.人物分类 ?? '在场').trim();
  const gender = String(n.性别 ?? '').trim();
  const race = String(n.种族 ?? '').trim();
  const age = n.年龄 ?? '';
  const sj = n.社会身份 ?? {};
  const job = String(sj.职业 ?? '').trim() || '未知';
  const rd = n.关系数据 ?? {};
  const favor = rd.好感度 ?? '';
  const relationType = String(rd.关系类型 ?? '').trim();
  const pi = n.个人信息 ?? {};
  const ext = n;

  // 头部行
  const headerParts = [`[NPC] ${name}`];
  if (gender) headerParts.push(gender);
  if (race) headerParts.push(race);
  if (age !== '' && age !== undefined) headerParts.push(`${age}岁`);
  headerParts.push(`职业:${job}`);
  if (category !== '在场') headerParts.push(`[${category}]`);

  const lines = [headerParts.join(' | ')];

  // 关系
  const relationParts = [];
  if (favor !== '' && favor !== undefined) relationParts.push(`好感度:${favor}`);
  if (relationType) relationParts.push(`关系:${relationType}`);
  if (relationParts.length > 0) lines.push(`> 关系: ${relationParts.join(', ')}`);

  // 外貌与性格
  const appearance = truncate(pi.外貌 ?? ext.外貌, 40);
  const personality = truncate(pi.表性格 ?? ext.性格, 20);
  const hiddenPersonality = truncate(pi.里性格, 20);
  const clothing = truncate(pi.当前穿着 ?? ext.穿着, 24);
  if (appearance || personality || clothing) {
    const parts = [];
    if (appearance) parts.push(`外貌:${appearance}`);
    if (personality) parts.push(`性格:${personality}`);
    if (hiddenPersonality) parts.push(`里性格:${hiddenPersonality}`);
    if (clothing) parts.push(`穿着:${clothing}`);
    lines.push(`> 描写: ${parts.join(' | ')}`);
  }

  // 当前状态
  const location = truncate(pi.当前位置 ?? ext.当前位置, 20);
  const status = truncate(pi.当前状态, 20);
  const action = truncate(ext.当前行动, 30);
  const thoughts = truncate(pi.当前想法 ?? ext.内心想法, 50);
  const stateParts = [];
  if (location) stateParts.push(`位置:${location}`);
  if (status) stateParts.push(`状态:${status}`);
  if (action) stateParts.push(`行动:${action}`);
  if (stateParts.length > 0) lines.push(`> 当前: ${stateParts.join(', ')}`);
  if (thoughts) lines.push(`> 想法: ${thoughts}`);

  // 目标
  const shortGoal = truncate(ext.短期目标, 30);
  const longGoal = truncate(ext.长期目标, 30);
  if (shortGoal || longGoal) {
    const parts = [];
    if (shortGoal) parts.push(`短期:${shortGoal}`);
    if (longGoal) parts.push(`长期:${longGoal}`);
    lines.push(`> 目标: ${parts.join(' | ')}`);
  }

  // 事迹（最近5条）
  const chronicles = normalizeNpcChronicles(n.人物事迹 ?? n.characterDeeds ?? n.deeds ?? n.经历列表);
  if (chronicles.length > 0) {
    const recent = chronicles.slice(-5);
    const chronicleText = recent.map((c, i) => `${i + 1}.${truncate(c, 36)}`).join(' | ');
    lines.push(`> 事迹: ${chronicleText}`);
  }

  // 种族描述
  const raceDesc = truncate(ext.种族描述, 40);
  const raceEffect = truncate(ext.种族效果, 30);
  if (raceDesc || raceEffect) {
    const parts = [];
    if (raceDesc) parts.push(`描述:${raceDesc}`);
    if (raceEffect) parts.push(`效果:${raceEffect}`);
    lines.push(`> 种族: ${parts.join(' | ')}`);
  }
  const raceTraits = Array.isArray(ext.种族特性) ? ext.种族特性 : [];
  if (raceTraits.length > 0) {
    lines.push(`> 种族特性: ${raceTraits.slice(0, 3).join('、')}`);
  }

  // 天赋
  const talents = Array.isArray(ext.天赋) ? ext.天赋 : [];
  if (talents.length > 0) {
    lines.push(`> 天赋: ${talents.slice(0, 3).join('、')}`);
  }

  // 技能列表
  const skillList = ext.技能列表;
  if (skillList) {
    if (Array.isArray(skillList) && skillList.length > 0) {
      lines.push(`> 技能: ${skillList.slice(0, 5).join('、')}`);
    } else if (typeof skillList === 'object') {
      const entries = Object.entries(skillList).slice(0, 5).map(([k, v]: [string, any]) => {
        return v?.描述 ? `${k}(${truncate(v.描述, 20)})` : k;
      });
      if (entries.length > 0) lines.push(`> 技能: ${entries.join('、')}`);
    }
  }

  // 物品/装备
  const items = ext.物品列表;
  if (items) {
    if (Array.isArray(items) && items.length > 0) {
      lines.push(`> 物品: ${items.slice(0, 5).join('、')}`);
    } else if (typeof items === 'object') {
      const entries = Object.entries(items).slice(0, 5).map(([k, v]: [string, any]) => {
        return v?.数量 && v.数量 > 1 ? `${k}×${v.数量}` : k;
      });
      if (entries.length > 0) lines.push(`> 物品: ${entries.join('、')}`);
    }
  }

  // 生存状态（简要）
  const survivalStats = ext.生存状态;
  if (survivalStats && typeof survivalStats === 'object') {
    const entries = Object.entries(survivalStats).slice(0, 6).map(([k, v]) => `${k}:${v}`);
    if (entries.length > 0) lines.push(`> 属性: ${entries.join(' | ')}`);
  }

  return lines.join('\n');
}

/** 格式化离场 NPC 为精简文本 */
function formatDepartedNpcCompact(npc: Record<string, unknown>, npcId: string): string {
  const n = npc as any;
  const name = String(n.姓名 ?? npcId).trim() || npcId;
  const chronicles = normalizeNpcChronicles(n.人物事迹 ?? n.characterDeeds ?? n.deeds ?? n.经历列表);
  const recent = chronicles.slice(-3);

  let line = `> ${name}`;
  if (recent.length > 0) {
    line += ` — 最近: ${recent.map(c => truncate(c, 28)).join('; ')}`;
  }
  return line;
}

/**
 * 将 GameState 格式化为主 AI 可读的紧凑文本快照
 * 只提取叙事需要的字段，避免浪费 token
 */
export function formatSnapshotForMainAI(state: GameState): string {
  const lines: string[] = [];

  // 世界状态
  const world = state.世界 ?? ({} as any);
  const time = world.时间系统?.当前时间 ?? '';
  const weather = world.时间系统?.当前天气 ?? '';
  const location = world.空间定位?.当前位置 ?? '';
  if (time || location || weather) {
    lines.push(`### 【世界状态】`);
    const parts = [];
    if (time) parts.push(`时间:${time}`);
    if (location) parts.push(`地点:${location}`);
    if (weather) parts.push(`天气:${weather}`);
    lines.push(`> ${parts.join(' | ')}`);
  }

  // 状态轴（世界背景：社会环境、势力动态、区域事件等）
  const stateAxes = (world as any).状态轴;
  if (stateAxes && typeof stateAxes === 'object') {
    for (const [axisName, axisData] of Object.entries(stateAxes)) {
      if (!axisData || typeof axisData !== 'object') continue;
      const entries = Object.entries(axisData as Record<string, string>)
        .filter(([, v]) => v && typeof v === 'string' && v.trim());
      if (entries.length > 0) {
        lines.push(`### 【${axisName}】`);
        for (const [k, v] of entries) {
          lines.push(`> ${k}: ${v}`);
        }
      }
    }
  }

  // 玩家状态
  const player = state.玩家 ?? ({} as any);
  const playerName = player.姓名 ?? (player as any).name ?? '';
  const playerLocation = player.当前位置 ?? '';
  const playerGoal = player.当前目标 ?? '';
  if (playerName || playerLocation || playerGoal) {
    lines.push(`### 【玩家】`);
    if (playerName) lines.push(`> 姓名: ${playerName}`);
    if (playerLocation) lines.push(`> 位置: ${playerLocation}`);
    if (playerGoal) lines.push(`> 目标: ${playerGoal}`);
  }

  // 生存状态（血量/体力值 + 六维 dim1-6 + 特色属性）— 不注入正文生成，避免变量泄露
  // 注：生存状态由变量提取系统管理，正文生成不应感知具体数值

  // 技能系统
  const skills = player.技能系统;
  if (skills && typeof skills === 'object' && Object.keys(skills).length > 0) {
    lines.push(`### 【技能系统】`);
    for (const [name, data] of Object.entries(skills)) {
      if (!data || typeof data !== 'object') continue;
      const d = data as any;
      const quality = d.品质 || '';
      const desc = d.描述 || '';
      const type = d.类型 || '';
      const parts = [`【${name}】`];
      if (quality) parts.push(`品质:${quality}`);
      if (type) parts.push(`类型:${type}`);
      if (desc) parts.push(`效果:${desc}`);
      lines.push(`> ${parts.join(' | ')}`);
    }
  }

  // 物品栏 — Record<string, InventoryItem>（对象格式，不是数组）
  const inventory = player.物品栏;
  if (inventory && typeof inventory === 'object' && !Array.isArray(inventory)) {
    const invEntries = Object.entries(inventory as Record<string, { 数量?: number; 类型?: string; 品质?: string; 备注?: string }>);
    if (invEntries.length > 0) {
      lines.push(`### 【物品栏】`);
      for (const [name, it] of invEntries) {
        if (!it || typeof it !== 'object') continue;
        const qty = it.数量 ?? 1;
        const quality = it.品质 ?? '';
        const type = it.类型 ?? '';
        const note = it.备注 ?? '';
        const extra = [quality, type, note].filter(Boolean).join('·');
        const suffix = extra ? `（${extra}）` : '';
        lines.push(`> ${name}${qty > 1 ? ` ×${qty}` : ''}${suffix}`);
      }
    }
  }

  // 成长体系（段位/经验/属性点，启用成长模块时填充）
  const growthParts: string[] = [];
  if (player.当前段位索引 != null) growthParts.push(`段位:Lv.${player.当前段位索引}`);
  if (player.当前经验值 != null) growthParts.push(`经验:${player.当前经验值}`);
  if (player.可用属性点 != null) growthParts.push(`自由属性点:${player.可用属性点}`);
  if (growthParts.length > 0) {
    lines.push(`### 【成长体系】`);
    lines.push(`> ${growthParts.join(' | ')}`);
  }

  // 生存资源（食物/水/材料等，启用生存模块时填充）
  const resources = player.生存资源;
  if (resources && typeof resources === 'object' && !Array.isArray(resources)) {
    const resEntries = Object.entries(resources as Record<string, { 数量?: number; 最大值?: number }>);
    if (resEntries.length > 0) {
      lines.push(`### 【生存资源】`);
      const parts = resEntries.map(([k, v]) => {
        if (!v || typeof v !== 'object') return `${k}:${v}`;
        const maxStr = (v as any).最大值 != null ? `/${(v as any).最大值}` : '';
        return `${k}:${(v as any).数量 ?? '?'}${maxStr}`;
      });
      lines.push(`> ${parts.join(' | ')}`);
    }
  }

  // 货币资源
  const currency = player.货币资源;
  if (currency && typeof currency === 'object') {
    const entries = Object.entries(currency).filter(([, v]) => v != null);
    if (entries.length > 0) {
      lines.push(`### 【货币资源】`);
      lines.push(`> ${entries.map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' | ')}`);
    }
  }

  // 记事本
  const notebook = player.记事本;
  if (notebook && typeof notebook === 'object') {
    const crises = Object.entries(notebook.潜在危机 ?? {}).filter(([, v]) => v && typeof v === 'object');
    const opportunities = Object.entries(notebook.当前机遇 ?? {}).filter(([, v]) => v && typeof v === 'object');
    const todos = Object.entries(notebook.待办事项 ?? {}).filter(([, v]) => v && typeof v === 'object');
    if (crises.length > 0 || opportunities.length > 0 || todos.length > 0) {
      lines.push(`### 【记事本】`);
      if (crises.length > 0) {
        for (const [name, data] of crises.slice(0, 3)) {
          const d = data as any;
          const severity = d.严重程度 ?? '';
          const measure = d.应对措施 ?? '';
          lines.push(`> [危机] ${name}${severity ? `(${severity})` : ''}${measure ? `：${measure}` : ''}`);
        }
      }
      if (opportunities.length > 0) {
        for (const [name, data] of opportunities.slice(0, 3)) {
          const d = data as any;
          const plan = d.行动计划 ?? '';
          lines.push(`> [机遇] ${name}${plan ? `：${plan}` : ''}`);
        }
      }
      if (todos.length > 0) {
        for (const [name, data] of todos.slice(0, 3)) {
          const d = data as any;
          const priority = d.优先级 ?? '';
          const status = d.状态 ?? '';
          lines.push(`> [待办] ${name}${priority ? `(${priority})` : ''}${status ? `(${status})` : ''}`);
        }
      }
    }
  }

  // 人物档案
  const npcs = state.人物档案 ?? {};
  const npcEntries = Object.entries(npcs);
  if (npcEntries.length > 0) {
    const presentNpcs: [string, Record<string, unknown>][] = [];
    const departedNpcs: [string, Record<string, unknown>][] = [];

    for (const [id, npc] of npcEntries) {
      if (!npc || typeof npc !== 'object') continue;
      const category = getNpcCategoryValue(npc);
      if (category === '离场') {
        departedNpcs.push([id, npc as unknown as Record<string, unknown>]);
      } else {
        presentNpcs.push([id, npc as unknown as Record<string, unknown>]);
      }
    }

    if (presentNpcs.length > 0) {
      lines.push(`### 【在场人物】`);
      for (const [id, npc] of presentNpcs) {
        lines.push(formatNpcCompact(npc, id));
      }
    }

    if (departedNpcs.length > 0) {
      lines.push(`### 【离场人物】`);
      lines.push('> 以下人物已不在当前场景中，如需重新引入，先将人物分类设为"在场"');
      for (const [id, npc] of departedNpcs) {
        lines.push(formatDepartedNpcCompact(npc, id));
      }
    }
  }

  return lines.join('\n');
}

