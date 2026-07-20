/**
 * 人物模板存储层
 * - 主角预设 (PlayerPreset): localStorage key 'world_travel_guide_player_presets'
 * - NPC模板  (NpcTemplate): localStorage key 'world_travel_guide_npc_templates'
 * - 人生经历预设 (HistoryPreset): localStorage key 'world_travel_guide_history_presets'
 */
import { v4 as uuid } from 'uuid';
import type { PlayerProfile, CustomNpc } from './db';
import type { SkillData, InventoryItem } from '../schema/variables';
import { STORAGE_KEYS } from '@/config/storageKeys';
export { downloadJSON } from '../utils/download';

// ─── 类型定义 ─────────────────────────────────────────

export interface PlayerPreset {
  id: string;
  name: string;
  createdAt: number;
  gender: string;
  age: string;
  background: string;
  personality: string;
  appearance: string;
  career: string;
  socialClass: string;
  organization: string;
  specialIdentity: string;
  perspective: string;
  initialSkills: Record<string, SkillData>;
  initialItems: Record<string, InventoryItem>;
}

export interface NpcTemplate {
  id: string;
  name: string;        // 模板显示名称
  createdAt: number;
  npc: CustomNpc;
}

export interface HistoryPreset {
  id: string;
  name: string;
  createdAt: number;
  segments: Record<string, string>;  // { prologue, stage_0, stage_1, ... }
  includeAgeStages: boolean;
}

// ─── localStorage keys ────────────────────────────────

const PLAYER_KEY = STORAGE_KEYS.PLAYER_PRESETS;
const NPC_KEY = STORAGE_KEYS.NPC_TEMPLATES;
const HISTORY_KEY = STORAGE_KEYS.HISTORY_PRESETS;

// ─── 内部工具 ─────────────────────────────────────────

function readJSON<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeJSON<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

// ─── 主角预设 CRUD ───────────────────────────────────

export function getPlayerPresets(): PlayerPreset[] {
  return readJSON<PlayerPreset>(PLAYER_KEY);
}

export function savePlayerPreset(name: string, profile: PlayerProfile): PlayerPreset {
  const presets = getPlayerPresets();
  const preset: PlayerPreset = {
    id: uuid(),
    name,
    createdAt: Date.now(),
    gender: profile.gender,
    age: profile.age,
    background: profile.background,
    personality: profile.personality,
    appearance: profile.appearance,
    career: profile.career,
    socialClass: profile.socialClass,
    organization: profile.organization,
    specialIdentity: profile.specialIdentity,
    perspective: profile.perspective,
    initialSkills: profile.initialSkills,
    initialItems: Object.fromEntries(
      Object.entries(profile.initialItems).map(([k, v]) => [k, { ...v }])
    ),
  };
  presets.push(preset);
  writeJSON(PLAYER_KEY, presets);
  return preset;
}

export function deletePlayerPreset(id: string) {
  const presets = getPlayerPresets().filter(p => p.id !== id);
  writeJSON(PLAYER_KEY, presets);
}

/** 将预设覆盖到 PlayerProfile（保留 customNpcs 不变） */
export function applyPresetToProfile(preset: PlayerPreset, current: PlayerProfile): PlayerProfile {
  return {
    ...current,
    name: preset.name,    // 名字也从预设导入
    gender: preset.gender,
    age: preset.age,
    background: preset.background,
    personality: preset.personality,
    appearance: preset.appearance,
    career: preset.career,
    socialClass: preset.socialClass,
    organization: preset.organization,
    specialIdentity: preset.specialIdentity,
    perspective: preset.perspective as PlayerProfile['perspective'],
    initialSkills: preset.initialSkills,
    initialItems: preset.initialItems,
  };
}

// ─── NPC模板 CRUD ────────────────────────────────────

export function getNpcTemplates(): NpcTemplate[] {
  return readJSON<NpcTemplate>(NPC_KEY);
}

