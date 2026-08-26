import React, { useEffect, useRef, useState } from 'react';
import NpcEditorModal from './NpcEditorModal';
import TemplatePickerDialog from '../shared/TemplatePickerDialog';
import { useDialog } from '../shared/Dialog';
import {
  User, Briefcase, Wand2, Loader, Save, Download, Upload, ChevronDown, BookMarked,
} from 'lucide-react';
import { savePlayerPreset, downloadJSON, exportPlayerPresetJSON } from '../../storage/templateStore';
import type { StepPersonalInfoProps, PlayerProfile, CustomNpc } from './stepPersonalInfo/types';
import { PERSPECTIVE_OPTIONS } from './stepPersonalInfo/types';
import { ProgressionInitEditor, SkillsTab, ItemsTab, NpcsTab, DropdownItem } from './stepPersonalInfo/index';
import StepAbilityAlloc from './StepAbilityAlloc';
import useCreationAllocations from './useCreationAllocations';
import {
  clampPointScale,
  computeCreationSpending,
  resolveCreationStatConfig,
} from '../../gameplay/creation/creationPoints';
import type { ProfessionModuleSchema } from '../../modules/schema';

const EMPTY_PROFESSION_CONFIG: ProfessionModuleSchema = {
  professions: [],
  innateTalents: [],
  creationTalentBudget: 0,
  allowNoProfession: true,
};

