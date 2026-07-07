import React, { useState, useRef, useEffect } from 'react';
import NpcEditorModal from './NpcEditorModal';
import TemplatePickerDialog from '../shared/TemplatePickerDialog';
import { useDialog } from '../shared/Dialog';
import {
  User, Wand2, Loader, Save, Download, Upload, ChevronDown, BookMarked,
} from 'lucide-react';
import { savePlayerPreset, downloadJSON, exportPlayerPresetJSON } from '../../storage/templateStore';
import type { StepPersonalInfoProps, RightTab, PlayerProfile, CustomNpc } from './stepPersonalInfo/types';
import { PERSPECTIVE_OPTIONS, RIGHT_TABS } from './stepPersonalInfo/types';
import { IdentityTab, StatsTab, SkillsTab, ItemsTab, NpcsTab, DropdownItem } from './stepPersonalInfo/index';

export default function StepPersonalInfo({
  personalInfo, setPersonalInfo, isFilling, fillElapsed, onAiFill, onCancelFill, hasApiConfig, worldModules,
  apiConfig, selectedWorld, allWorlds, worldEntry,
  onNext, onPrev,
}: StepPersonalInfoProps) {
  const [rightTab, setRightTab] = useState<RightTab>('identity');
  const [npcEditorOpen, setNpcEditorOpen] = useState(false);
  const [editingNpc, setEditingNpc] = useState<CustomNpc | null>(null);
  const [npcPickerOpen, setNpcPickerOpen] = useState(false);
  const [playerPickerOpen, setPlayerPickerOpen] = useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!presetMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setPresetMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [presetMenuOpen]);
  const { DialogUI, prompt: dlgPrompt, alert: dlgAlert } = useDialog();

  const handleSavePreset = async () => {
    const name = await dlgPrompt('请输入预设名称：', { defaultValue: personalInfo.name || '我的预设', title: '保存预设' });
    if (!name?.trim()) return;
    savePlayerPreset(name.trim(), personalInfo);
    await dlgAlert(`预设「${name.trim()}」已保存 ✓`);
  };
  const handleExportPreset = async () => {
    const name = await dlgPrompt('请输入导出文件名：', { defaultValue: personalInfo.name || 'my-preset', title: '导出预设' });
    if (!name?.trim()) return;
    const preset = savePlayerPreset(name.trim(), personalInfo);
    const json = exportPlayerPresetJSON(preset);
    downloadJSON(json, `player-preset-${name.trim()}.json`);
  };
  const handleSaveNpc = (npc: CustomNpc) => {
    const idx = personalInfo.customNpcs.findIndex(n => n.id === npc.id);
    const next = [...personalInfo.customNpcs];
    if (idx >= 0) next[idx] = npc; else next.push(npc);
    set('customNpcs', next);
    setNpcEditorOpen(false); setEditingNpc(null);
  };
  const set = <K extends keyof PlayerProfile>(key: K, val: PlayerProfile[K]) =>
    setPersonalInfo({ ...personalInfo, [key]: val });

  return (
    <div className="personal-info-layout">
      {/* ── 左栏：基本信息 ── */}
      <div className="personal-info-box">
        <div className="pi-box-header">
          <User size={16} /><span>基本信息</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <div ref={presetMenuRef} style={{ position: 'relative' }}>
              <button className="pi-ai-btn" onClick={() => setPresetMenuOpen(!presetMenuOpen)} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <BookMarked size={12} /> 预设 <ChevronDown size={10} style={{ transform: presetMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              </button>
              {presetMenuOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', minWidth: '140px', zIndex: 200, overflow: 'hidden' }}>
                  <DropdownItem icon={<Download size={13} />} label="导入预设" onClick={() => { setPresetMenuOpen(false); setPlayerPickerOpen(true); }} />
                  <DropdownItem icon={<Save size={13} />} label="保存预设" disabled={!personalInfo.name.trim()} onClick={() => { setPresetMenuOpen(false); handleSavePreset(); }} />
                  <DropdownItem icon={<Upload size={13} />} label="导出 JSON" disabled={!personalInfo.name.trim()} onClick={() => { setPresetMenuOpen(false); handleExportPreset(); }} />
                </div>
              )}
            </div>
            {hasApiConfig && (
              <button className="pi-ai-btn" onClick={onAiFill} disabled={isFilling || !personalInfo.name.trim()} title="AI 补全所有信息">
                {isFilling ? <><Loader size={12} className="animate-spin" /> 生成中{fillElapsed > 0 ? ` ${fillElapsed}s` : ''}</> : <><Wand2 size={12} /> AI 补全</>}
              </button>
            )}
          </div>
        </div>
        <div className="pi-box-body">
          <div className="form-group"><label>姓名 *</label><input type="text" value={personalInfo.name} onChange={e => set('name', e.target.value)} placeholder="输入角色姓名..." /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '0.75rem' }}>
            <div className="form-group"><label>年龄</label><input type="text" value={personalInfo.age} onChange={e => set('age', e.target.value)} placeholder="18" /></div>
            <div className="form-group"><label>性别</label>
              <div className="gender-radio-group">
                {['男', '女', '其他'].map(g => (
                  <div key={g} className={`gender-radio${personalInfo.gender === g ? ' selected' : ''}`} onClick={() => set('gender', g)}>{g === '男' ? '♂' : g === '女' ? '♀' : '⚧'} {g}</div>
                ))}
              </div>
            </div>
          </div>
          <div className="form-group"><label>性格</label><textarea value={personalInfo.personality} onChange={e => set('personality', e.target.value)} placeholder="如：温柔善良、外冷内热、沉默寡言..." rows={2} /></div>
          <div className="form-group"><label>外貌</label><textarea value={personalInfo.appearance} onChange={e => set('appearance', e.target.value)} placeholder="如：黑发碧眼、身材高挑、左脸有一道疤痕..." rows={2} /></div>
          <div className="form-group"><label>背景描述</label><textarea value={personalInfo.background} onChange={e => set('background', e.target.value)} placeholder="简单描述你的角色特长、来历、动机等..." rows={5} /></div>
          <div className="form-group"><label>叙事视角</label>
            <div className="gender-radio-group">
              {PERSPECTIVE_OPTIONS.map(opt => (
                <div key={opt.value} className={`gender-radio${personalInfo.perspective === opt.value ? ' selected' : ''}`} onClick={() => set('perspective', opt.value)}>
                  <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)' }}>{opt.label}</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7, marginTop: '2px' }}>{opt.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 右栏：Tab 切换 ── */}
      <div className="personal-info-box">
        <div className="pi-box-header" style={{ padding: 0, background: 'transparent', borderBottom: 'none' }}>
          <div className="pi-right-tabs">
            {RIGHT_TABS.map(tab => (
              <button key={tab.key} className={`pi-right-tab${rightTab === tab.key ? ' active' : ''}`} onClick={() => setRightTab(tab.key)}>{tab.icon}<span>{tab.label}</span></button>
            ))}
          </div>
        </div>
        <div className="pi-box-body">
          {rightTab === 'identity' && <IdentityTab personalInfo={personalInfo} set={set} />}
          {rightTab === 'stats' && <StatsTab worldModules={worldModules} personalInfo={personalInfo} setPersonalInfo={setPersonalInfo} />}
          {rightTab === 'skills' && <SkillsTab personalInfo={personalInfo} set={set} />}
          {rightTab === 'items' && <ItemsTab personalInfo={personalInfo} set={set} />}
          {rightTab === 'npcs' && <NpcsTab personalInfo={personalInfo} set={set} onEditNpc={(npc: CustomNpc) => { setEditingNpc(npc); setNpcEditorOpen(true); }} onOpenPicker={() => setNpcPickerOpen(true)} />}
        </div>
      </div>

      {/* 导航按钮 */}
      <div className="personal-info-nav">
        <button className="btn-secondary" onClick={onPrev} style={{ padding: '10px 24px' }}>← 上一步</button>
        <button className="btn-primary" onClick={onNext} style={{ padding: '10px 32px', fontSize: 'var(--font-size-lg)' }}
          disabled={!personalInfo.name.trim() || !personalInfo.gender || !personalInfo.age.trim()}
          title={!personalInfo.name.trim() || !personalInfo.gender || !personalInfo.age.trim() ? '请填写姓名、性别和年龄' : ''}>下一步 →</button>
      </div>

      {npcEditorOpen && (
        <NpcEditorModal initial={editingNpc} onSave={handleSaveNpc} onCancel={() => { setNpcEditorOpen(false); setEditingNpc(null); }}
          apiConfig={apiConfig} playerName={personalInfo.name} playerGender={personalInfo.gender} playerAge={personalInfo.age} playerBackground={personalInfo.background}
          selectedWorld={selectedWorld} allWorlds={allWorlds} worldEntry={worldEntry} worldModules={worldModules} />
      )}
      {npcPickerOpen && <TemplatePickerDialog mode="npc" onClose={() => setNpcPickerOpen(false)} onBlank={() => { setEditingNpc(null); setNpcEditorOpen(true); }} onImportTemplate={(npc) => { setEditingNpc(npc); setNpcEditorOpen(true); }} />}
      {playerPickerOpen && <TemplatePickerDialog mode="player" currentProfile={personalInfo} onClose={() => setPlayerPickerOpen(false)} onApplyPreset={(profile) => setPersonalInfo(profile)} />}
      {DialogUI}
    </div>
  );
}