export function saveNpcTemplate(name: string, npc: CustomNpc): NpcTemplate {
  const templates = getNpcTemplates();
  const tpl: NpcTemplate = {
    id: uuid(),
    name,
    createdAt: Date.now(),
    npc: { ...npc },  // 浅拷贝足够，导入时会重新生成 id
  };
  templates.push(tpl);
  writeJSON(NPC_KEY, templates);
  return tpl;
}

export function deleteNpcTemplate(id: string) {
  const templates = getNpcTemplates().filter(t => t.id !== id);
  writeJSON(NPC_KEY, templates);
}

/** 从模板导入NPC（重新生成 id） */
export function importNpcFromTemplate(template: NpcTemplate): CustomNpc {
  return { ...template.npc, id: uuid() };
}

// ─── 人生经历预设 CRUD ───────────────────────────────

export function getHistoryPresets(): HistoryPreset[] {
  return readJSON<HistoryPreset>(HISTORY_KEY);
}

export function saveHistoryPreset(name: string, segments: Record<string, string>, includeAgeStages: boolean): HistoryPreset {
  const presets = getHistoryPresets();
  const preset: HistoryPreset = {
    id: uuid(),
    name,
    createdAt: Date.now(),
    segments: { ...segments },
    includeAgeStages,
  };
  presets.push(preset);
  writeJSON(HISTORY_KEY, presets);
  return preset;
}

export function deleteHistoryPreset(id: string) {
  const presets = getHistoryPresets().filter(p => p.id !== id);
  writeJSON(HISTORY_KEY, presets);
}

// ─── 导出 JSON（带 envelope）──────────────────────────

interface ExportEnvelope<T> {
  type: string;
  version: string;
  exportedAt: number;
  data: T;
}

export function exportPlayerPresetJSON(preset: PlayerPreset): string {
  const envelope: ExportEnvelope<PlayerPreset> = {
    type: 'omni-plane-travels-player-preset',
    version: '1.0',
    exportedAt: Date.now(),
    data: preset,
  };
  return JSON.stringify(envelope, null, 2);
}

export function exportNpcTemplateJSON(template: NpcTemplate): string {
  const envelope: ExportEnvelope<NpcTemplate> = {
    type: 'omni-plane-travels-npc-template',
    version: '1.0',
    exportedAt: Date.now(),
    data: template,
  };
  return JSON.stringify(envelope, null, 2);
}

export function exportHistoryPresetJSON(preset: HistoryPreset): string {
  const envelope: ExportEnvelope<HistoryPreset> = {
    type: 'omni-plane-travels-history-preset',
    version: '1.0',
    exportedAt: Date.now(),
    data: preset,
  };
  return JSON.stringify(envelope, null, 2);
}

// ─── JSON 严格校验 + 解析 ─────────────────────────────

type ValidateResult<T> = { ok: true; data: T } | { ok: false; error: string };

function isStr(v: unknown): v is string { return typeof v === 'string'; }
function isObj(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }

/** 校验 SkillData 结构 */
function isValidSkillData(v: unknown): v is SkillData {
  if (!isObj(v)) return false;
  const validQualities = ['普通', '精良', '稀有', '史诗', '传说'];
  return isStr(v.描述) && isStr(v.类型) && isStr(v.品质) && validQualities.includes(v.品质);
}

/** 校验 InventoryItem 结构 */
function isValidInventoryItem(v: unknown): v is InventoryItem {
  if (!isObj(v)) return false;
  const validQualities = ['普通', '精良', '稀有', '史诗', '传说'];
  return typeof v.数量 === 'number' && isStr(v.类型) && isStr(v.品质) && validQualities.includes(v.品质) && isStr(v.备注);
}

