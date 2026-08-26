import { useState, useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { WorldDef, WorldBookEntryDef } from '../../data/worlds-schema';
import { createPresetArtwork, getDefaultArtworkPreset, processWorldArtworkFile, resolveWorldArtwork, WORLD_ARTWORK_PRESETS } from '../../data/worldArtwork';
import { requestStreamWithRetry } from '../../api/client';
import ModuleSelector, { expandModuleDependencies, getDefaultSelectedModules } from './ModuleSelector';
import { useConfigStore } from '../../stores/configStore';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import type { ProfessionModuleSchema, ProfessionPack, ProfessionWorldBinding, TalentModuleSchema } from '../../modules/schema';
import { buildStatGenPrompt, buildProgressionGenPrompt, buildSurvivalGenPrompt, buildBusinessGenPrompt } from '../../modules/prompts';
import { normalizeProgressionConfig } from '../../modules/xpAlgorithm';
import { clampPointScale } from '../../gameplay/creation/creationPoints';
import { buildProfessionPackGenerationPrompt, extractLegacyProfessionPack, isProfessionBinding, parseGeneratedProfessionPack } from '../../data/professions';
import ProfessionLibraryWorkspace from '../profession/ProfessionLibraryWorkspace';
import GuidedChoiceOverlay from './GuidedChoiceOverlay';
import { ManualEditForm, type ManualEditSection } from './worldEditorForm/ManualEditForm';
import {
  type FormState, defaultForm, worldToForm, formToWorldDef, injectModuleRuleEntries,
  DEFAULT_MODULE_FACTORIES, MODULE_NAME_MAP, MUTEX,
} from './worldEditorForm/types';
import { X, Cpu, Pencil, Sparkles, Loader, Download, Save, Check, ChevronLeft, ChevronRight, AlertTriangle, Map, ScrollText, Flag, User, BarChart3, Upload } from 'lucide-react';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';

const WEAVE_STEPS = ['世界种子', '世界法则', '世界编年', '降临预览'];
const clampWeaveStep = (value: number) => Math.min(4, Math.max(1, Math.round(value) || 1));
const editorFormForWorld = (world: WorldDef | null): FormState => {
  const base = world ? worldToForm(world) : defaultForm;
  return base.artwork ? base : { ...base, artwork: createPresetArtwork(getDefaultArtworkPreset(world)) };
};

interface WorldEditorFormProps {
  initialWorld: WorldDef | null;
  onSave: (world: WorldDef) => void;
  onCancel: () => void;
  apiConfig: any;
  settings: any;
  presentationMode?: 'world-weave' | 'legacy';
  initialStep?: number;
  previewMode?: 'create' | 'edit';
}

export default function WorldEditorForm({ initialWorld, onSave, onCancel, apiConfig, presentationMode = 'legacy', initialStep, previewMode }: WorldEditorFormProps) {
  const t = useConfigStore(s => s.t);
  const [form, setForm] = useState<FormState>(() => editorFormForWorld(initialWorld));
  const [worldIntentPrompt, setWorldIntentPrompt] = useState(() => initialWorld?.description || '');

  useEffect(() => {
    setForm(editorFormForWorld(initialWorld));
    setWorldIntentPrompt(initialWorld?.description || '');
  }, [initialWorld]);

  const [aiGenName, setAiGenName] = useState('');
  const [survivalGenDesc, setSurvivalGenDesc] = useState('');
  const [isGeneratingWorld, setIsGeneratingWorld] = useState(false);
  const [isGeneratingTalent, setIsGeneratingTalent] = useState(false);
  const [generatingModule, setGeneratingModule] = useState<string | null>(null);
  const [pipelineStage, setPipelineStage] = useState('');
  const [refinedEntries, setRefinedEntries] = useState<WorldBookEntryDef[]>([]);
  const [genError, setGenError] = useState('');
  const [artworkError, setArtworkError] = useState('');
  const [isProcessingArtwork, setIsProcessingArtwork] = useState(false);
  const [selectedModules, setSelectedModules] = useState<Set<string>>(() => {
    if (initialWorld?.modules) return expandModuleDependencies(initialWorld.modules.filter(m => m.enabled).map(m => m.moduleId));
    return getDefaultSelectedModules();
  });
  const aiAbortRef = useRef<AbortController | null>(null);
  const [showGuidedChoice, setShowGuidedChoice] = useState(false);
  const [professionLibraryOpen, setProfessionLibraryOpen] = useState(false);
  const [weaveStep, setWeaveStep] = useState(() => clampWeaveStep(initialStep ?? 1));
  const [weaveValidation, setWeaveValidation] = useState('');

  const isEditing = previewMode === 'create' ? false : (previewMode === 'edit' || !!initialWorld);
  const [editorMode, setEditorMode] = useState<'manual' | 'ai'>(isEditing ? 'manual' : 'ai');

  useEffect(() => {
    if (presentationMode === 'world-weave' && initialStep !== undefined) setWeaveStep(clampWeaveStep(initialStep));
  }, [initialStep, presentationMode]);

  // 互斥计算
  const disabledByConflict = new Set<string>();
  for (const id of selectedModules) { for (const conflict of (MUTEX[id] || [])) { if (!selectedModules.has(conflict)) disabledByConflict.add(conflict); } }

  const toggleModule = (moduleId: string) => {
    setSelectedModules(prev => {
      const next = new Set(prev); const adding = !next.has(moduleId);
      if (adding) {
        for (const id of expandModuleDependencies([moduleId])) next.add(id);
        for (const conflict of (MUTEX[moduleId] || [])) next.delete(conflict);
      } else next.delete(moduleId);
      return next;
    });
    setForm(f => {
      let modules = f.modules ? [...f.modules] : [];
      if (moduleId) {
        if (!selectedModules.has(moduleId)) {
          for (const conflict of (MUTEX[moduleId] || [])) modules = modules.filter(m => m.moduleId !== conflict);
          for (const id of expandModuleDependencies([moduleId])) {
            if (!modules.find(m => m.moduleId === id)) {
              const data = DEFAULT_MODULE_FACTORIES[id]?.();
              modules.push({ moduleId: id, name: MODULE_NAME_MAP[id] || id, description: '', enabled: true, ...(data ? { moduleConfig: data as Record<string, unknown> } : {}) });
            } else modules = modules.map(m => m.moduleId === id ? { ...m, enabled: true } : m);
          }
        } else modules = modules.filter(m => m.moduleId !== moduleId);
      }
      return { ...f, modules };
    });
  };

  const update = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }));
  const updateModuleData = (idx: number, data: Record<string, unknown>) => setForm(f => ({ ...f, modules: f.modules?.map((mod, i) => i === idx ? { ...mod, moduleConfig: data } : mod) }));
  const updateModuleDataByModuleId = (moduleId: string, data: Record<string, unknown>) => setForm(f => { const modules = f.modules ? [...f.modules] : []; const idx = modules.findIndex(m => m.moduleId === moduleId); if (idx >= 0) modules[idx] = { ...modules[idx], moduleConfig: data }; return { ...f, modules }; });

  const addFaction = () => setForm(f => ({ ...f, factions: [...f.factions, { name: '', description: '', alignment: '中立' }] }));
  const removeFaction = (i: number) => setForm(f => ({ ...f, factions: f.factions.filter((_, idx) => idx !== i) }));
  const updateFaction = (i: number, patch: Partial<FormState['factions'][0]>) => setForm(f => ({ ...f, factions: f.factions.map((item, idx) => idx === i ? { ...item, ...patch } : item) }));
  const addNPC = () => setForm(f => ({ ...f, presetNPCs: [...f.presetNPCs, { name: '', role: '', description: '', personality: '' }] }));
  const removeNPC = (i: number) => setForm(f => ({ ...f, presetNPCs: f.presetNPCs.filter((_, idx) => idx !== i) }));
  const updateNPC = (i: number, patch: Partial<FormState['presetNPCs'][0]>) => setForm(f => ({ ...f, presetNPCs: f.presetNPCs.map((item, idx) => idx === i ? { ...item, ...patch } : item) }));
  const addLocation = () => setForm(f => ({ ...f, locations: [...f.locations, { name: '', description: '' }] }));
  const removeLocation = (i: number) => setForm(f => ({ ...f, locations: f.locations.filter((_, idx) => idx !== i) }));
  const updateLocation = (i: number, patch: Partial<FormState['locations'][0]>) => setForm(f => ({ ...f, locations: f.locations.map((item, idx) => idx === i ? { ...item, ...patch } : item) }));

  const selectArtworkPreset = (presetId: string) => {
    setArtworkError('');
    update({ artwork: createPresetArtwork(presetId) });
  };

  const handleArtworkUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setArtworkError('');
    setIsProcessingArtwork(true);
    try { update({ artwork: await processWorldArtworkFile(file) }); }
    catch (err: unknown) { setArtworkError(err instanceof Error ? err.message : '图片处理失败，请更换图片'); }
    finally { setIsProcessingArtwork(false); }
  };

  const restoreArtwork = () => selectArtworkPreset(getDefaultArtworkPreset(initialWorld));

  const talentData = form.modules?.find(m => m.moduleId === 'talent')?.moduleConfig as TalentModuleSchema | undefined;

  const normalizeSelectedWorldModules = (modules: WorldDef['modules']): NonNullable<WorldDef['modules']> => {
    const generated = new globalThis.Map((modules ?? []).map(module => [module.moduleId, module] as const));
    const existing = new globalThis.Map((form.modules ?? []).map(module => [module.moduleId, module] as const));
    return [...selectedModules].map(moduleId => {
      const source = generated.get(moduleId) ?? existing.get(moduleId);
      let moduleConfig = source?.moduleConfig ?? source?.data ?? DEFAULT_MODULE_FACTORIES[moduleId]?.();
      // 世界 AI 的返回不能覆盖独立资产引用。职业与战斗只采用编辑器已有绑定或稳定默认值。
      if (moduleId === 'profession') {
        const existingConfig = existing.get(moduleId)?.moduleConfig ?? existing.get(moduleId)?.data;
        if (isProfessionBinding(existingConfig)) moduleConfig = existingConfig;
        else if (existingConfig && Array.isArray((existingConfig as unknown as ProfessionModuleSchema).professions)) {
          moduleConfig = extractLegacyProfessionPack(existingConfig as unknown as ProfessionModuleSchema, `${form.name || initialWorld?.name || '旧世界'} · 职业包`);
        } else moduleConfig = DEFAULT_MODULE_FACTORIES.profession?.();
      }
      if (moduleId === 'combat') {
        const existingConfig = existing.get(moduleId)?.moduleConfig ?? existing.get(moduleId)?.data;
        moduleConfig = existingConfig && typeof (existingConfig as Record<string, unknown>).rulesetId === 'string'
          ? existingConfig
          : DEFAULT_MODULE_FACTORIES.combat?.();
      }
      if (moduleId === 'progression' && moduleConfig) {
        moduleConfig = normalizeProgressionConfig(moduleConfig as unknown as import('../../modules/schema').ProgressionModuleSchema);
      }
      return {
        ...source,
        moduleId,
        name: source?.name || MODULE_NAME_MAP[moduleId] || moduleId,
        description: source?.description || '',
        enabled: true,
        moduleConfig: moduleConfig as Record<string, unknown> | undefined,
        data: undefined,
      };
    });
  };

  const handleAIGenerate = async () => {
    const promptText = isWeave ? worldIntentPrompt : aiGenName;
    if (!promptText.trim()) { setGenError('请输入世界描述'); return; }
    if (!apiConfig) { setGenError('请先在设置中配置API'); return; }
    setGenError(''); setIsGeneratingWorld(true);
    const ctrl = new AbortController(); aiAbortRef.current = ctrl;
    try { setShowGuidedChoice(true); } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setGenError(`生成失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setIsGeneratingWorld(false); aiAbortRef.current = null; }
  };

  const applyGeneratedWorld = (worldDef: WorldDef) => {
    worldDef = { ...worldDef, modules: normalizeSelectedWorldModules(worldDef.modules) };
    const entries = worldDef.worldBookEntries || [];
    const find = (type: string) => entries.find(e => e.entryType === type);
    update({
      name: worldDef.name || '', description: worldDef.description || '', icon: worldDef.icon || '', tags: worldDef.tags?.join(', ') || '',
      overview: find('setting')?.content || '', timePeriod: find('setting')?.meta?.timePeriod || '', location: find('setting')?.meta?.location || '', atmosphere: find('setting')?.meta?.atmosphere || '',
      powerSystem: find('rules')?.meta?.powerSystem || '', socialStructure: find('rules')?.meta?.socialStructure || '', specialRules: find('rules')?.meta?.specialRules?.join('\n') || '',
      currencyName: find('economy')?.meta?.currency?.name || '', currencySymbol: find('economy')?.meta?.currency?.symbol || '', currencyDesc: find('economy')?.meta?.currency?.description || '', priceLevel: find('economy')?.meta?.priceLevel || '',
      calendar: find('economy')?.meta?.calendar || '', startTime: find('economy')?.meta?.startTime || '', timeSpeed: find('economy')?.meta?.timeSpeed || '', timeSystem: find('economy')?.meta?.timeSystem,
      factions: entries.filter(e => e.entryType === 'factions').flatMap(e => e.meta?.factions ?? []).map(f => ({ name: f.name || '', description: f.description || '', alignment: f.alignment || '中立' })),
      presetNPCs: entries.filter(e => e.entryType === 'npcs').flatMap(e => e.meta?.npcs ?? []).map(n => ({ name: n.name || '', role: n.role || '', description: n.description || '', personality: typeof n.personality === 'string' ? n.personality : '' })),
      highlights: find('highlights')?.meta?.highlights?.join(', ') || '',
      locations: entries.filter(e => e.entryType === 'lore').map(e => ({ name: e.comment || '', description: (e.content || '').replace(/^【[^】]*】\n?/, '') })),
      culture: find('culture')?.content || '', modules: worldDef.modules,
      artwork: worldDef.artwork ?? form.artwork,
    });
    setWorldIntentPrompt(worldDef.description || worldIntentPrompt);
    setRefinedEntries(entries); setShowGuidedChoice(false); setEditorMode('manual');
  };

  const handleGuidedComplete = (worldDef: WorldDef) => applyGeneratedWorld(worldDef);

  const handleWeaveGenerate = async () => {
    if (isGeneratingWorld) return;
    if (!worldIntentPrompt.trim()) { setGenError('请先写下世界意图，再开始编织。'); return; }
    if (!apiConfig) {
      setGenError('');
      setWeaveValidation('未配置 AI，可继续手动编织。');
      setWeaveStep(3);
      return;
    }
    setGenError(''); setIsGeneratingWorld(true); setPipelineStage('解析种子');
    const ctrl = new AbortController(); aiAbortRef.current = ctrl;
    try {
      const selected = enabledModules.map(module => module.id).join(', ');
      const prompt = `你是世界编织助手。请根据以下世界意图和已选法则，一次生成可编辑的 WorldDef JSON。\n世界意图：${worldIntentPrompt.trim()}\n可选名称：${form.name.trim() || '请生成一个简洁名称'}\n题材/标签：${form.tags || '未指定'}\n氛围基调：${form.atmosphere || '未指定'}\n初始场景偏好：${form.location || '未指定'}\n已选模块：${selected || '无额外模块'}\n\n输出必须是 JSON，不要 Markdown。字段至少包含 name、description、tags、difficulty、worldBookEntries、modules；worldBookEntries 使用真实 entryType（setting、rules、factions、npcs、lore、culture、economy、highlights），modules 只包含已选模块。职业典藏与战斗规则是独立资产，禁止生成 professions、abilities、innateTalents、combat encounters 或 Combat 字段；它们由编辑器保留稳定引用。economy 条目的 meta 必须包含完整 timeSystem：mode、calendarName、eraName、start（年月日时分）、months（全部月份名称和天数）、weekdays、defaultTurnMinutes；无法确定时使用 relative 旅历安全默认值。`;
      const result = await requestStreamWithRetry(apiConfig, [{ role: 'user', content: prompt }], { signal: ctrl.signal, onDelta: text => { if (text.length > 80) setPipelineStage('编织法则'); } });
      setPipelineStage('生成编年');
      const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/) || result.text.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) throw new Error('AI 没有返回可识别的世界数据');
      const parsed = JSON.parse(jsonMatch[1].trim()) as WorldDef;
      if (!parsed.name || !parsed.description) throw new Error('AI 返回的数据缺少世界名称或简介');
      setPipelineStage('校验');
      const normalized: WorldDef = { ...parsed, id: initialWorld?.id || parsed.id || `custom_${Date.now()}`, entryId: null, source: undefined, modules: normalizeSelectedWorldModules(parsed.modules) };
      applyGeneratedWorld(normalized);
      setGenError('');
      setWeaveStep(3);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setGenError(`编织失败：${err instanceof Error ? err.message : String(err)}`);
      setPipelineStage('');
      return;
    } finally {
      setIsGeneratingWorld(false);
      aiAbortRef.current = null;
    }
  };

  const handleTalentAiGenerate = async (categoryIndex: number, count: number) => {
    if (!apiConfig) return;
    const cat = talentData?.categories?.[categoryIndex]; if (!cat) return;
    setIsGeneratingTalent(true);
    try {
      const prompt = `为以下世界的"${cat.name}"天赋大类生成${count}个天赋：\n世界描述：${form.overview || aiGenName || '通用世界'}\n大类：${cat.name}（${cat.description || '无描述'}）\n品质分5档：普通(40%)、精良(25%)、稀有(20%)、史诗(10%)、传说(5%)。\n只输出JSON数组：[{"id":"英文","name":"天赋名","description":"描述","rarity":"品质","effects":["效果"]}]`;
      const result = await requestStreamWithRetry(apiConfig, [{ role: 'user', content: prompt }], { signal: new AbortController().signal, onDelta: () => {} });
      const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/) || result.text.match(/(\[[\s\S]*\])/);
      if (jsonMatch) {
        const fixed = jsonMatch[1].trim().replace(/[""]/g, '"').replace(/['']/g, "'");
        const talents = JSON.parse(fixed);
        if (Array.isArray(talents)) {
          const next = JSON.parse(JSON.stringify(talentData));
          for (const t of talents) { if (!next.categories[categoryIndex].talents.find((et: any) => et.id === t.id)) next.categories[categoryIndex].talents.push(t); }
          updateModuleDataByModuleId('talent', next);
        }
      }
    } catch (err: unknown) { console.warn('[天赋AI生成] 失败:', err instanceof Error ? err.message : String(err)); }
    finally { setIsGeneratingTalent(false); }
  };

  const handleModuleAiFill = async (moduleId: string) => {
    if (!apiConfig) return; setGeneratingModule(moduleId);
    try {
      const desc = form.overview || aiGenName || '通用世界';
      const prompts: Record<string, string> = {
        stat: buildStatGenPrompt({ theme: desc, attrAName: '生命', attrBName: '能量', dim1Name: '攻击', dim2Name: '防御', dim3Name: '速度', dim4Name: '智力', dim5Name: '魅力', dim6Name: '幸运' }),
        progression: buildProgressionGenPrompt({ theme: desc, tone: '中等', era: '现代' }),
        survival: buildSurvivalGenPrompt({ theme: desc, tone: '中等' }),
        business: buildBusinessGenPrompt({ theme: desc, tone: '中等' }),
      };
      if (!prompts[moduleId]) return;
      const result = await requestStreamWithRetry(apiConfig, [{ role: 'user', content: prompts[moduleId] }], { signal: new AbortController().signal, onDelta: () => {} });
      const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/) || result.text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        const fixed = jsonMatch[1].trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
        const parsed = JSON.parse(fixed);
        const normalized = moduleId === 'progression'
          ? normalizeProgressionConfig(parsed as import('../../modules/schema').ProgressionModuleSchema)
          : moduleId === 'stat'
            ? {
                ...parsed,
                special: Array.isArray(parsed.special) ? parsed.special : [],
                pointScale: clampPointScale(parsed.pointScale),
              }
            : parsed;
        updateModuleDataByModuleId(moduleId, normalized as any);
      }
    } catch (err: unknown) { console.warn(`[模块AI补全] ${moduleId} 失败:`, err instanceof Error ? err.message : String(err)); }
    finally { setGeneratingModule(null); }
  };

  const professionModuleConfig = form.modules?.find(module => module.moduleId === 'profession')?.moduleConfig;
  const professionBinding: ProfessionWorldBinding = isProfessionBinding(professionModuleConfig)
    ? professionModuleConfig
    : { packIds: [] };

  const openProfessionLibrary = () => {
    if (professionModuleConfig && !isProfessionBinding(professionModuleConfig) && Array.isArray((professionModuleConfig as unknown as ProfessionModuleSchema).professions)) {
      updateModuleDataByModuleId('profession', extractLegacyProfessionPack(professionModuleConfig as unknown as ProfessionModuleSchema, `${form.name || initialWorld?.name || '旧世界'} · 职业包`) as unknown as Record<string, unknown>);
    }
    setProfessionLibraryOpen(true);
  };

  const generateProfessionPack = async (intent: string, basePack?: ProfessionPack) => {
    if (!apiConfig) throw new Error('请先在设置中配置 API');
    const result = await requestStreamWithRetry(apiConfig, [{ role: 'user', content: buildProfessionPackGenerationPrompt(intent, basePack) }], { signal: new AbortController().signal, onDelta: () => {} });
    return parseGeneratedProfessionPack(result.text);
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    const world = formToWorldDef(form, initialWorld, refinedEntries);
    world.modules = normalizeSelectedWorldModules(world.modules);
    injectModuleRuleEntries(world, form, refinedEntries);
    onSave(world);
  };

  const handleExport = () => {
    const world = formToWorldDef(form, initialWorld, refinedEntries);
    world.modules = normalizeSelectedWorldModules(world.modules);
    injectModuleRuleEntries(world, form, refinedEntries);
    const blob = new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${world.name || 'world'}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const enabledModules = [...selectedModules].map(id => ({ id, name: MODULE_NAME_MAP[id] || id }));
  const chronicleSignals = [
    form.overview, form.timePeriod, form.location, form.atmosphere, form.powerSystem,
    form.socialStructure, form.specialRules, form.culture, form.highlights,
  ].filter(value => value.trim()).length + form.locations.filter(item => item.name.trim() || item.description.trim()).length
    + form.factions.filter(item => item.name.trim()).length + form.presetNPCs.filter(item => item.name.trim()).length;
  const seedReady = editorMode === 'ai'
    ? Boolean(worldIntentPrompt.trim())
    : Boolean(form.name.trim() && form.description.trim());
  const chronicleCounts: Record<ManualEditSection, number> = {
    seed: 0,
    geography: [form.overview, form.timePeriod, form.location, form.atmosphere, form.culture, form.powerSystem, form.socialStructure, form.specialRules].filter(value => value.trim()).length + form.locations.filter(item => item.name.trim() || item.description.trim()).length,
    history: [form.currencyName, form.currencySymbol, form.currencyDesc, form.priceLevel, form.calendar, form.startTime, form.timeSpeed].filter(value => value.trim()).length + form.factions.filter(item => item.name.trim()).length,
    characters: form.presetNPCs.filter(item => item.name.trim() || item.role.trim() || item.description.trim() || item.personality.trim()).length,
    narrative: form.highlights.trim() ? 1 : 0,
    modules: enabledModules.length,
  };
  const selectedArtwork = resolveWorldArtwork({ id: initialWorld?.id || '', artwork: form.artwork });
  const selectedArtworkPresetId = form.artwork?.source === 'preset'
    ? form.artwork.presetId
    : form.artwork ? undefined : getDefaultArtworkPreset(initialWorld);
  const selectedScene = selectedArtwork.src;
  const previewName = form.name.trim() || initialWorld?.name || '未命名世界';
  const previewDescription = form.description.trim() || '尚未写下世界简介，完成后可在降临前继续补充。';
  const isWeave = presentationMode === 'world-weave';

  const renderManualSections = (sections: ManualEditSection[]) => (
    <ManualEditForm
      form={form} update={update} selectedModules={selectedModules} onToggleModule={toggleModule} disabledByConflict={disabledByConflict}
      updateModuleData={updateModuleData} onTalentAiGenerate={handleTalentAiGenerate} isGeneratingTalent={isGeneratingTalent}
      onModuleAiFill={handleModuleAiFill} generatingModule={generatingModule}
      onOpenProfessionLibrary={openProfessionLibrary}
      addFaction={addFaction} removeFaction={removeFaction} updateFaction={updateFaction}
      addNPC={addNPC} removeNPC={removeNPC} updateNPC={updateNPC}
      addLocation={addLocation} removeLocation={removeLocation} updateLocation={updateLocation}
      sections={sections}
    />
  );

  const handleWeaveBack = () => {
    setWeaveValidation('');
    if (weaveStep === 1) onCancel();
    else setWeaveStep(step => step - 1);
  };

  const handleWeaveNext = () => {
    if (weaveStep === 1 && !seedReady) {
      setWeaveValidation('请先填写世界名称和一句世界简介，再进入下一步。');
      return;
    }
    setWeaveValidation('');
    if (weaveStep < 4) setWeaveStep(step => step + 1);
    else handleSave();
  };

  const weaveStepContent = (
    <div className={`world-weave-step-content world-weave-step-content--${weaveStep}`}>
      {weaveStep === 1 && (
        <section aria-labelledby="world-weave-seed-title">
          <div className="world-weave-section-heading">
            <div><span className="world-weave-kicker">STEP 01 · SEED</span><h4 id="world-weave-seed-title">先写下这座世界的种子</h4></div>
            <span className="world-weave-section-hint">先描述意图，再在下一步选择世界法则</span>
          </div>
          {!isEditing && (
            <div className="world-weave-mode-toggle" role="group" aria-label="世界种子输入方式">
              <button type="button" className={editorMode === 'ai' ? 'is-active' : ''} onClick={() => setEditorMode('ai')}><Cpu size={15} /> AI 辅助生成</button>
              <button type="button" className={editorMode === 'manual' ? 'is-active' : ''} onClick={() => setEditorMode('manual')}><Pencil size={15} /> 手动编织</button>
            </div>
          )}
          <div className="world-weave-seed-grid">
            <label className="world-weave-field world-weave-field--wide"><span>世界名称（可选）</span><input value={form.name} onChange={e => update({ name: e.target.value })} placeholder="留空，让 AI 命名" /></label>
            <label className="world-weave-field"><span>题材 / 标签</span><input value={form.tags} onChange={e => update({ tags: e.target.value })} placeholder="冒险、悬疑、日常" /></label>
            <label className="world-weave-field"><span>氛围基调</span><input value={form.atmosphere} onChange={e => update({ atmosphere: e.target.value })} placeholder="晨雾、温柔、未知" /></label>
            <label className="world-weave-field"><span>初始场景偏好</span><input value={form.location} onChange={e => update({ location: e.target.value })} placeholder="例如：雾港、旧学院、边境集市" /></label>
          </div>
          {editorMode === 'ai' && !isEditing && (
            <div className="world-weave-ai-block">
              <div className="world-weave-ai-heading"><Sparkles size={16} /><strong>世界意图</strong><span>下一步选择法则后，才开始调用 AI</span></div>
              <textarea value={worldIntentPrompt} onChange={e => setWorldIntentPrompt(e.target.value)} rows={4} placeholder="例如：一座被潮汐和旧神守护的群岛，玩家从一间会移动的灯塔醒来……" />
            </div>
          )}
          {editorMode === 'manual' && <label className="world-weave-field world-weave-field--wide world-weave-manual-description"><span>一句世界简介 <b>*</b></span><textarea value={form.description} onChange={e => update({ description: e.target.value })} rows={3} placeholder="用一句话说清楚玩家将在哪里醒来、面对什么。" /></label>}
          {weaveValidation && <p className="world-weave-validation world-weave-validation--error" role="alert">{weaveValidation}</p>}
        </section>
      )}

      {weaveStep === 2 && (
          <section aria-labelledby="world-weave-rules-title">
            {isGeneratingWorld && <div className="world-weave-progress" role="status" aria-live="polite"><strong>正在编织世界</strong><span>{pipelineStage || '解析种子'}</span><div className="world-weave-progress__steps"><span className={pipelineStage === '解析种子' ? 'is-active' : ''}>解析种子</span><span className={pipelineStage === '编织法则' ? 'is-active' : ''}>编织法则</span><span className={pipelineStage === '生成编年' ? 'is-active' : ''}>生成编年</span><span className={pipelineStage === '校验' ? 'is-active' : ''}>校验</span></div></div>}
            {weaveValidation && !isGeneratingWorld && <p className="world-weave-validation world-weave-validation--error" role="alert">{weaveValidation}</p>}
          <div className="world-weave-section-heading"><div><span className="world-weave-kicker">STEP 02 · RULES</span><h4 id="world-weave-rules-title">选择这座世界遵循的法则</h4></div><span className="world-weave-section-hint">未选择的模块不会凭空生成数据</span></div>
          <div className="world-weave-module-surface"><ModuleSelector selected={selectedModules} onToggle={toggleModule} disabledByConflict={disabledByConflict} /><div className="world-weave-module-summary" aria-live="polite"><strong>当前启用</strong>{enabledModules.length ? enabledModules.map(module => <span key={module.id}>{module.name}</span>) : <span className="is-muted">暂无额外模块，仍可继续编年</span>}</div></div>
          {disabledByConflict.size > 0 && <p className="world-weave-validation world-weave-validation--warning"><AlertTriangle size={14} /> 已按互斥关系标记不可同时启用的模块，请选择适合本世界的一组法则。</p>}
          <div className="world-weave-rule-note"><ScrollText size={18} /><div><strong>参数稍后仍可调整</strong><p>第 3 步会展开已经启用模块的初始数据与编辑入口；没有实际数据的模块只保留说明，不会伪造内容。</p></div></div>
        </section>
      )}

      {weaveStep === 3 && (
        <section aria-labelledby="world-weave-chronicle-title">
          <div className="world-weave-section-heading"><div><span className="world-weave-kicker">STEP 03 · CHRONICLE</span><h4 id="world-weave-chronicle-title">编织世界的地理、历史与人物</h4></div><span className="world-weave-completion"><span>{chronicleSignals}</span> 项已填写</span></div>
          <p className="world-weave-step-lead">每组只承载一类真实字段；打开一组不会关闭其他组。基础名称、主题与系统模块选择由上方步骤轨道管理。</p>
          <div className="world-weave-chronicle-groups">
            <details className="world-weave-accordion" open>
              <summary><Map size={16} /><span>地理与世界观</span><em>{chronicleCounts.geography} 项已填写</em><ChevronRight size={15} /></summary>
              <div className="world-weave-accordion-body">{renderManualSections(['geography'])}</div>
            </details>
            <details className="world-weave-accordion">
              <summary><Flag size={16} /><span>阵营与历史</span><em>{chronicleCounts.history} 项已填写</em><ChevronRight size={15} /></summary>
              <div className="world-weave-accordion-body">{renderManualSections(['history'])}</div>
            </details>
            <details className="world-weave-accordion">
              <summary><User size={16} /><span>人物与开场</span><em>{chronicleCounts.characters} 项已填写</em><ChevronRight size={15} /></summary>
              <div className="world-weave-accordion-body">{renderManualSections(['characters'])}</div>
            </details>
            <details className="world-weave-accordion">
              <summary><ScrollText size={16} /><span>世界书与叙事</span><em>{chronicleCounts.narrative} 项已填写</em><ChevronRight size={15} /></summary>
              <div className="world-weave-accordion-body">{renderManualSections(['narrative'])}</div>
            </details>
            <details className="world-weave-accordion">
              <summary><BarChart3 size={16} /><span>模块初始数据</span><em>{chronicleCounts.modules} 个模块</em><ChevronRight size={15} /></summary>
              <div className="world-weave-accordion-body">{renderManualSections(['modules'])}</div>
            </details>
          </div>
        </section>
      )}

      {weaveStep === 4 && (
        <section aria-labelledby="world-weave-arrival-title" className="world-weave-arrival-preview">
          <div className="world-weave-arrival-visual">
            <div className="world-weave-arrival-gate" aria-label="降临之门预览">
              <div className="world-weave-arrival-scene" style={selectedScene ? { backgroundImage: `url("${selectedScene}")` } : undefined} />
              <img src="/art/theme/ui-kit/dawn-v4/ritual/departure-gate-v1.png" alt="降临之门" />
            </div>
            <span className="world-weave-arrival-caption">{form.location || '中央旅庭 · 待命'}</span>
          </div>
          <div className="world-weave-artwork-picker" aria-labelledby="world-weave-artwork-title">
            <div className="world-weave-artwork-picker__heading"><div><span className="world-weave-kicker">CRYSTAL ARTWORK</span><strong id="world-weave-artwork-title">水晶图景</strong></div><small>大厅、详情与降临门共用</small></div>
            <div className="world-weave-artwork-options">
              {WORLD_ARTWORK_PRESETS.map(preset => {
                const selected = selectedArtworkPresetId === preset.id;
                return <button type="button" key={preset.id} className={selected ? 'is-selected' : ''} onClick={() => selectArtworkPreset(preset.id)} aria-pressed={selected} title={preset.tone}><img src={preset.src} alt="" /><span>{preset.name}</span></button>;
              })}
            </div>
            <div className="world-weave-artwork-actions">
              <label className="world-weave-upload-button"><Upload size={14} /> {isProcessingArtwork ? '处理图片中…' : '上传图景'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleArtworkUpload} disabled={isProcessingArtwork} /></label>
              <button type="button" className="btn-ghost" onClick={restoreArtwork}>恢复默认</button>
              {artworkError && <span className="world-weave-validation world-weave-validation--error" role="alert">{artworkError}</span>}
            </div>
          </div>
          <div className="world-weave-arrival-summary">
            <span className="world-weave-kicker">STEP 04 · ARRIVAL</span>
            <h4 id="world-weave-arrival-title">{isEditing ? '保存这次世界编织' : '准备降临这座世界'}</h4>
            <p className="world-weave-arrival-description">{previewDescription}</p>
            <div className="world-weave-summary-link" role="group" aria-label="世界预览"><strong>{previewName}</strong><span>世界种子</span></div>
            <div className="world-weave-arrival-list"><div><span>启用法则</span><strong>{enabledModules.length ? enabledModules.map(module => module.name).join(' · ') : '无额外模块'}</strong></div><div><span>编年完成度</span><strong>{chronicleSignals ? `${chronicleSignals} 项已填写，可继续补充` : '尚未填写，可在步骤轨道中补充'}</strong></div></div>
            {(!seedReady || !chronicleSignals) && <p className="world-weave-validation world-weave-validation--warning"><AlertTriangle size={14} /> {seedReady ? '编年仍有空白，保存后可继续编辑。' : '世界名称与简介尚未完成。'}</p>}
          </div>
        </section>
      )}
    </div>
  );

  const weaveFooter = (
    <>
      <button type="button" className="btn-ghost world-weave-export" onClick={handleExport} aria-label="导出世界副本" title="导出世界副本"><Download size={14} /> <span>导出副本</span></button>
      <div className="world-weave-footer-actions">
        <button className="btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
        {weaveStep > 1 && <button className="btn-ghost" onClick={handleWeaveBack}><ChevronLeft size={15} /> 上一步</button>}
      <button className="btn-primary" onClick={weaveStep === 2 && editorMode === 'ai' ? handleAIGenerate : handleWeaveNext} disabled={(weaveStep === 1 && !seedReady) || (weaveStep === 2 && editorMode === 'ai' && (!worldIntentPrompt.trim() || isGeneratingWorld))}>{weaveStep === 4 ? <><Save size={14} /> {isEditing ? '保存修改' : '创建世界'}</> : weaveStep === 2 && editorMode === 'ai' ? <><Sparkles size={14} /> {isGeneratingWorld ? '生成中' : '开始编织世界'}</> : <>下一步 <ChevronRight size={15} /></>}</button>
      </div>
    </>
  );

  useBodyScrollLock(true);

  return (
    <>
      <div className={`entry-default-theme world-editor-overlay${presentationMode === 'world-weave' ? ' world-weave-editor-overlay' : ''}`}>
        <div className={`world-editor-panel${presentationMode === 'world-weave' ? ' world-weave-editor-panel' : ''}`} onClick={e => e.stopPropagation()}>
          <DawnFrameV4 mode="panel" withFill className={presentationMode === 'world-weave' ? 'world-weave-editor-frame' : 'world-editor-legacy-frame'} ariaLabel={presentationMode === 'world-weave' ? '世界编织仪式' : undefined}>
            <div className="world-weave-editor-content">
          <div className="world-editor-header">
            <div className="world-weave-header-main">
              <span className="world-weave-kicker">{isWeave ? (isEditing ? 'EDIT WORLD · DAWN V4' : 'CREATE WORLD · DAWN V4') : 'WORLD EDITOR'}</span>
              <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>{isWeave ? '世界编织仪式' : initialWorld ? '编辑世界' : '新建世界'}</h3>
            </div>
            <div className="world-weave-header-actions">
              <button type="button" className="world-weave-header-export" onClick={handleExport} aria-label="导出世界副本" title="导出世界副本"><Download size={15} /></button>
              <button type="button" className="world-weave-close" onClick={onCancel} aria-label="关闭世界编织仪式"><X size={18} /></button>
            </div>
            {isWeave && <div className="world-weave-stepbar" role="tablist" aria-label="世界编织步骤">
              {WEAVE_STEPS.map((label, index) => { const number = index + 1; return <button type="button" role="tab" key={label} aria-selected={number === weaveStep} className={number === weaveStep ? 'is-current' : number < weaveStep ? 'is-complete' : ''} disabled={number > weaveStep} onClick={() => number <= weaveStep && setWeaveStep(number)}><span>{number < weaveStep ? <Check size={13} /> : number}</span><b>{label}</b></button>; })}
            </div>}
          </div>
          <div className={`world-editor-body${showGuidedChoice ? ' has-guided-choice' : ''}`}>
          {isWeave ? (showGuidedChoice ? (
            <GuidedChoiceOverlay
              visible={showGuidedChoice}
              userDesc={worldIntentPrompt}
              selectedModules={[...selectedModules]}
              apiConfig={apiConfig}
              onComplete={handleGuidedComplete}
              onClose={() => setShowGuidedChoice(false)}
            />
          ) : weaveStepContent) : (
          <>
            {!isEditing && (
              <div className="mode-toggle">
                <button className={editorMode === 'ai' ? 'active' : ''} onClick={() => setEditorMode('ai')}><Cpu size={15} style={{ marginRight: 4, flexShrink: 0 }} /> AI 生成</button>
                <button className={editorMode === 'manual' ? 'active' : ''} onClick={() => setEditorMode('manual')}><Pencil size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 手动编辑</button>
              </div>
            )}
            {editorMode === 'ai' && !isEditing && (
              <div className="world-form-section" style={{ marginBottom: 20 }}>
                <h4><Cpu size={15} style={{ marginRight: 4, flexShrink: 0 }} /> AI 一键生成</h4>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: 10 }}>输入世界描述，AI 将自动生成创意名称和完整的世界设定，你可以在"手动编辑"中修改细节</p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="text" value={aiGenName} onChange={e => setAiGenName(e.target.value)} placeholder="例如：一个被僵尸占领的末日废土世界..." style={{ flex: 1, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text-primary)', fontSize: 'var(--font-size-md)' }} onKeyDown={e => e.key === 'Enter' && !isGeneratingWorld && handleAIGenerate()} />
                  <button className="btn-primary" onClick={handleAIGenerate} disabled={isGeneratingWorld} style={{ padding: '8px 20px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{isGeneratingWorld ? <><Loader size={14} className="animate-spin" /> 生成中...</> : <><Sparkles size={14} style={{ flexShrink: 0 }} /> 生成</>}</button>
                  {isGeneratingWorld && <button className="btn-ghost" onClick={() => aiAbortRef.current?.abort()} style={{ padding: '8px 12px', color: 'var(--danger)' }}>{t('common.cancel')}</button>}
                </div>
                <ModuleSelector selected={selectedModules} onToggle={toggleModule} disabledByConflict={disabledByConflict} />
                {selectedModules.has('survival') && (
                  <div style={{ marginTop: 8 }}>
                    <input type="text" value={survivalGenDesc} onChange={e => setSurvivalGenDesc(e.target.value)} placeholder="描述你想要的生存资源系统（如：荒岛求生，需要淡水/食物/木材/药草，初期紧张后期富足...）" style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }} />
                  </div>
                )}
                {genError && <div style={{ color: 'var(--danger)', fontSize: 'var(--font-size-sm)', marginTop: 8 }}>{genError}</div>}
                {isGeneratingWorld && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)' }}>
                      <div className="ai-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                      <span style={{ fontSize: 'var(--font-size-base)' }}>AI 正在构建世界...</span>
                    </div>
                    {pipelineStage && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', paddingLeft: 28, display: 'block', marginTop: 4 }}>{pipelineStage}</span>}
                  </div>
                )}
              </div>
            )}
            {editorMode === 'manual' && (
              <ManualEditForm
                form={form} update={update} selectedModules={selectedModules} onToggleModule={toggleModule} disabledByConflict={disabledByConflict}
                updateModuleData={updateModuleData} onTalentAiGenerate={handleTalentAiGenerate} isGeneratingTalent={isGeneratingTalent}
                onModuleAiFill={handleModuleAiFill} generatingModule={generatingModule}
                onOpenProfessionLibrary={openProfessionLibrary}
                addFaction={addFaction} removeFaction={removeFaction} updateFaction={updateFaction}
                addNPC={addNPC} removeNPC={removeNPC} updateNPC={updateNPC}
                addLocation={addLocation} removeLocation={removeLocation} updateLocation={updateLocation}
              />
            )}
          </>
          )}
          </div>
          <div className="world-editor-footer">
            {isWeave ? (showGuidedChoice ? null : weaveFooter) : (
            <>
            <button className="btn-ghost" onClick={handleExport} style={{ padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-sm)' }}><Download size={14} style={{ flexShrink: 0 }} /> 导出</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={onCancel} style={{ padding: '8px 20px' }}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={handleSave} disabled={!form.name.trim()} style={{ padding: '8px 24px', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Save size={14} style={{ flexShrink: 0 }} /> {t('worldEditor.saveWorld')}</button>
            </div>
            </>
            )}
          </div>
            </div>
          </DawnFrameV4>
        </div>
      </div>
      {professionLibraryOpen && (
        <ProfessionLibraryWorkspace
          binding={professionBinding}
          onBindingChange={next => updateModuleDataByModuleId('profession', next as unknown as Record<string, unknown>)}
          onGenerate={generateProfessionPack}
          onClose={() => setProfessionLibraryOpen(false)}
        />
      )}
    </>
  );
}
