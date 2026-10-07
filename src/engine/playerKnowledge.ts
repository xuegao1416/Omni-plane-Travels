import type { GameState, NPCData } from '../schema/variables';

export type KnownNPC = { [K in keyof NPCData]?: NPCData[K] extends object ? Partial<NPCData[K]> : NPCData[K] };
export interface ObservationSource {
  turnId: string;
  eventId: string;
  quote: string;
}
export interface KnownField {
  value: unknown;
  source: ObservationSource;
  turnNumber: number;
}
export interface PlayerKnowledgeState {
  schemaVersion: 1;
  characters: Record<string, { fields: Record<string, KnownField> }>;
  processedReceiptIds: string[];
}
export interface PlayerObservation {
  npcId: string;
  path: string;
  value: unknown;
  quote: string;
  /** Secret/exact state requires explicit disclosure; simple contact is insufficient. */
  mode: 'observed' | 'disclosed';
  introduces?: boolean;
}
/** Only the committed narrative/variable pipeline may construct an accepted receipt. */
export interface PlayerObservationReceipt {
  id: string;
  turnId: string;
  eventId: string;
  turnNumber: number;
  committed: boolean;
  text: string;
  observations: PlayerObservation[];
}

const observable = new Set([
  '姓名', '种族', '性别', '个人信息.外貌', '个人信息.表性格', '个人信息.当前穿着',
  '个人信息.当前位置', '个人信息.当前状态', '穿着', '当前行动', '人物分类', '战斗状态',
  '关系数据.关系类型',
]);
/** 好感度是玩家亲身经历的关系刻度，直接由正文观察即可确认，不必再等正式披露。 */
const observableNumbers = new Set(['关系数据.好感度']);
const disclosedStrings = new Set([
  ...observable, '背景', '社会身份.职业', '社会身份.社会地位',
  '个人信息.里性格', '个人信息.当前想法', '个人信息.备注', '种族描述', '种族效果',
  '性格', '短期目标', '长期目标', '内心想法',
]);
const disclosedArrays = new Set(['人物事迹', '种族特性', '天赋']);
const safeKey = (key: string) => !!key && !['__proto__', 'prototype', 'constructor'].includes(key);
const validSource = (source: ObservationSource) => [source.turnId, source.eventId, source.quote].every(value => typeof value === 'string' && !!value.trim());
const emptyKnowledge = (): PlayerKnowledgeState => ({ schemaVersion: 1, characters: {}, processedReceiptIds: [] });