/** 校验 CustomNpc 结构（宽松：只要有 name/姓名 即可，其余字段可选） */
function isValidNpcShape(v: unknown): v is CustomNpc {
  if (!isObj(v)) return false;
  const npcName = isStr(v.name) ? v.name : (isStr((v as any).姓名) ? (v as any).姓名 : '');
  if (!npcName.trim()) return false;
  // 可选字段如果存在必须是正确类型
  const strFields = ['gender', 'age', 'race', 'relationshipType', 'occupation', 'socialStatus',
    'personality', 'hiddenPersonality', 'currentThought', 'appearance', 'currentOutfit',
    'currentAction', 'currentLocation', 'currentState', 'shortTermGoal', 'longTermGoal', 'background'];
  for (const f of strFields) {
    if (f in v && v[f] !== undefined && !isStr(v[f])) return false;
  }
  if ('chronicles' in v && v.chronicles !== undefined && !Array.isArray(v.chronicles)) return false;
  if ('skillsList' in v && v.skillsList !== undefined && !isObj(v.skillsList)) return false;
  if ('itemsList' in v && v.itemsList !== undefined && !isObj(v.itemsList)) return false;
  return true;
}

/** 解析并校验主角预设 JSON */
export function parsePlayerPresetJSON(jsonStr: string): ValidateResult<PlayerPreset> {
  let raw: any;
  try { raw = JSON.parse(jsonStr); } catch { return { ok: false, error: 'JSON 解析失败，请检查文件格式' }; }

  // 兼容信封格式（导出时带 type/data 外壳）和裸格式
  const data = raw.data ?? raw;

  if (!isStr(data.name) || !data.name.trim()) return { ok: false, error: '缺少有效的 name 字段' };
  if (!isStr(data.gender)) return { ok: false, error: 'gender 字段必须是字符串' };
  if (!isStr(data.age)) return { ok: false, error: 'age 字段必须是字符串' };
  if (!isStr(data.perspective)) return { ok: false, error: 'perspective 字段必须是字符串' };

  // 校验 initialSkills
  if (data.initialSkills != null) {
    if (!isObj(data.initialSkills)) return { ok: false, error: 'initialSkills 必须是对象' };
    for (const [k, v] of Object.entries(data.initialSkills)) {
      if (!isValidSkillData(v)) return { ok: false, error: `技能 "${k}" 数据格式无效` };
    }
  }

  // 校验 initialItems
  if (data.initialItems != null) {
    if (!isObj(data.initialItems)) return { ok: false, error: 'initialItems 必须是对象' };
    for (const [k, v] of Object.entries(data.initialItems)) {
      if (!isValidInventoryItem(v)) return { ok: false, error: `物品 "${k}" 数据格式无效` };
    }
  }

  const preset: PlayerPreset = {
    id: uuid(),   // 导入时重新生成
    name: String(data.name).trim(),
    createdAt: Date.now(),
    gender: isStr(data.gender) ? data.gender : '',
    age: isStr(data.age) ? data.age : '',
    background: isStr(data.background) ? data.background : '',
    personality: isStr(data.personality) ? data.personality : '',
    appearance: isStr(data.appearance) ? data.appearance : '',
    career: isStr(data.career) ? data.career : '',
    socialClass: isStr(data.socialClass) ? data.socialClass : '',
    organization: isStr(data.organization) ? data.organization : '',
    specialIdentity: isStr(data.specialIdentity) ? data.specialIdentity : '',
    perspective: isStr(data.perspective) ? data.perspective : '第三人称',
    initialSkills: isObj(data.initialSkills) ? data.initialSkills as Record<string, SkillData> : {},
    initialItems: isObj(data.initialItems) ? data.initialItems as Record<string, InventoryItem> : {},
  };

  return { ok: true, data: preset };
}