export default function StepPersonalInfo({
  personalInfo, setPersonalInfo, isFilling, fillElapsed, onAiFill, onCancelFill, hasApiConfig, worldModules,
  apiConfig, selectedWorld, allWorlds, worldEntry,
  onNext, onPrev, onModalStateChange, phase = 'identity', showNavigation = true, hasProfessionStep, difficultyContent,
}: StepPersonalInfoProps) {
  const [npcEditorOpen, setNpcEditorOpen] = useState(false);
  const [editingNpc, setEditingNpc] = useState<CustomNpc | null>(null);
  const [npcPickerOpen, setNpcPickerOpen] = useState(false);
  const [playerPickerOpen, setPlayerPickerOpen] = useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDivElement>(null);
  const isIdentityPhase = phase === 'identity';
  const hasProfessionModule = hasProfessionStep
    ?? Boolean(worldModules?.some(module => module.moduleId === 'profession' && module.enabled));
  const statModule = worldModules?.find(module => module.moduleId === 'stat' && module.enabled);
  const progressionModule = worldModules?.find(module => module.moduleId === 'progression' && module.enabled);
  const statConfig = statModule
    ? resolveCreationStatConfig(statModule.moduleConfig, statModule.initialState)
    : undefined;
  const pointScale = clampPointScale((statModule?.moduleConfig as Record<string, unknown> | undefined)?.pointScale);
  const loadoutSpending = computeCreationSpending(EMPTY_PROFESSION_CONFIG, {
    riskMode: personalInfo.combatRiskMode ?? 'normal',
    pointScale,
    talentIds: [],
    drawnTalentIds: [],
    drawCount: 0,
    allocations: personalInfo.creationPointAllocations ?? {},
  });
  const { allocations, applyAllocations } = useCreationAllocations({ personalInfo, setPersonalInfo, statConfig });
  const hasLoadoutContent = Object.keys(personalInfo.moduleInitData ?? {}).length > 0
    || Object.keys(personalInfo.creationPointAllocations ?? {}).length > 0
    || (!hasProfessionModule && Object.keys(personalInfo.initialSkills ?? {}).length > 0)
    || Object.keys(personalInfo.initialItems ?? {}).length > 0
    || personalInfo.customNpcs.length > 0;

  useEffect(() => {
    if (!presetMenuOpen) return undefined;
    const handler = (event: MouseEvent) => {
      if (presetMenuRef.current && !presetMenuRef.current.contains(event.target as Node)) setPresetMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [presetMenuOpen]);

  const { DialogUI, prompt: dlgPrompt, alert: dlgAlert, isOpen: dialogOpen } = useDialog();

  useEffect(() => {
    onModalStateChange?.(npcEditorOpen || npcPickerOpen || playerPickerOpen || dialogOpen);
    return () => onModalStateChange?.(false);
  }, [dialogOpen, npcEditorOpen, npcPickerOpen, onModalStateChange, playerPickerOpen]);
  const set = <K extends keyof PlayerProfile>(key: K, value: PlayerProfile[K]) =>
    setPersonalInfo({ ...personalInfo, [key]: value });

  const handleSavePreset = async () => {
    const name = await dlgPrompt('请输入预设名称：', { defaultValue: personalInfo.name || '我的预设', title: '保存预设' });
    if (!name?.trim()) return;
    savePlayerPreset(name.trim(), personalInfo);
    await dlgAlert(`预设「${name.trim()}」已保存`);
  };

  const handleExportPreset = async () => {
    const name = await dlgPrompt('请输入导出文件名：', { defaultValue: personalInfo.name || 'my-preset', title: '导出预设' });
    if (!name?.trim()) return;
    const preset = savePlayerPreset(name.trim(), personalInfo);
    downloadJSON(exportPlayerPresetJSON(preset), `player-preset-${name.trim()}.json`);
  };

  const handleSaveNpc = (npc: CustomNpc) => {
    const index = personalInfo.customNpcs.findIndex(item => item.id === npc.id);
    const next = [...personalInfo.customNpcs];
    if (index >= 0) next[index] = npc; else next.push(npc);
    set('customNpcs', next);
    setNpcEditorOpen(false);
    setEditingNpc(null);
  };

  const renderPresetActions = () => (
    <div className="ritual-inline-actions">
      <div ref={presetMenuRef} className="ritual-preset-menu">
        <button type="button" className="pi-ai-btn" onClick={() => setPresetMenuOpen(open => !open)} aria-expanded={presetMenuOpen}>
          <BookMarked size={12} /> 预设 <ChevronDown size={10} />
        </button>
        {presetMenuOpen && (
          <div className="ritual-preset-menu__popup">
            <DropdownItem icon={<Download size={13} />} label="导入预设" onClick={() => { setPresetMenuOpen(false); setPlayerPickerOpen(true); }} />
            <DropdownItem icon={<Save size={13} />} label="保存预设" disabled={!personalInfo.name.trim()} onClick={() => { setPresetMenuOpen(false); handleSavePreset(); }} />
            <DropdownItem icon={<Upload size={13} />} label="导出 JSON" disabled={!personalInfo.name.trim()} onClick={() => { setPresetMenuOpen(false); handleExportPreset(); }} />
          </div>
        )}
      </div>
      {hasApiConfig && (
        <button type="button" className="pi-ai-btn" onClick={isFilling ? onCancelFill : onAiFill} disabled={!personalInfo.name.trim()}>
          {isFilling ? <><Loader size={12} className="animate-spin" /> 生成中{fillElapsed > 0 ? ` ${fillElapsed}s` : ''} · 停止</> : <><Wand2 size={12} /> AI 补全</>}
        </button>
      )}
    </div>
  );

  const renderIdentity = () => (
    <div className="ritual-identity-sections">
      <section className="ritual-form-section">
        <div className="ritual-form-section__heading"><span>基本信息</span><small>先确定旅者是谁</small></div>
        <div className="ritual-field-grid ritual-field-grid--name">
          <label className="form-group"><span>姓名 *</span><input type="text" value={personalInfo.name} onChange={event => set('name', event.target.value)} placeholder="输入旅者姓名" /></label>
          <label className="form-group"><span>年龄</span><input type="text" value={personalInfo.age} onChange={event => set('age', event.target.value)} placeholder="18" /></label>
        </div>
        <div className="form-group"><span>性别</span>
          <div className="gender-radio-group">
            {['男', '女', '其他'].map(gender => (
              <button type="button" key={gender} className={`gender-radio${personalInfo.gender === gender ? ' selected' : ''}`} onClick={() => set('gender', gender)} aria-pressed={personalInfo.gender === gender}>{gender}</button>
            ))}
          </div>
        </div>
      </section>
      <section className="ritual-form-section">
        <div className="ritual-form-section__heading"><span>形象与来历</span><small>让镜中的人拥有轮廓</small></div>
        <label className="form-group"><span>性格</span><textarea value={personalInfo.personality} onChange={event => set('personality', event.target.value)} placeholder="温柔、沉静、好奇……" rows={2} /></label>
        <label className="form-group"><span>外貌</span><textarea value={personalInfo.appearance} onChange={event => set('appearance', event.target.value)} placeholder="发色、神态、身形等" rows={2} /></label>
        <label className="form-group"><span>背景描述</span><textarea value={personalInfo.background} onChange={event => set('background', event.target.value)} placeholder="简述旅者的来历、动机或重要经历" rows={3} /></label>
      </section>
    </div>
  );

  const renderLoadout = () => (
    <div className={`ritual-loadout-box${hasLoadoutContent ? ' has-content' : ' is-empty'}`}>
      <div className="ritual-loadout-heading">
        <div><span className="ritual-section-kicker">行囊卷 · 世界法则下的个人负载</span><strong>行囊与同行者</strong></div>
        <small>{hasLoadoutContent ? '已配置内容可继续编辑' : '当前世界没有额外行囊限制'}</small>
      </div>
      <div className="ritual-loadout-intro">沿用当前世界已启用的模块；没有模块的分组会保持轻量，不制造空白数据。</div>
      {!hasProfessionModule && statConfig && (
        <div className="ritual-loadout-alloc">
          <StepAbilityAlloc
            statConfig={statConfig}
            allocations={allocations}
            poolRemaining={loadoutSpending.remaining}
            onChange={applyAllocations}
          />
        </div>
      )}
      <div className="ritual-loadout-groups">
        {progressionModule && (
          <details className="ritual-loadout-group" open>
            <summary><span>初始段位</span><small>第 {Number(((personalInfo.moduleInitData?.['成长体系'] ?? {}) as Record<string, unknown>).currentTierIndex ?? 0) + 1} 阶</small></summary>
            <div className="ritual-loadout-group__body"><ProgressionInitEditor worldModules={worldModules} personalInfo={personalInfo} setPersonalInfo={setPersonalInfo} /></div>
          </details>
        )}
        {hasProfessionModule ? (
          <div className="ritual-loadout-intro">职业、先天天赋与职业能力已在上一卷确定；自由技能只会在旅途中学习，不在这里再选一次。</div>
        ) : (
          <details className="ritual-loadout-group"><summary><span>初始自由技能</span><small>{Object.keys(personalInfo.initialSkills ?? {}).length} 项</small></summary><div className="ritual-loadout-group__body"><SkillsTab personalInfo={personalInfo} set={set} /></div></details>
        )}
        <details className="ritual-loadout-group"><summary><span>行囊与物品</span><small>{Object.keys(personalInfo.initialItems ?? {}).length} 项</small></summary><div className="ritual-loadout-group__body"><ItemsTab personalInfo={personalInfo} set={set} /></div></details>
        <details className="ritual-loadout-group"><summary><span>预设人物与 NPC</span><small>{personalInfo.customNpcs.length} 项</small></summary><div className="ritual-loadout-group__body"><NpcsTab personalInfo={personalInfo} set={set} onEditNpc={npc => { setEditingNpc(npc); setNpcEditorOpen(true); }} onOpenPicker={() => setNpcPickerOpen(true)} /></div></details>
      </div>
    </div>
  );

  return (
    <div className={`personal-info-layout ritual-personal-info ritual-personal-info--${phase}`}>
      {isIdentityPhase ? (
        <>
          <div className="personal-info-box ritual-identity-fields">
            <div className="pi-box-header"><User size={16} /><span>身份卷 · 基本信息</span>{renderPresetActions()}</div>
            <div className="pi-box-body">{renderIdentity()}</div>
          </div>
          <div className="personal-info-box personal-info-identity-box">
            <div className="pi-box-header"><Briefcase size={16} /><span>身份与叙事</span></div>
            <div className="pi-box-body">
              <div className="ritual-form-section__heading"><span>{hasProfessionModule ? '道路与叙事视角' : '职业与叙事视角'}</span><small>决定旅者如何被书写</small></div>
              {hasProfessionModule ? (
                <div className="ritual-identity-note">当前世界启用了职业典藏，职业将在下一步从完整职业树中选择，不能在这里用自由文本绕过规则。</div>
              ) : (
                <label className="form-group"><span>职业</span><input type="text" value={personalInfo.career} onChange={event => set('career', event.target.value)} placeholder="学生、佣兵、学者……" /></label>
              )}
              <div className="form-group"><span>叙事视角</span><div className="gender-radio-group ritual-perspective-options">{PERSPECTIVE_OPTIONS.map(option => <button type="button" key={option.value} className={`gender-radio${personalInfo.perspective === option.value ? ' selected' : ''}`} onClick={() => set('perspective', option.value)} aria-pressed={personalInfo.perspective === option.value}><strong>{option.label}</strong><small>{option.desc}</small></button>)}</div></div>
              {difficultyContent}
              <div className="ritual-identity-note">填写姓名、性别与年龄后即可继续。</div>
            </div>
          </div>
        </>
      ) : renderLoadout()}

      {showNavigation && (
        <div className="personal-info-nav">
          <button type="button" className="btn-secondary" onClick={onPrev}>← 上一步</button>
          <button type="button" className="btn-primary" onClick={onNext} disabled={!personalInfo.name.trim() || !personalInfo.gender || !personalInfo.age.trim()} title={!personalInfo.name.trim() || !personalInfo.gender || !personalInfo.age.trim() ? '请填写姓名、性别和年龄' : undefined}>下一步 →</button>
        </div>
      )}

      {npcEditorOpen && <NpcEditorModal initial={editingNpc} onSave={handleSaveNpc} onCancel={() => { setNpcEditorOpen(false); setEditingNpc(null); }} apiConfig={apiConfig} playerName={personalInfo.name} playerGender={personalInfo.gender} playerAge={personalInfo.age} playerBackground={personalInfo.background} selectedWorld={selectedWorld} allWorlds={allWorlds} worldEntry={worldEntry} worldModules={worldModules} />}
      {npcPickerOpen && <TemplatePickerDialog mode="npc" onClose={() => setNpcPickerOpen(false)} onBlank={() => { setEditingNpc(null); setNpcEditorOpen(true); }} onImportTemplate={npc => { setEditingNpc(npc); setNpcEditorOpen(true); }} />}
      {playerPickerOpen && <TemplatePickerDialog mode="player" currentProfile={personalInfo} onClose={() => setPlayerPickerOpen(false)} onApplyPreset={profile => setPersonalInfo(profile)} />}
      {DialogUI}
    </div>
  );
}