function flatten(value: Record<string, unknown>, prefix = '', target: Record<string, unknown> = {}) {
  for (const [key, item] of Object.entries(value)) {
    if (!safeKey(key) || key.includes('.')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flatten(item as Record<string, unknown>, path, target);
    else if (item !== undefined) target[path] = structuredClone(item);
  }
  return target;
}

/** Explicit previous-save migration, or initial known cast capture before any offscreen work. */
export function initializePlayerKnowledge(state: GameState, source: ObservationSource): GameState {
  const legacy = (state as GameState & { 人物已知资料?: { version: number; characters: Record<string, { observed?: Record<string, unknown>; fields?: Record<string, { turnId?: string }> }> } }).人物已知资料;
  if (state.playerKnowledge && !legacy) return state;
  if (!validSource(source)) throw new Error('Player knowledge initialization requires provenance');
  const knowledge = state.playerKnowledge ?? emptyKnowledge();
  const baseline = legacy ? Object.fromEntries(Object.entries(legacy.characters ?? {}).map(([id, record]) => [id, record.observed ?? {}])) : state.人物档案;
  for (const [id, npc] of Object.entries(state.playerKnowledge ? {} : baseline)) {
    if (!safeKey(id)) continue;
    const fields: Record<string, KnownField> = {};
    for (const [path, value] of Object.entries(flatten(npc as unknown as Record<string, unknown>))) {
      fields[path] = { value, source: { ...source, turnId: legacy?.characters[id]?.fields?.[path]?.turnId || source.turnId }, turnNumber: -1 };
    }
    knowledge.characters[id] = { fields };
  }
  const migrated = { ...state, playerKnowledge: knowledge };
  delete (migrated as GameState & { 人物已知资料?: unknown }).人物已知资料;
  return migrated;
}

/** No truth fallback and no truth-based sorting. Returned data is detached for reader/UI use. */
export function selectPlayerKnownNPCs(state: GameState): Record<string, KnownNPC> {
  const result: Record<string, KnownNPC> = {};
  for (const [id, character] of Object.entries(state.playerKnowledge?.characters ?? {})) {
    if (!safeKey(id)) continue;
    const npc: Record<string, unknown> = {};
    for (const [path, field] of Object.entries(character.fields)) {
      const parts = path.split('.');
      if (!parts.every(safeKey)) continue;
      let parent = npc;
      for (const part of parts.slice(0, -1)) {
        if (!parent[part] || typeof parent[part] !== 'object' || Array.isArray(parent[part])) parent[part] = {};
        parent = parent[part] as Record<string, unknown>;
      }
      parent[parts[parts.length - 1]!] = structuredClone(field.value);
    }
    result[id] = npc as KnownNPC;
  }
  return result;
}

function validField(observation: PlayerObservation): boolean {
  const { path, value, mode } = observation;
  if (!path.split('.').every(safeKey)) return false;
  if (mode === 'observed') {
    if (observableNumbers.has(path)) return typeof value === 'number' && Number.isFinite(value);
    return observable.has(path) && typeof value === 'string';
  }
  if (mode !== 'disclosed') return false;
  if (disclosedStrings.has(path)) return typeof value === 'string';
  if (path === '年龄') return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
  if (path === '关系数据.好感度' || /^生存状态\.[^.]+$/.test(path) || /^成长状态\.(当前段位索引|当前经验值|可用属性点)$/.test(path)) return typeof value === 'number' && Number.isFinite(value);
  return disclosedArrays.has(path) && Array.isArray(value) && value.every(item => typeof item === 'string');
}

/** Apply only pipeline-confirmed observations; never infer discovery or synchronize whole NPCs. */
export function applyPlayerObservations(state: GameState, receipt: PlayerObservationReceipt): {
  state: GameState;
  applied: number;
  rejected: Array<{ index: number; reason: string }>;
} {
  const invalidReceipt = !receipt.committed || !receipt.id?.trim() || !receipt.turnId?.trim() || !receipt.eventId?.trim()
    || !Number.isSafeInteger(receipt.turnNumber) || receipt.turnNumber < 0 || typeof receipt.text !== 'string';
  if (invalidReceipt) return { state, applied: 0, rejected: [{ index: -1, reason: 'Uncommitted or invalid receipt' }] };
  if (state.playerKnowledge?.processedReceiptIds.includes(receipt.id)) return { state, applied: 0, rejected: [] };
  const knowledge = structuredClone(state.playerKnowledge ?? emptyKnowledge());
  const rejected: Array<{ index: number; reason: string }> = [];
  let applied = 0;
  receipt.observations.forEach((observation, index) => {
    const reject = (reason: string) => rejected.push({ index, reason });
    if (!safeKey(observation.npcId) || !Object.hasOwn(state.人物档案, observation.npcId)) return reject('Unknown canonical character');
    // 人物分类只描述"是否在玩家眼前的场景里"，属于玩家自身视角而非幕后秘密，
    // 允许在没有引文的情况下同步；其余字段仍然必须有本轮正文引文。
    const presenceOnly = observation.path === '人物分类';
    if (!presenceOnly
      && (typeof observation.quote !== 'string' || !observation.quote.trim() || !receipt.text.includes(observation.quote))) {
      return reject('Missing source quotation');
    }
    if (!validField(observation)) return reject('Field or disclosure mode not allowed');
    let character = knowledge.characters[observation.npcId];
    if (!character) {
      if (!observation.introduces || observation.path !== '姓名' || !String(observation.value).trim()) return reject('Character has not been introduced');
      character = knowledge.characters[observation.npcId] = { fields: {} };
    }
    const previous = character.fields[observation.path];
    if (previous && previous.turnNumber > receipt.turnNumber) return reject('Stale observation');
    character.fields[observation.path] = {
      value: structuredClone(observation.value),
      turnNumber: receipt.turnNumber,
      source: { turnId: receipt.turnId, eventId: receipt.eventId, quote: observation.quote },
    };
    applied++;
  });
  knowledge.processedReceiptIds.push(receipt.id);
  return { state: { ...state, playerKnowledge: knowledge }, applied, rejected };
}

/**
 * 玩家在开局亲手创建的角色（同伴等）属于玩家已知：直接按全量资料登记，
 * 不经过正文披露门槛。资料是玩家自己填写的，不存在"幕后真相泄露"。
 */
export function admitAuthoredNPCs(state: GameState, npcIds: readonly string[], source: ObservationSource): GameState {
  if (!state.playerKnowledge) return initializePlayerKnowledge(state, source);
  if (!validSource(source)) throw new Error('Player knowledge admission requires provenance');
  const knowledge = structuredClone(state.playerKnowledge);
  let admitted = false;
  for (const id of npcIds) {
    const npc = state.人物档案?.[id];
    if (!safeKey(id) || !npc || typeof npc !== 'object') continue;
    const fields: Record<string, KnownField> = { ...(knowledge.characters[id]?.fields ?? {}) };
    for (const [path, value] of Object.entries(flatten(npc as unknown as Record<string, unknown>))) {
      fields[path] = { value, source: { ...source }, turnNumber: -1 };
    }
    knowledge.characters[id] = { fields };
    admitted = true;
  }
  return admitted ? { ...state, playerKnowledge: knowledge } : state;
}

/**
 * 本轮正文里出现的在场角色，其"看得见"的字段直接投影给玩家。
 * 只覆盖 observable / observableNumbers 里的公开字段；当前想法、里性格、目标、背景等
 * 秘密字段一律不投影，仍需正式披露证据。用于兜底：观测字段缺失时人物面板不会永久停在旧值。
 * 已认识的角色离场时只同步"人物分类"，其余字段留在幕后，避免把离场者的隐藏状态暴露给玩家。
 */
const sceneFields = [
  '姓名', '种族', '性别', '人物分类', '个人信息.外貌', '个人信息.表性格',
  '个人信息.当前穿着', '个人信息.当前位置', '个人信息.当前状态', '当前行动', '关系数据.关系类型',
];

export function collectSceneObservations(state: GameState, text: string): PlayerObservation[] {
  if (!text) return [];
  const observations: PlayerObservation[] = [];
  for (const [id, npc] of Object.entries(state.人物档案 ?? {})) {
    if (!safeKey(id) || !npc || typeof npc !== 'object') continue;
    const flat = flatten(npc as unknown as Record<string, unknown>);
    const name = typeof flat['姓名'] === 'string' ? flat['姓名'].trim() : '';
    const quote = text.includes(id) ? id : (name && text.includes(name) ? name : '');
    const category = typeof flat['人物分类'] === 'string' ? flat['人物分类'].trim() : '';
    // 已认识的角色是否"在眼前"是玩家自身视角，不是幕后秘密。只同步这一项，
    // 避免面板永久停在旧的"在场"，让玩家以为已经离开的人还待在身边。
    if (category && category !== '在场') {
      const known = !!state.playerKnowledge?.characters[id];
      if (known && category.includes('离场')) {
        observations.push({ npcId: id, path: '人物分类', value: '离场', quote, mode: 'observed' });
      }
      continue;
    }
    // 人物分类缺失或异常时不投影，保持保守行为。
    if (category !== '在场') continue;
    // Mentioning an absent character does not reveal their current hidden state.
    // Offscreen facts require explicit, field-level disclosure evidence.
    if (!quote) continue;
    const introduction = !state.playerKnowledge?.characters[id];
    if (introduction && !name) continue;
    if (introduction) observations.push({ npcId: id, path: '姓名', value: name, quote, mode: 'observed', introduces: true });
    for (const path of sceneFields) {
      if (introduction && path === '姓名') continue;
      const value = flat[path];
      if (typeof value !== 'string' || !value.trim()) continue;
      observations.push({ npcId: id, path, value, quote, mode: 'observed' });
    }
    const favor = flat['关系数据.好感度'];
    if (typeof favor === 'number' && Number.isFinite(favor)) {
      observations.push({ npcId: id, path: '关系数据.好感度', value: favor, quote, mode: 'observed' });
    }
  }
  return observations;
}