/** 解析并校验 NPC模板 JSON */
export function parseNpcTemplateJSON(jsonStr: string): ValidateResult<NpcTemplate> {
  let raw: any;
  try { raw = JSON.parse(jsonStr); } catch { return { ok: false, error: 'JSON 解析失败，请检查文件格式' }; }

  // 兼容信封格式（导出时带 type/data 外壳）和裸格式
  const data = raw.data ?? raw;
  const npc = data.npc ?? data;

  // 兼容 name 和 姓名 两种字段名（存档人物档案用 姓名，模板用 name）
  if (isObj(npc) && !isStr(npc.name) && isStr((npc as any).姓名)) {
    npc.name = (npc as any).姓名;
  }

  if (!isValidNpcShape(npc)) {
    const fallbackName = isObj(npc) ? ((npc as any).name || (npc as any).姓名) : null;
    if (!isStr(fallbackName) || !fallbackName.trim()) return { ok: false, error: '缺少有效的 NPC name 字段' };
    return { ok: false, error: 'NPC 数据格式无效，请检查字段类型' };
  }

  const npcNameStr = (npc as any).name as string;
  const tplName = isStr(data.name) ? data.name : (npcNameStr || '导入的NPC');

  const tpl: NpcTemplate = {
    id: uuid(),
    name: tplName,
    createdAt: Date.now(),
    npc: {
      id: uuid(),
      name: npcNameStr,
      gender: isStr(npc.gender) ? npc.gender : '',
      age: isStr(npc.age) ? npc.age : '',
      race: isStr(npc.race) ? npc.race : '',
      relationshipType: isStr(npc.relationshipType) ? npc.relationshipType : '',
      occupation: isStr(npc.occupation) ? npc.occupation : '',
      socialStatus: isStr(npc.socialStatus) ? npc.socialStatus : '',
      personality: isStr(npc.personality) ? npc.personality : '',
      hiddenPersonality: isStr(npc.hiddenPersonality) ? npc.hiddenPersonality : '',
      currentThought: isStr(npc.currentThought) ? npc.currentThought : '',
      appearance: isStr(npc.appearance) ? npc.appearance : '',
      currentOutfit: isStr(npc.currentOutfit) ? npc.currentOutfit : '',
      currentAction: isStr(npc.currentAction) ? npc.currentAction : '',
      currentLocation: isStr(npc.currentLocation) ? npc.currentLocation : '',
      currentState: isStr(npc.currentState) ? npc.currentState : '',
      shortTermGoal: isStr(npc.shortTermGoal) ? npc.shortTermGoal : '',
      longTermGoal: isStr(npc.longTermGoal) ? npc.longTermGoal : '',
      background: isStr(npc.background) ? npc.background : '',
      chronicles: Array.isArray(npc.chronicles) ? npc.chronicles.filter((c: any) => isStr(c)) : [],
      skillsList: isObj(npc.skillsList) ? npc.skillsList as CustomNpc['skillsList'] : {},
      itemsList: isObj(npc.itemsList) ? npc.itemsList as CustomNpc['itemsList'] : {},
    },
  };

  return { ok: true, data: tpl };
}

/** 解析并校验人生经历预设 JSON */
export function parseHistoryPresetJSON(jsonStr: string): ValidateResult<HistoryPreset> {
  let raw: any;
  try { raw = JSON.parse(jsonStr); } catch { return { ok: false, error: 'JSON 解析失败，请检查文件格式' }; }

  // 兼容信封格式（导出时带 type/data 外壳）和裸格式
  const data = raw.data ?? raw;

  if (!isStr(data.name) || !data.name.trim()) return { ok: false, error: '缺少有效的 name 字段' };
  if (!isObj(data.segments)) return { ok: false, error: 'segments 字段必须是对象' };

  // 校验 segments 的每个值都是字符串
  for (const [k, v] of Object.entries(data.segments)) {
    if (!isStr(v)) return { ok: false, error: `segments["${k}"] 必须是字符串` };
  }

  const preset: HistoryPreset = {
    id: uuid(),
    name: String(data.name).trim(),
    createdAt: Date.now(),
    segments: data.segments as Record<string, string>,
    includeAgeStages: data.includeAgeStages !== false,
  };

  return { ok: true, data: preset };
}
