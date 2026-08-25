import type { WorldArtwork, WorldDef, WorldBookEntryDef } from '../../../data/worlds-schema';
import {
  createDefaultStatModule, createDefaultProgressionModule, createDefaultSurvivalModule,
  createDefaultBusinessModule, createDefaultDiceModule, createDefaultTalentModule,
  createDefaultProfessionBinding, createDefaultCombatBinding,
} from '../../../modules/defaults';
import { createBuildContext } from '../../../modules/buildContext';
import { generateWorldBookEntries } from '../../../modules/buildPipeline';
import type { WorldClockConfig } from '../../../time/worldClock';
import { inferWorldClockConfig } from '../../../time/worldClock';
import { resolveProfessionBinding } from '../../../data/professions';

export type FormState = {
  name: string; description: string; icon: string; coverColor: string; tags: string; difficulty: string;
  artwork?: WorldArtwork;
  overview: string; timePeriod: string; location: string; atmosphere: string;
  powerSystem: string; socialStructure: string; specialRules: string;
  currencyName: string; currencySymbol: string; currencyDesc: string; priceLevel: string;
  calendar: string; startTime: string; timeSpeed: string; timeSystem?: Partial<WorldClockConfig>;
  factions: Array<{ name: string; description: string; alignment: string }>;
  presetNPCs: Array<{ name: string; role: string; description: string; personality: string }>;
  highlights: string;
  locations: Array<{ name: string; description: string }>;
  culture: string;
  modules: WorldDef['modules'];
};

export const defaultForm: FormState = {
  name: '', description: '', icon: '', coverColor: '#3b82f6', tags: '', difficulty: 'medium',
  artwork: undefined,
  overview: '', timePeriod: '', location: '', atmosphere: '',
  powerSystem: '', socialStructure: '', specialRules: '',
  currencyName: '', currencySymbol: '', currencyDesc: '', priceLevel: '',
  calendar: '', startTime: '', timeSpeed: '', timeSystem: undefined,
  factions: [], presetNPCs: [], highlights: '',
  locations: [], culture: '', modules: undefined,
};

export const DEFAULT_MODULE_FACTORIES: Record<string, () => unknown> = {
  stat: createDefaultStatModule, progression: createDefaultProgressionModule,
  survival: createDefaultSurvivalModule, business: createDefaultBusinessModule,
  dice: createDefaultDiceModule, talent: createDefaultTalentModule,
  profession: createDefaultProfessionBinding,
  combat: createDefaultCombatBinding,
};

export const MODULE_NAME_MAP: Record<string, string> = {
  stat: '数值属性', progression: '成长体系', survival: '生存资源', business: '经营资产', dice: '骰子检定', talent: '天赋体系', profession: '职业体系', combat: '战斗系统',
};

/**
 * 六个内置玩法模块都落在统一事务内核上，可以按世界需求组合。
 * 保留空表是为了兼容编辑器原有的依赖计算入口。
 */
export const MUTEX: Record<string, string[]> = {};

function findMeta(entries: WorldBookEntryDef[] | undefined, type: string) {
  return entries?.find(e => e.entryType === type)?.meta;
}

export function worldToForm(w: WorldDef): FormState {
  const entries = w.worldBookEntries;
  const settingMeta = findMeta(entries, 'setting');
  const rulesMeta = findMeta(entries, 'rules');
  const economyMeta = findMeta(entries, 'economy');
  const allFactions = (entries?.filter(e => e.entryType === 'factions') ?? []).flatMap(e => (e.meta as any)?.factions ?? []);
  const allNPCs = (entries?.filter(e => e.entryType === 'npcs') ?? []).flatMap(e => (e.meta as any)?.npcs ?? []);
  const highlightsMeta = findMeta(entries, 'highlights');
  const loreEntries = entries?.filter(e => e.entryType === 'lore') ?? [];
  const cultureEntry = entries?.find(e => e.entryType === 'culture');

  return {
    name: w.name || '', description: w.description || '', icon: w.icon || '', coverColor: w.coverColor || '#3b82f6',
    artwork: w.artwork,
    tags: w.tags?.join(', ') || '', difficulty: w.difficulty || 'medium',
    overview: entries?.find(e => e.entryType === 'setting')?.content || '',
    timePeriod: settingMeta?.timePeriod || '', location: settingMeta?.location || '', atmosphere: settingMeta?.atmosphere || '',
    powerSystem: rulesMeta?.powerSystem || '', socialStructure: rulesMeta?.socialStructure || '',
    specialRules: rulesMeta?.specialRules?.join('\n') || '',
    currencyName: economyMeta?.currency?.name || '', currencySymbol: economyMeta?.currency?.symbol || '',
    currencyDesc: economyMeta?.currency?.description || '', priceLevel: economyMeta?.priceLevel || '',
    calendar: economyMeta?.calendar || '', startTime: economyMeta?.startTime || '', timeSpeed: economyMeta?.timeSpeed || '', timeSystem: economyMeta?.timeSystem,
    factions: allFactions.map((f: any) => ({ name: f.name || '', description: f.description || '', alignment: f.alignment || '中立' })),
    presetNPCs: allNPCs.map((n: any) => ({ name: n.name || '', role: n.role || '', description: n.description || '', personality: typeof n.personality === 'string' ? n.personality : '' })),
    highlights: highlightsMeta?.highlights?.join(', ') || '',
    locations: loreEntries.map(e => ({ name: e.comment || '', description: e.content || '' })),
    culture: cultureEntry?.content || '', modules: w.modules,
  };
}

