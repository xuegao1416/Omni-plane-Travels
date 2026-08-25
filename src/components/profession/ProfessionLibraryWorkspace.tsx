import { useMemo, useRef, useState } from 'react';
import {
  Bot,
  Copy,
  Download,
  FilePlus2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  InnateTalentDef,
  CombatScalingDefinition,
  CombatTargetMode,
  ProfessionAbilityDef,
  ProfessionAccentKey,
  ProfessionPack,
  ProfessionWorldBinding,
} from '../../modules/schema';
import { getCanonicalStatOptions } from '../../modules/canonicalStats';
import {
  createEmptyProfessionPack,
  deleteProfessionPack,
  exportProfessionPack,
  importProfessionPack,
  listProfessionPacks,
  normalizeProfessionPack,
  saveProfessionPack,
  validateProfessionPack,
} from '../../data/professions';
import ProfessionTreeCanvas from './ProfessionTreeCanvas';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { describeProfessionMechanics } from '../../gameplay/profession';
import { PROFESSION_ACCENT_KEYS, PROFESSION_EMBLEM_KEYS } from '../../data/professions/professionVisuals';

function downloadText(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || '职业包';
}

export default function ProfessionLibraryWorkspace({
  binding,
  onBindingChange,
  onClose,
  onGenerate,
}: {
  binding: ProfessionWorldBinding;
  onBindingChange: (binding: ProfessionWorldBinding) => void;
  onClose: () => void;
  onGenerate?: (intent: string, basePack?: ProfessionPack) => Promise<ProfessionPack>;
}) {
  const [packs, setPacks] = useState(() => listProfessionPacks());
  const [activePackId, setActivePackId] = useState(() => binding.packIds[0] ?? listProfessionPacks()[0]?.manifest.id ?? '');
  const [activeProfessionId, setActiveProfessionId] = useState('');
  const [selectedAbilityId, setSelectedAbilityId] = useState('');
  const [section, setSection] = useState<'tree' | 'talents'>('tree');
  const [aiIntent, setAiIntent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ProfessionPack>>({});
  const [pendingGeneratedPack, setPendingGeneratedPack] = useState<ProfessionPack | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const talentImportRef = useRef<HTMLInputElement>(null);

  const visiblePacks = useMemo(() => {
    const byId = new Map(packs.map(pack => [pack.manifest.id, pack]));
    for (const draft of Object.values(drafts)) byId.set(draft.manifest.id, draft);
    return [...byId.values()];
  }, [drafts, packs]);
  const activePack = drafts[activePackId] ?? packs.find(pack => pack.manifest.id === activePackId) ?? visiblePacks[0];
  const activeProfession = activePack?.professions.find(item => item.id === activeProfessionId) ?? activePack?.professions[0];
  const selectedAbility = activeProfession?.abilities.find(item => item.id === selectedAbilityId);
  const editable = Boolean(activePack && !activePack.manifest.builtin);
  const activePackIsDraft = Boolean(activePack && drafts[activePack.manifest.id]);
  const pendingValidation = pendingGeneratedPack ? validateProfessionPack(pendingGeneratedPack) : undefined;

  const refresh = (preferredId?: string) => {
    const next = listProfessionPacks();
    setPacks(next);
    if (preferredId) setActivePackId(preferredId);
  };

  const saveDraft = (next: ProfessionPack | undefined = activePack) => {
    if (!next || !editable) return;
    try {
      const saved = saveProfessionPack(normalizeProfessionPack(next));
      setDrafts(current => {
        const remaining = { ...current };
        delete remaining[saved.manifest.id];
        return remaining;
      });
      refresh(saved.manifest.id);
      setMessage('职业包已保存');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '职业包验证失败，未保存');
    }
  };

  const updateActivePack = (mutate: (draft: ProfessionPack) => void) => {
    if (!activePack || !editable) return;
    const draft = structuredClone(activePack);
    mutate(draft);
    setDrafts(current => ({ ...current, [draft.manifest.id]: draft }));
    setMessage('已更新职业包草稿，点击“保存”后才会写入职业典藏');
  };

  const selectPack = (packId: string) => {
    setActivePackId(packId);
    setActiveProfessionId('');
    setSelectedAbilityId('');
    if (drafts[packId]) setMessage('已切换到未保存草稿；草稿会保留在本会话中');
  };

  const createPackDraft = (source: ProfessionPack, name = source.manifest.name) => {
    const draft = structuredClone(source);
    draft.manifest = {
      ...draft.manifest,
      id: `profession-pack-${Date.now()}`,
      name,
      version: '2.0.0',
      builtin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setDrafts(current => ({ ...current, [draft.manifest.id]: draft }));
    setActivePackId(draft.manifest.id);
    setActiveProfessionId('');
    setSelectedAbilityId('');
    setMessage('已创建职业包草稿；逐步编辑完成后点击“保存”');
  };

  const requestClose = () => {
    const hasUncommittedWork = Object.keys(drafts).length > 0 || pendingGeneratedPack !== null;
    if (hasUncommittedWork && typeof window !== 'undefined' && !window.confirm('当前有未保存草稿或待确认的 AI 预览，关闭后将离开本次编辑。确定关闭吗？')) return;
    onClose();
  };

  const toggleBinding = (packId: string) => {
    if (drafts[packId]) {
      setMessage('当前职业包有未保存草稿，请先保存后再挂载到世界');
      return;
    }
    const selected = new Set(binding.packIds);
    if (selected.has(packId)) selected.delete(packId);
    else selected.add(packId);
    onBindingChange({ ...binding, packIds: [...selected] });
  };

  const addAbility = () => {
    if (!activeProfession) return;
    const id = `ability-${Date.now()}`;
    updateActivePack(draft => {
      const profession = draft.professions.find(item => item.id === activeProfession.id);
      profession?.abilities.push({ id, name: '新能力', description: '', type: 'active', tier: 1, pointCost: 1, maxRank: 1, prerequisites: [], activation: { combatAction: { id, name: '新能力', target: 'enemy', actionCost: 1, accuracy: 10, damage: 1, scaling: [{ statId: 'dim1', coefficient: 0.08, appliesTo: 'damage' }] } } });
    });
    setSelectedAbilityId(id);
  };

  const updateAbility = (patch: Partial<ProfessionAbilityDef>) => {
    if (!activeProfession || !selectedAbility) return;
    updateActivePack(draft => {
      const ability = draft.professions.find(item => item.id === activeProfession.id)?.abilities.find(item => item.id === selectedAbility.id);
      if (ability) Object.assign(ability, patch);
    });
  };

  const updateCombatAction = (patch: Partial<NonNullable<NonNullable<ProfessionAbilityDef['activation']>['combatAction']>>) => {
    if (!activeProfession || !selectedAbility) return;
    updateActivePack(draft => {
      const ability = draft.professions.find(item => item.id === activeProfession.id)?.abilities.find(item => item.id === selectedAbility.id);
      if (!ability) return;
      const current = ability.activation?.combatAction ?? {
        id: ability.id,
        name: ability.name,
        target: 'enemy' as const,
        actionCost: 1,
        accuracy: 10,
        damage: 1,
      };
      ability.activation = {
        ...(ability.activation ?? {}),
        combatAction: { ...current, ...patch, id: ability.id, name: ability.name },
      };
    });
  };

  const updateCombatScaling = (patch: Partial<CombatScalingDefinition>) => {
    if (!selectedAbility) return;
    const current = selectedAbility.activation?.combatAction?.scaling?.[0] ?? { statId: 'dim1' as const, coefficient: 0.08, appliesTo: 'damage' as const };
    updateCombatAction({ scaling: [{ ...current, ...patch }] });
  };

  const updateCombatCost = (amount: number) => {
    if (!selectedAbility) return;
    updateAbility({
      activation: {
        ...(selectedAbility.activation ?? {}),
        ...(amount > 0 ? { costs: [{ path: '玩家.生存状态.体力值', amount, label: '战斗资源' }] } : { costs: [] }),
      },
    });
  };

  const updateCombatStatus = (patch: { name?: string; durationRounds?: number; damagePerRound?: number }) => {
    if (!selectedAbility) return;
    const current = selectedAbility.activation?.combatAction?.appliesStatus ?? {
      id: `${selectedAbility.id}-status`,
      name: '',
      durationRounds: 1,
    };
    const next = { ...current, ...patch };
    updateCombatAction({ appliesStatus: next.name.trim() ? next : undefined });
  };

  const updatePersistentCombat = (key: 'damage' | 'healing' | 'accuracy' | 'armor' | 'initiative', value: number) => {
    if (!selectedAbility) return;
    updateAbility({ mechanics: {
      ...(selectedAbility.mechanics ?? {}),
      combat: { ...(selectedAbility.mechanics?.combat ?? {}), [key]: value },
    } });
  };

  const updatePersistentCheck = (patch: { statId?: CombatScalingDefinition['statId']; value?: number }) => {
    if (!selectedAbility) return;
    const current = selectedAbility.mechanics?.checks?.[0] ?? { statIds: ['dim1' as const], value: 1 };
    updateAbility({ mechanics: {
      ...(selectedAbility.mechanics ?? {}),
      checks: [{
        ...current,
        statIds: [patch.statId ?? current.statIds?.[0] ?? 'dim1'],
        value: patch.value ?? current.value,
      }],
    } });
  };

  const removeAbility = () => {
    if (!activeProfession || !selectedAbility) return;
    const removedId = selectedAbility.id;
    updateActivePack(draft => {
      const profession = draft.professions.find(item => item.id === activeProfession.id);
      if (!profession) return;
      profession.abilities = profession.abilities.filter(item => item.id !== removedId).map(item => ({ ...item, prerequisites: item.prerequisites?.filter(id => id !== removedId) }));
    });
    setSelectedAbilityId('');
  };

  const removeProfession = () => {
    if (!activeProfession) return;
    const removedId = activeProfession.id;
    updateActivePack(draft => {
      draft.professions = draft.professions.filter(item => item.id !== removedId);
    });
    setActiveProfessionId('');
    setSelectedAbilityId('');
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = saveProfessionPack(importProfessionPack(await file.text()));
      refresh(imported.manifest.id);
      if (!binding.packIds.includes(imported.manifest.id)) onBindingChange({ ...binding, packIds: [...binding.packIds, imported.manifest.id] });
      setMessage(`已导入 ${imported.manifest.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '职业包导入失败');
    }
  };

  const handleTalentImport = async (file: File | undefined) => {
    if (!file || !activePack || !editable) return;
    try {
      const parsed = JSON.parse(await file.text()) as { type?: string; data?: unknown };
      const talents = (parsed.data ?? parsed) as unknown;
      if (!Array.isArray(talents)) throw new Error('天赋文件不是数组');
      updateActivePack(draft => { draft.innateTalents = talents as InnateTalentDef[]; });
      setMessage('先天天赋已导入当前职业包');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '天赋导入失败');
    }
  };

  const handleGenerate = async (reviseActivePack = false) => {
    if (!onGenerate || generating) return;
    setGenerating(true);
    setMessage('');
    try {
      const generated = normalizeProfessionPack(await onGenerate(aiIntent, reviseActivePack ? activePack : undefined));
      setPendingGeneratedPack(generated);
      setAiIntent('');
      setMessage(`已生成 ${generated.manifest.name} 的本地配平预览，请确认后写入`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '职业包生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const confirmGeneratedPack = () => {
    if (!pendingGeneratedPack || !pendingValidation?.ok) return;
    try {
      const saved = saveProfessionPack(pendingGeneratedPack);
      refresh(saved.manifest.id);
      if (!binding.packIds.includes(saved.manifest.id)) onBindingChange({ ...binding, packIds: [...binding.packIds, saved.manifest.id] });
      setPendingGeneratedPack(null);
      setMessage(`已确认并保存 ${saved.manifest.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'AI 预览验证失败，未保存');
    }
  };

  const cancelGeneratedPack = () => {
    setPendingGeneratedPack(null);
    setMessage('已取消 AI 预览，未写入职业典藏或世界挂载');
  };

  const talentCount = useMemo(() => activePack?.innateTalents.length ?? 0, [activePack]);

  return (
    <>
      <div className="profession-library__backdrop" onClick={requestClose} aria-hidden="true" />
      <section className="profession-library" role="dialog" aria-modal="true" aria-label="职业典藏">
        <DawnFrameV4 mode="panel" withFill className="profession-library__frame" ariaLabel="职业典藏">
          <div className="profession-library__shell">
          <header className="profession-library__header">
          <div className="profession-library__title"><h2>职业典藏</h2><p>职业包独立于世界生成；世界只引用这里的完整职业树。</p></div>
          <div className="profession-library__toolbar">
            <button className="btn-ghost btn-sm" onClick={() => importRef.current?.click()}><Upload size={14} />导入包</button>
            <input ref={importRef} hidden type="file" accept=".json,.opt-profession,application/json" onChange={event => void handleImport(event.target.files?.[0])} />
            <button className="btn-ghost btn-sm" onClick={() => activePack && downloadText(`${safeName(activePack.manifest.name)}.opt-profession.json`, exportProfessionPack(activePack))} disabled={!activePack}><Download size={14} />导出包</button>
            <button className="btn-ghost btn-sm" onClick={() => createPackDraft(createEmptyProfessionPack())}><FilePlus2 size={14} />新建</button>
            <button className="btn-ghost btn-sm" onClick={() => activePack && createPackDraft(activePack, `${activePack.manifest.name} · 副本`)} disabled={!activePack}><Copy size={14} />复制后编辑</button>
            <button className="btn-ghost btn-icon" onClick={requestClose} aria-label="关闭职业典藏"><X size={18} /></button>
          </div>
        </header>

        <div className="profession-library__body">
          <aside className="profession-library__packs">
            <strong>职业包库</strong>
            <div className="profession-library__pack-list">
              {visiblePacks.map(pack => (
                <button key={pack.manifest.id} className={`profession-library__pack${pack.manifest.id === activePack?.manifest.id ? ' is-active' : ''}`} onClick={() => selectPack(pack.manifest.id)}>
                  <span>{pack.manifest.name}</span>
                  <small>{pack.manifest.builtin ? '内置' : '自定义'}{drafts[pack.manifest.id] ? ' · 未保存草稿' : ''} · {pack.professions.length} 个职业</small>
                </button>
              ))}
            </div>
            {activePack && (
              <label className="profession-library__field" style={{ marginTop: 12 }}>
                <span><input type="checkbox" checked={binding.packIds.includes(activePack.manifest.id)} onChange={() => toggleBinding(activePack.manifest.id)} /> 挂载到当前世界</span>
              </label>
            )}
            <div className="profession-library__field">
              <span>AI 独立生成职业包</span>
              <textarea rows={4} value={aiIntent} onChange={event => setAiIntent(event.target.value)} placeholder="例如：蒸汽朋克调查员、机械师与灵媒的五阶职业体系" />
              <button className="btn-primary btn-sm" onClick={() => void handleGenerate(false)} disabled={!onGenerate || generating}><Bot size={14} />{generating ? '正在生成完整树…' : '生成新包'}</button>
              <button className="btn-ghost btn-sm" onClick={() => void handleGenerate(true)} disabled={!onGenerate || generating || !activePack}><Sparkles size={14} />基于当前包修订</button>
            </div>
            {pendingGeneratedPack && pendingValidation && <div className="profession-library__binding">
              <strong>待确认的 AI 本地配平预览</strong>
              <span>{pendingGeneratedPack.manifest.name}</span>
              <small>{pendingGeneratedPack.professions.length} 个职业 · {pendingGeneratedPack.innateTalents.length} 个先天天赋 · {(pendingGeneratedPack.freeSkillCatalog ?? pendingGeneratedPack.freeSkills ?? []).length} 个自由技能</small>
              {pendingValidation.errors.length > 0 && <div style={{ color: 'var(--danger, #d66)', fontSize: 11 }}>{pendingValidation.errors.map(error => <div key={`${error.path}-${error.code}`}>{error.message}</div>)}</div>}
              <div style={{ display: 'grid', gap: 4, fontSize: 11 }}>
                {pendingGeneratedPack.professions.flatMap(profession => profession.abilities.map(ability => ({ profession, ability }))).slice(0, 4).map(({ profession, ability }) => <span key={`${profession.id}-${ability.id}`} className="profession-library__mechanic-summary">{profession.name} / {ability.name}：{describeProfessionMechanics(ability.mechanics) || '无机械'}</span>)}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-primary btn-sm" onClick={confirmGeneratedPack} disabled={!pendingValidation.ok}>确认保存</button>
                <button className="btn-ghost btn-sm" onClick={cancelGeneratedPack}>取消</button>
              </div>
            </div>}
            {message && <p style={{ color: 'var(--text-muted)', fontSize: 11 }}>{message}</p>}
          </aside>

          <main className="profession-library__workspace">
            {activePack ? <>
              <div className="profession-library__tabs">
                {activePack.professions.map(profession => <button key={profession.id} className={(activeProfession?.id === profession.id && section === 'tree') ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => { setSection('tree'); setActiveProfessionId(profession.id); setSelectedAbilityId(''); }}>{profession.name}</button>)}
                <button className={section === 'talents' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSection('talents')}><Sparkles size={13} />先天天赋 {talentCount}</button>
                {editable && <button className="btn-ghost btn-icon" onClick={() => {
                  const id = `profession-${Date.now()}`;
                  updateActivePack(draft => draft.professions.push({ id, name: '新职业', description: '', abilities: [] }));
                  setActiveProfessionId(id);
                  setSection('tree');
                }} title="新增职业"><Plus size={15} /></button>}
              </div>
              <div className="profession-library__editor">
                {section === 'tree' && activeProfession ? (
                  <ProfessionTreeCanvas
                    profession={activeProfession}
                    selectedAbilityId={selectedAbilityId}
                    onSelectAbility={setSelectedAbilityId}
                    editable={editable}
                    onConnect={(sourceId, targetId) => updateActivePack(draft => {
                      const target = draft.professions.find(item => item.id === activeProfession.id)?.abilities.find(item => item.id === targetId);
                      if (target && !target.prerequisites?.includes(sourceId)) target.prerequisites = [...(target.prerequisites ?? []), sourceId];
                    })}
                  />
                ) : section === 'talents' ? (
                  <div style={{ display: 'grid', alignContent: 'start', gap: 8, overflow: 'auto' }}>
                    {activePack.innateTalents.map((talent, index) => <article key={talent.id} className="profession-library__binding">
                      <input value={talent.name} disabled={!editable} onChange={event => updateActivePack(draft => { draft.innateTalents[index].name = event.target.value; })} />
                      <textarea value={talent.description} disabled={!editable} onChange={event => updateActivePack(draft => { draft.innateTalents[index].description = event.target.value; })} />
                      <span>创建点数：{talent.cost} · {talent.rarity ?? '普通'}</span>
                      <label className="profession-library__field">本地图标<select disabled={!editable} value={talent.iconKey ?? ''} onChange={event => updateActivePack(draft => { draft.innateTalents[index].iconKey = event.target.value || undefined; })}><option value="">自动回退</option>{PROFESSION_EMBLEM_KEYS.map(key => <option key={key} value={key}>{key}</option>)}</select></label>
                      <strong className="profession-library__mechanic-summary">实际机制：{describeProfessionMechanics(talent.mechanics) || '尚未配置（保存前必须补齐）'}</strong>
                      <div className="profession-library__talent-mechanics">
                        <label className="profession-library__field">检定属性<select disabled={!editable} value={talent.mechanics?.checks?.[0]?.statIds?.[0] ?? 'dim1'} onChange={event => updateActivePack(draft => { const item = draft.innateTalents[index]; item.mechanics = { ...(item.mechanics ?? {}), checks: [{ ...(item.mechanics?.checks?.[0] ?? { value: 1 }), statIds: [event.target.value as CombatScalingDefinition['statId']] }] }; })}>{getCanonicalStatOptions().map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                        <label className="profession-library__field">检定加值<input disabled={!editable} type="number" value={talent.mechanics?.checks?.[0]?.value ?? 0} onChange={event => updateActivePack(draft => { const item = draft.innateTalents[index]; item.mechanics = { ...(item.mechanics ?? {}), checks: [{ ...(item.mechanics?.checks?.[0] ?? { statIds: ['dim1'] }), value: Number(event.target.value) || 0 }] }; })} /></label>
                      </div>
                    </article>)}
                    {editable && <button className="btn-ghost" onClick={() => updateActivePack(draft => draft.innateTalents.push({ id: `talent-${Date.now()}`, name: '新天赋', description: '', cost: 1, mechanics: { checks: [{ statIds: ['dim1'], value: 1 }] } }))}><Plus size={14} />新增先天天赋</button>}
                  </div>
                ) : <div className="profession-tree-canvas__empty">这个职业包还没有职业。</div>}
              </div>
            </> : <div className="profession-tree-canvas__empty">职业包库为空。</div>}
          </main>

          <aside className="profession-library__inspector">
            {activePack && <>
              <h3>{selectedAbility ? '能力节点' : '职业包信息'}</h3>
              {activePackIsDraft && <p style={{ color: 'var(--text-muted)', fontSize: 11 }}>当前为未保存草稿；中间态允许暂时不满足完整包校验。</p>}
              {activePack.baselineStatus === 'legacy-v1-incomplete' && <p style={{ color: 'var(--text-muted)', fontSize: 11 }}>旧版 v1：内容低于 3.0 基准，但仍可继续使用或补全，不会自动填充假技能。</p>}
              {selectedAbility ? <>
                <label className="profession-library__field">名称<input value={selectedAbility.name} disabled={!editable} onChange={event => updateAbility({ name: event.target.value })} /></label>
                <label className="profession-library__field">描述<textarea rows={5} value={selectedAbility.description} disabled={!editable} onChange={event => updateAbility({ description: event.target.value })} /></label>
                <label className="profession-library__field">本地图标<select value={selectedAbility.iconKey ?? ''} disabled={!editable} onChange={event => updateAbility({ iconKey: event.target.value || undefined })}><option value="">自动回退</option>{PROFESSION_EMBLEM_KEYS.map(key => <option key={key} value={key}>{key}</option>)}</select></label>
                <label className="profession-library__field">类型<select value={selectedAbility.type} disabled={!editable} onChange={event => updateAbility({ type: event.target.value as ProfessionAbilityDef['type'] })}><option value="active">主动</option><option value="passive">被动</option><option value="specialization">专精</option><option value="ultimate">终极</option></select></label>
                <label className="profession-library__field">树阶<input type="number" min={1} max={20} value={selectedAbility.tier ?? 1} disabled={!editable} onChange={event => updateAbility({ tier: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label className="profession-library__field">所需职业等级<input type="number" min={1} max={999} value={selectedAbility.requiredProfessionLevel ?? selectedAbility.tier ?? 1} disabled={!editable} onChange={event => updateAbility({ requiredProfessionLevel: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label className="profession-library__field">点数<input type="number" min={0} value={selectedAbility.pointCost ?? 1} disabled={!editable} onChange={event => updateAbility({ pointCost: Math.max(0, Number(event.target.value) || 0) })} /></label>
                <label className="profession-library__field">最高等级<input type="number" min={1} max={99} value={selectedAbility.maxRank ?? 1} disabled={!editable} onChange={event => updateAbility({ maxRank: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label className="profession-library__field">前置节点<input value={(selectedAbility.prerequisites ?? []).join(', ')} disabled={!editable} onChange={event => updateAbility({ prerequisites: event.target.value.split(/[,，]/).map(item => item.trim()).filter(Boolean) })} /></label>
                {(selectedAbility.type === 'passive' || selectedAbility.type === 'specialization') && <div className="profession-library__combat-editor">
                  <strong>常驻机械</strong>
                  <small>解锁后由本地结算持续生效；不是只给 AI 看的描述。</small>
                  <label className="profession-library__field">职业行动伤害<input type="number" value={selectedAbility.mechanics?.combat?.damage ?? 0} disabled={!editable} onChange={event => updatePersistentCombat('damage', Number(event.target.value) || 0)} /></label>
                  <label className="profession-library__field">职业治疗<input type="number" value={selectedAbility.mechanics?.combat?.healing ?? 0} disabled={!editable} onChange={event => updatePersistentCombat('healing', Number(event.target.value) || 0)} /></label>
                  <label className="profession-library__field">命中<input type="number" value={selectedAbility.mechanics?.combat?.accuracy ?? 0} disabled={!editable} onChange={event => updatePersistentCombat('accuracy', Number(event.target.value) || 0)} /></label>
                  <label className="profession-library__field">护甲<input type="number" value={selectedAbility.mechanics?.combat?.armor ?? 0} disabled={!editable} onChange={event => updatePersistentCombat('armor', Number(event.target.value) || 0)} /></label>
                  <label className="profession-library__field">先手<input type="number" value={selectedAbility.mechanics?.combat?.initiative ?? 0} disabled={!editable} onChange={event => updatePersistentCombat('initiative', Number(event.target.value) || 0)} /></label>
                  <label className="profession-library__field">检定属性<select value={selectedAbility.mechanics?.checks?.[0]?.statIds?.[0] ?? 'dim1'} disabled={!editable} onChange={event => updatePersistentCheck({ statId: event.target.value as CombatScalingDefinition['statId'] })}>{getCanonicalStatOptions().map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label className="profession-library__field">检定加值<input type="number" value={selectedAbility.mechanics?.checks?.[0]?.value ?? 0} disabled={!editable} onChange={event => updatePersistentCheck({ value: Number(event.target.value) || 0 })} /></label>
                </div>}
                {(selectedAbility.type === 'active' || selectedAbility.type === 'ultimate') && <div className="profession-library__combat-editor">
                  <strong>战斗行动</strong>
                  <small>解锁后自动进入战斗行动栏；每个单位每轮固定行动一次。</small>
                  <label className="profession-library__field">目标<select value={selectedAbility.activation?.combatAction?.target ?? 'enemy'} disabled={!editable} onChange={event => updateCombatAction({ target: event.target.value as CombatTargetMode })}><option value="enemy">单个敌人</option><option value="self">自己</option><option value="ally">单个友方</option><option value="area">敌方群体</option><option value="none">无目标</option></select></label>
                  <label className="profession-library__field">战斗资源消耗<input type="number" min={0} value={selectedAbility.activation?.costs?.[0]?.amount ?? 0} disabled={!editable} onChange={event => updateCombatCost(Math.max(0, Number(event.target.value) || 0))} /></label>
                  <label className="profession-library__field">命中修正<input type="number" value={selectedAbility.activation?.combatAction?.accuracy ?? 10} disabled={!editable} onChange={event => updateCombatAction({ accuracy: Number(event.target.value) || 0 })} /></label>
                  <label className="profession-library__field">伤害<input type="number" min={0} value={selectedAbility.activation?.combatAction?.damage ?? 0} disabled={!editable} onChange={event => updateCombatAction({ damage: Math.max(0, Number(event.target.value) || 0) })} /></label>
                  <label className="profession-library__field">治疗<input type="number" min={0} value={selectedAbility.activation?.combatAction?.healing ?? 0} disabled={!editable} onChange={event => updateCombatAction({ healing: Math.max(0, Number(event.target.value) || 0) })} /></label>
                  <label className="profession-library__field">倍率属性<select value={selectedAbility.activation?.combatAction?.scaling?.[0]?.statId ?? 'dim1'} disabled={!editable} onChange={event => updateCombatScaling({ statId: event.target.value as CombatScalingDefinition['statId'] })}>{getCanonicalStatOptions().map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label className="profession-library__field">属性倍率（%）<input type="number" min={0} step={1} value={Math.round((selectedAbility.activation?.combatAction?.scaling?.[0]?.coefficient ?? 0.08) * 100)} disabled={!editable} onChange={event => updateCombatScaling({ coefficient: Math.max(0, Number(event.target.value) || 0) / 100 })} /></label>
                  <label className="profession-library__field">倍率作用<select value={selectedAbility.activation?.combatAction?.scaling?.[0]?.appliesTo ?? 'damage'} disabled={!editable} onChange={event => updateCombatScaling({ appliesTo: event.target.value as CombatScalingDefinition['appliesTo'] })}><option value="damage">伤害</option><option value="healing">治疗</option><option value="accuracy">命中</option></select></label>
                  <label className="profession-library__field">冷却回合<input type="number" min={0} value={selectedAbility.activation?.combatAction?.cooldownRounds ?? 0} disabled={!editable} onChange={event => updateCombatAction({ cooldownRounds: Math.max(0, Number(event.target.value) || 0) })} /></label>
                  <label className="profession-library__field">附加状态<input value={selectedAbility.activation?.combatAction?.appliesStatus?.name ?? ''} placeholder="留空表示无状态" disabled={!editable} onChange={event => updateCombatStatus({ name: event.target.value })} /></label>
                  <label className="profession-library__field">状态持续回合<input type="number" min={1} value={selectedAbility.activation?.combatAction?.appliesStatus?.durationRounds ?? 1} disabled={!editable || !selectedAbility.activation?.combatAction?.appliesStatus} onChange={event => updateCombatStatus({ durationRounds: Math.max(1, Number(event.target.value) || 1) })} /></label>
                  <label className="profession-library__field">每回合状态伤害<input type="number" min={0} value={selectedAbility.activation?.combatAction?.appliesStatus?.damagePerRound ?? 0} disabled={!editable || !selectedAbility.activation?.combatAction?.appliesStatus} onChange={event => updateCombatStatus({ damagePerRound: Math.max(0, Number(event.target.value) || 0) })} /></label>
                </div>}
                {editable && <button className="btn-ghost btn-sm" onClick={removeAbility}><Trash2 size={14} />删除节点</button>}
              </> : <>
                <label className="profession-library__field">包名<input value={activePack.manifest.name} disabled={!editable} onChange={event => updateActivePack(draft => { draft.manifest.name = event.target.value; })} /></label>
                <label className="profession-library__field">说明<textarea rows={4} value={activePack.manifest.description ?? ''} disabled={!editable} onChange={event => updateActivePack(draft => { draft.manifest.description = event.target.value; })} /></label>
                <label className="profession-library__field">创建天赋预算<input type="number" min={0} value={activePack.creationTalentBudget} disabled={!editable} onChange={event => updateActivePack(draft => { draft.creationTalentBudget = Math.max(0, Number(event.target.value) || 0); })} /></label>
                <label className="profession-library__field">开局职业能力点<input type="number" min={0} value={activePack.initialAbilityPoints ?? 0} disabled={!editable} onChange={event => updateActivePack(draft => { draft.initialAbilityPoints = Math.max(0, Number(event.target.value) || 0); })} /></label>
                <label className="profession-library__field">每次晋级能力点<input type="number" min={0} value={activePack.abilityPointsPerTier ?? 0} disabled={!editable} onChange={event => updateActivePack(draft => { draft.abilityPointsPerTier = Math.max(0, Number(event.target.value) || 0); })} /></label>
                <label className="profession-library__field"><span><input type="checkbox" checked={activePack.allowNoProfession !== false} disabled={!editable} onChange={event => updateActivePack(draft => { draft.allowNoProfession = event.target.checked; })} /> 允许创建无职业角色</span></label>
                {activeProfession && <div className="profession-library__profession-editor">
                  <strong>当前职业</strong>
                  <label className="profession-library__field">名称<input value={activeProfession.name} disabled={!editable} onChange={event => updateActivePack(draft => { const item = draft.professions.find(profession => profession.id === activeProfession.id); if (item) item.name = event.target.value; })} /></label>
                  <label className="profession-library__field">定位<input value={activeProfession.archetype ?? ''} disabled={!editable} onChange={event => updateActivePack(draft => { const item = draft.professions.find(profession => profession.id === activeProfession.id); if (item) item.archetype = event.target.value; })} /></label>
                  <label className="profession-library__field">职业徽记<select disabled={!editable} value={activeProfession.visual?.emblemKey ?? ''} onChange={event => updateActivePack(draft => { const item = draft.professions.find(profession => profession.id === activeProfession.id); if (item) item.visual = { ...(item.visual ?? {}), emblemKey: event.target.value || undefined }; })}><option value="">按职业 ID 回退</option>{PROFESSION_EMBLEM_KEYS.map(key => <option key={key} value={key}>{key}</option>)}</select></label>
                  <label className="profession-library__field">主题强调<select disabled={!editable} value={activeProfession.visual?.accentKey ?? ''} onChange={event => updateActivePack(draft => { const item = draft.professions.find(profession => profession.id === activeProfession.id); if (item) item.visual = { ...(item.visual ?? {}), accentKey: (event.target.value || undefined) as ProfessionAccentKey | undefined }; })}><option value="">按职业 ID 回退</option>{PROFESSION_ACCENT_KEYS.map(key => <option key={key} value={key}>{key}</option>)}</select></label>
                  <label className="profession-library__field">说明<textarea rows={3} value={activeProfession.description} disabled={!editable} onChange={event => updateActivePack(draft => { const item = draft.professions.find(profession => profession.id === activeProfession.id); if (item) item.description = event.target.value; })} /></label>
                  {editable && <button className="btn-ghost btn-sm" onClick={removeProfession}><Trash2 size={14} />删除职业</button>}
                </div>}
                {editable && activeProfession && <button className="btn-primary btn-sm" onClick={addAbility}><Plus size={14} />新增能力节点</button>}
                <button className="btn-ghost btn-sm" onClick={() => downloadText(`${safeName(activePack.manifest.name)}-先天天赋.json`, JSON.stringify({ type: 'omni-plane-travels-innate-talents', version: 1, data: activePack.innateTalents }, null, 2))}><Download size={14} />单独导出天赋</button>
                {editable && <><button className="btn-ghost btn-sm" onClick={() => talentImportRef.current?.click()}><Upload size={14} />单独导入天赋</button><input ref={talentImportRef} hidden type="file" accept=".json,application/json" onChange={event => void handleTalentImport(event.target.files?.[0])} /></>}
                {editable && <button className="btn-ghost btn-sm" onClick={() => {
                  if (drafts[activePack.manifest.id]) {
                    setDrafts(current => { const remaining = { ...current }; delete remaining[activePack.manifest.id]; return remaining; });
                    setMessage('已放弃当前职业包草稿');
                  } else if (deleteProfessionPack(activePack.manifest.id)) {
                    refresh();
                    setActivePackId('fantasy-core');
                  }
                }}><Trash2 size={14} />{drafts[activePack.manifest.id] ? '放弃草稿' : '删除自定义包'}</button>}
                <button className="btn-primary btn-sm" onClick={() => saveDraft()} disabled={!editable}><Save size={14} />保存</button>
              </>}
            </>}
          </aside>
        </div>
          </div>
        </DawnFrameV4>
      </section>
    </>
  );
}
