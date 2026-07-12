import { useState, useEffect, useRef } from 'react';
import type { WorldDef, WorldBookEntryDef } from '../../data/worlds-schema';
import { requestStreamWithRetry } from '../../api/client';
import ModuleSelector, { getDefaultSelectedModules } from './ModuleSelector';
import { useConfigStore } from '../../stores/configStore';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import type { TalentModuleSchema } from '../../modules/schema';
import { buildStatGenPrompt, buildProgressionGenPrompt, buildSurvivalGenPrompt, buildBusinessGenPrompt } from '../../modules/prompts';
import GuidedChoiceOverlay from './GuidedChoiceOverlay';
import { ManualEditForm } from './worldEditorForm/ManualEditForm';
import {
  type FormState, defaultForm, worldToForm, formToWorldDef, injectModuleRuleEntries,
  DEFAULT_MODULE_FACTORIES, MODULE_NAME_MAP, MUTEX,
} from './worldEditorForm/types';
import { X, Cpu, Pencil, Sparkles, Loader, Download, Save } from 'lucide-react';

interface WorldEditorFormProps {
  initialWorld: WorldDef | null;
  onSave: (world: WorldDef) => void;
  onCancel: () => void;
  apiConfig: any;
  settings: any;
}

export default function WorldEditorForm({ initialWorld, onSave, onCancel, apiConfig }: WorldEditorFormProps) {
  const t = useConfigStore(s => s.t);
  const [form, setForm] = useState<FormState>(() => initialWorld ? worldToForm(initialWorld) : defaultForm);

  useEffect(() => { setForm(initialWorld ? worldToForm(initialWorld) : defaultForm); }, [initialWorld]);

  const [aiGenName, setAiGenName] = useState('');
  const [survivalGenDesc, setSurvivalGenDesc] = useState('');
  const [isGeneratingWorld, setIsGeneratingWorld] = useState(false);
  const [isGeneratingTalent, setIsGeneratingTalent] = useState(false);
  const [generatingModule, setGeneratingModule] = useState<string | null>(null);
  const [pipelineStage, setPipelineStage] = useState('');
  const [refinedEntries, setRefinedEntries] = useState<WorldBookEntryDef[]>([]);
  const [genError, setGenError] = useState('');
  const [selectedModules, setSelectedModules] = useState<Set<string>>(() => {
    if (initialWorld?.modules) return new Set(initialWorld.modules.filter(m => m.enabled).map(m => m.moduleId));
    return getDefaultSelectedModules();
  });
  const aiAbortRef = useRef<AbortController | null>(null);
  const [showGuidedChoice, setShowGuidedChoice] = useState(false);

  const isEditing = !!initialWorld;
  const [editorMode, setEditorMode] = useState<'manual' | 'ai'>(isEditing ? 'manual' : 'ai');

  // 互斥计算
  const disabledByConflict = new Set<string>();
  for (const id of selectedModules) { for (const conflict of (MUTEX[id] || [])) { if (!selectedModules.has(conflict)) disabledByConflict.add(conflict); } }

  const toggleModule = (moduleId: string) => {
    setSelectedModules(prev => {
      const next = new Set(prev); const adding = !next.has(moduleId);
      if (adding) { next.add(moduleId); for (const conflict of (MUTEX[moduleId] || [])) next.delete(conflict); } else next.delete(moduleId);
      return next;
    });
    setForm(f => {
      let modules = f.modules ? [...f.modules] : [];
      if (moduleId) {
        if (!selectedModules.has(moduleId)) {
          for (const conflict of (MUTEX[moduleId] || [])) modules = modules.filter(m => m.moduleId !== conflict);
          if (!modules.find(m => m.moduleId === moduleId)) {
            const data = DEFAULT_MODULE_FACTORIES[moduleId]?.();
            modules.push({ moduleId, name: MODULE_NAME_MAP[moduleId] || moduleId, description: '', enabled: true, ...(data ? { data: data as Record<string, unknown> } : {}) });
          } else modules = modules.map(m => m.moduleId === moduleId ? { ...m, enabled: true } : m);
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

  const talentData = form.modules?.find(m => m.moduleId === 'talent')?.moduleConfig as TalentModuleSchema | undefined;

  const handleAIGenerate = async () => {
    if (!aiGenName.trim()) { setGenError('请输入世界描述'); return; }
    if (!apiConfig) { setGenError('请先在设置中配置API'); return; }
    setGenError(''); setIsGeneratingWorld(true);
    const ctrl = new AbortController(); aiAbortRef.current = ctrl;
    try { setShowGuidedChoice(true); } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setGenError(`生成失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setIsGeneratingWorld(false); aiAbortRef.current = null; }
  };

  const handleGuidedComplete = (worldDef: WorldDef) => {
    const entries = worldDef.worldBookEntries || [];
    const find = (type: string) => entries.find(e => e.entryType === type);
    update({
      name: worldDef.name || '', description: worldDef.description || '', icon: worldDef.icon || '', tags: worldDef.tags?.join(', ') || '',
      overview: find('setting')?.content || '', timePeriod: find('setting')?.meta?.timePeriod || '', location: find('setting')?.meta?.location || '', atmosphere: find('setting')?.meta?.atmosphere || '',
      powerSystem: find('rules')?.meta?.powerSystem || '', socialStructure: find('rules')?.meta?.socialStructure || '', specialRules: find('rules')?.meta?.specialRules?.join('\n') || '',
      currencyName: find('economy')?.meta?.currency?.name || '', currencySymbol: find('economy')?.meta?.currency?.symbol || '', currencyDesc: find('economy')?.meta?.currency?.description || '', priceLevel: find('economy')?.meta?.priceLevel || '',
      factions: entries.filter(e => e.entryType === 'factions').flatMap(e => e.meta?.factions ?? []).map(f => ({ name: f.name || '', description: f.description || '', alignment: f.alignment || '中立' })),
      presetNPCs: entries.filter(e => e.entryType === 'npcs').flatMap(e => e.meta?.npcs ?? []).map(n => ({ name: n.name || '', role: n.role || '', description: n.description || '', personality: typeof n.personality === 'string' ? n.personality : '' })),
      highlights: find('highlights')?.meta?.highlights?.join(', ') || '',
      locations: entries.filter(e => e.entryType === 'lore').map(e => ({ name: e.comment || '', description: (e.content || '').replace(/^【[^】]*】\n?/, '') })),
      culture: find('culture')?.content || '', modules: worldDef.modules,
    });
    setRefinedEntries(entries); setShowGuidedChoice(false); setEditorMode('manual');
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
      if (jsonMatch) { const fixed = jsonMatch[1].trim().replace(/[""]/g, '"').replace(/['']/g, "'"); updateModuleDataByModuleId(moduleId, JSON.parse(fixed)); }
    } catch (err: unknown) { console.warn(`[模块AI补全] ${moduleId} 失败:`, err instanceof Error ? err.message : String(err)); }
    finally { setGeneratingModule(null); }
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    const world = formToWorldDef(form, initialWorld, refinedEntries);
    injectModuleRuleEntries(world, form, refinedEntries);
    onSave(world);
  };

  const handleExport = () => {
    const world = formToWorldDef(form, initialWorld, refinedEntries);
    injectModuleRuleEntries(world, form, refinedEntries);
    const blob = new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${world.name || 'world'}.json`; a.click(); URL.revokeObjectURL(url);
  };

  useBodyScrollLock(true);

  return (
    <>
      <div className="world-editor-overlay">
        <div className="world-editor-panel" onClick={e => e.stopPropagation()}>
          <div className="world-editor-header">
            <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>{initialWorld ? '编辑世界' : '新建世界'}</h3>
            <button onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={16} /></button>
          </div>
          <div className="world-editor-body">
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
                addFaction={addFaction} removeFaction={removeFaction} updateFaction={updateFaction}
                addNPC={addNPC} removeNPC={removeNPC} updateNPC={updateNPC}
                addLocation={addLocation} removeLocation={removeLocation} updateLocation={updateLocation}
              />
            )}
          </div>
          <div className="world-editor-footer">
            <button className="btn-ghost" onClick={handleExport} style={{ padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-sm)' }}><Download size={14} style={{ flexShrink: 0 }} /> 导出</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={onCancel} style={{ padding: '8px 20px' }}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={handleSave} disabled={!form.name.trim()} style={{ padding: '8px 24px', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Save size={14} style={{ flexShrink: 0 }} /> {t('worldEditor.saveWorld')}</button>
            </div>
          </div>
        </div>
      </div>
      {showGuidedChoice && (
        <GuidedChoiceOverlay visible={showGuidedChoice} userDesc={aiGenName} selectedModules={[...selectedModules]} apiConfig={apiConfig} onComplete={handleGuidedComplete} onClose={() => setShowGuidedChoice(false)} />
      )}
    </>
  );
}