/** 将表单转换为 WorldDef */
export function formToWorldDef(form: FormState, initialWorld: WorldDef | null, refinedEntries: WorldBookEntryDef[]): WorldDef {
  if (refinedEntries.length > 0) {
    const economy = refinedEntries.find(entry => entry.entryType === 'economy');
    const economyMeta = economy?.meta || {};
    const inheritedTimeSystem = economyMeta.timeSystem;
    const fallbackTimeSystem = inferWorldClockConfig({
      calendar: form.calendar || economyMeta.calendar,
      startTime: form.startTime || economyMeta.startTime,
      timeSpeed: form.timeSpeed || economyMeta.timeSpeed,
      timePeriod: form.timePeriod,
      timeSystem: form.timeSystem
        ? { ...inheritedTimeSystem, ...form.timeSystem }
        : inheritedTimeSystem,
    });
    const fallbackEconomy: WorldBookEntryDef = {
      uid: refinedEntries.reduce((max, entry) => Math.max(max, entry.uid), 0) + 1,
      key: ['经济', '时间'], constant: false, comment: '经济 & 时间', content: '', order: 5,
      position: 'before_char', entryType: 'economy', meta: {
        currency: form.currencyName ? { name: form.currencyName, symbol: form.currencySymbol || undefined, description: form.currencyDesc || undefined } : undefined,
        priceLevel: form.priceLevel || undefined,
        calendar: form.calendar || undefined,
        startTime: form.startTime || undefined,
        timeSpeed: form.timeSpeed || undefined,
        timeSystem: fallbackTimeSystem,
      },
    };
    const normalizedEntries: WorldBookEntryDef[] = economy
      ? refinedEntries.map(entry => entry === economy ? {
        ...entry,
        meta: {
          ...economyMeta,
          calendar: form.calendar || economyMeta.calendar,
          startTime: form.startTime || economyMeta.startTime,
          timeSpeed: form.timeSpeed || economyMeta.timeSpeed,
          timeSystem: fallbackTimeSystem,
        },
      } : entry)
      : [...refinedEntries, fallbackEconomy];
    return {
      id: initialWorld?.id || `custom_${Date.now()}`,
      name: form.name.trim(), description: form.description.trim(), entryId: null,
      icon: form.icon || undefined, coverColor: form.coverColor || undefined,
      artwork: form.artwork ?? initialWorld?.artwork,
      tags: form.tags ? form.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean) : undefined,
      difficulty: (form.difficulty as any) || undefined, worldBookEntries: normalizedEntries, modules: form.modules,
      author: initialWorld?.author, createdAt: initialWorld?.createdAt || new Date().toISOString(),
    };
  }

  const entries: WorldBookEntryDef[] = [];
  let uid = 1;

  if (form.overview) {
    entries.push({ uid: uid++, key: [], constant: true, comment: '世界设定', content: form.overview, order: 1, position: 'before_char', entryType: 'setting', meta: { location: form.location || undefined, timePeriod: form.timePeriod || undefined, atmosphere: form.atmosphere || undefined } });
  }
  if (form.powerSystem || form.socialStructure || form.specialRules) {
    const rulesContent = [form.powerSystem ? `力量体系：${form.powerSystem}` : '', form.socialStructure ? `社会结构：${form.socialStructure}` : '', form.specialRules ? `特殊规则：${form.specialRules}` : ''].filter(Boolean).join('\n');
    entries.push({ uid: uid++, key: [], constant: true, comment: '世界规则', content: rulesContent, order: 2, position: 'before_char', entryType: 'rules', meta: { powerSystem: form.powerSystem || undefined, socialStructure: form.socialStructure || undefined, specialRules: form.specialRules ? form.specialRules.split('\n').map(s => s.trim()).filter(Boolean) : undefined } });
  }
  for (const f of form.factions.filter(f => f.name.trim())) {
    entries.push({ uid: uid++, key: [f.name.trim()], constant: false, comment: f.name.trim(), content: `${f.alignment ? `[${f.alignment}] ` : ''}${f.description.trim()}`, order: 3, position: 'before_char', entryType: 'factions', meta: { factions: [{ name: f.name.trim(), description: f.description.trim(), alignment: f.alignment || undefined }] } });
  }
  for (const n of form.presetNPCs.filter(n => n.name.trim())) {
    const personalitySuffix = (n.personality || '').trim() ? `（性格：${(n.personality || '').trim()}）` : '';
    entries.push({ uid: uid++, key: [n.name.trim()], constant: false, comment: n.name.trim(), content: `${n.role.trim()} — ${n.description.trim()}${personalitySuffix}`, order: 4, position: 'before_char', entryType: 'npcs', meta: { npcs: [{ name: n.name.trim(), role: n.role.trim(), description: n.description.trim(), personality: (n.personality || '').trim() || undefined }] } });
  }
  {
    const economyContent = [form.currencyName ? `货币：${form.currencySymbol || ''}${form.currencyName}${form.currencyDesc ? `（${form.currencyDesc}）` : ''}` : '', form.priceLevel ? `物价水平：${form.priceLevel}` : '', form.calendar ? `纪年：${form.calendar}` : '', form.startTime ? `开始时间：${form.startTime}` : '', form.timeSpeed ? `时间流速：${form.timeSpeed}` : ''].filter(Boolean).join('\n');
    entries.push({ uid: uid++, key: ['花钱', '消费', '买单', '价格', '买东西', '付钱', '货币', '工资', '收入'], constant: false, comment: '经济 & 时间', content: economyContent, order: 5, position: 'before_char', entryType: 'economy', meta: { currency: form.currencyName ? { name: form.currencyName, symbol: form.currencySymbol || undefined, description: form.currencyDesc || undefined } : undefined, priceLevel: form.priceLevel || undefined, calendar: form.calendar || undefined, startTime: form.startTime || undefined, timeSpeed: form.timeSpeed || undefined, timeSystem: inferWorldClockConfig({ timeSystem: form.timeSystem, calendar: form.calendar, startTime: form.startTime, timeSpeed: form.timeSpeed, timePeriod: form.timePeriod }) } });
  }
  const highlightList = form.highlights ? form.highlights.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
  if (highlightList.length > 0) { entries.push({ uid: uid++, key: [], constant: true, comment: '核心特色', content: highlightList.join('、'), order: 6, position: 'before_char', entryType: 'highlights', meta: { highlights: highlightList } }); }
  for (const loc of form.locations.filter(l => l.name.trim())) { entries.push({ uid: uid++, key: [loc.name.trim()], constant: false, comment: loc.name.trim(), content: loc.description.trim(), order: 7, position: 'before_char', entryType: 'lore' }); }
  if (form.culture.trim()) { entries.push({ uid: uid++, key: ['文化', '风俗', '传统'], constant: false, comment: '文化风俗', content: form.culture.trim(), order: 8, position: 'before_char', entryType: 'culture' }); }

  const existingEntries = initialWorld?.worldBookEntries?.filter(e => e.entryType && e.entryType !== 'module_rule' && e.entryType !== 'setting' && e.entryType !== 'factions' && e.entryType !== 'npcs' && e.entryType !== 'lore' && e.entryType !== 'culture' && e.entryType !== 'economy' && e.entryType !== 'rules' && e.entryType !== 'highlights') ?? [];

  return {
    id: initialWorld?.id || `custom_${Date.now()}`, name: form.name.trim(), description: form.description.trim(), entryId: null,
    icon: form.icon || undefined, coverColor: form.coverColor || undefined,
    artwork: form.artwork ?? initialWorld?.artwork,
    tags: form.tags ? form.tags.split(/[,，]/).map(s => s.trim()).filter(Boolean) : undefined,
    difficulty: (form.difficulty as any) || undefined, worldBookEntries: [...entries, ...existingEntries], modules: form.modules,
    author: initialWorld?.author, createdAt: initialWorld?.createdAt || new Date().toISOString(),
  };
}

/** 为 world 生成 module_rule 世界书条目 */
export function injectModuleRuleEntries(world: WorldDef, form: FormState, refinedEntries: WorldBookEntryDef[]) {
  if (refinedEntries.length > 0 || !world.modules?.some(m => m.enabled)) return;
  try {
    const enabledModules = world.modules.filter(m => m.enabled).map(m => m.moduleId);
    const worldDesc = form.overview || form.name;
    const buildCtx = createBuildContext(worldDesc, enabledModules);
    for (const mod of world.modules.filter(m => m.enabled)) {
      const mc = (mod.moduleConfig || mod.data) as any;
      if (!mc) continue;
      if (mod.moduleId === 'stat') buildCtx.statData = mc;
      if (mod.moduleId === 'progression') buildCtx.progressionData = mc;
      if (mod.moduleId === 'survival') buildCtx.survivalData = mc;
      if (mod.moduleId === 'business') buildCtx.businessData = mc;
      if (mod.moduleId === 'talent') buildCtx.talentData = mc;
      if (mod.moduleId === 'profession') buildCtx.professionData = resolveProfessionBinding(mc);
    }
    buildCtx.worldBookEntries = generateWorldBookEntries(buildCtx);
    if (buildCtx.worldBookEntries?.length) {
      const kept = (world.worldBookEntries ?? []).filter(e => e.entryType !== 'module_rule');
      const minUid = kept.reduce((min, e) => (e.uid != null && e.uid < min ? e.uid : min), -1);
      const moduleEntries = buildCtx.worldBookEntries.map((e, i) => ({ ...e, uid: minUid - 1 - i, entryType: 'module_rule' as const }));
      world.worldBookEntries = [...kept, ...moduleEntries];
    }
  } catch (err) { console.warn('[injectModuleRuleEntries] 生成模块世界书条目失败:', err); }
}
