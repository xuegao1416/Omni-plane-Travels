import type { FormState } from './types';
import { ALL_WORLD_ICONS } from '@/components/shared/worldIcons';
import ModuleSelector from '../ModuleSelector';
import { StatModuleEditor } from '../moduleEditors/StatModuleEditor';
import { ProgressionModuleEditor } from '../moduleEditors/ProgressionModuleEditor';
import { SurvivalModuleEditor } from '../moduleEditors/SurvivalModuleEditor';
import { BusinessModuleEditor } from '../moduleEditors/BusinessModuleEditor';
import { TalentModuleEditor } from '../moduleEditors/TalentModuleEditor';
import {
  X, ScrollText, Swords, DollarSign, Flag, User, Sparkles, BarChart3, Map, BookMarked, Loader,
} from 'lucide-react';

interface ManualEditFormProps {
  form: FormState;
  update: (patch: Partial<FormState>) => void;
  selectedModules: Set<string>;
  onToggleModule: (id: string) => void;
  disabledByConflict: Set<string>;
  updateModuleData: (idx: number, data: Record<string, unknown>) => void;
  onTalentAiGenerate: (catIdx: number, count: number) => void;
  isGeneratingTalent: boolean;
  onModuleAiFill: (moduleId: string) => void;
  generatingModule: string | null;
  addFaction: () => void;
  removeFaction: (i: number) => void;
  updateFaction: (i: number, patch: Partial<FormState['factions'][0]>) => void;
  addNPC: () => void;
  removeNPC: (i: number) => void;
  updateNPC: (i: number, patch: Partial<FormState['presetNPCs'][0]>) => void;
  addLocation: () => void;
  removeLocation: (i: number) => void;
  updateLocation: (i: number, patch: Partial<FormState['locations'][0]>) => void;
}

export function ManualEditForm({
  form, update, selectedModules, onToggleModule, disabledByConflict,
  updateModuleData, onTalentAiGenerate, isGeneratingTalent, onModuleAiFill, generatingModule,
  addFaction, removeFaction, updateFaction, addNPC, removeNPC, updateNPC, addLocation, removeLocation, updateLocation,
}: ManualEditFormProps) {
  return (
    <>
      {/* 基本信息 */}
      <div className="world-form-section"><h4><BarChart3 size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 基本信息</h4>
        <div className="world-form-group"><label>世界名称 *</label><input type="text" value={form.name} onChange={e => update({ name: e.target.value })} placeholder="给你的世界起个名字..." /></div>
        <div className="world-form-group"><label>简介</label><textarea value={form.description} onChange={e => update({ description: e.target.value })} placeholder="一句话描述这个世界（展示在卡片上）" rows={2} /></div>
        <div className="world-form-row">
          <div className="world-form-group"><label>图标</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, maxHeight: 120, overflowY: 'auto' }}>
              {ALL_WORLD_ICONS.map(({ name, icon: Icon }) => (
                <button key={name} type="button" onClick={() => update({ icon: name })} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: form.icon === name ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 4, background: form.icon === name ? 'var(--accent-dim)' : 'transparent', color: form.icon === name ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer' }} title={name}><Icon size={16} /></button>
              ))}
            </div>
          </div>
          <div className="world-form-group"><label>主题色</label><input type="color" value={form.coverColor} onChange={e => update({ coverColor: e.target.value })} /></div>
          <div className="world-form-group"><label>难度</label><select value={form.difficulty} onChange={e => update({ difficulty: e.target.value })} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px', color: 'var(--text-primary)' }}><option value="easy">● 简单</option><option value="medium">● 中等</option><option value="hard">● 困难</option></select></div>
        </div>
        <div className="world-form-group"><label>标签 (逗号分隔)</label><input type="text" value={form.tags} onChange={e => update({ tags: e.target.value })} placeholder="科幻, 冒险, 开放世界" /></div>
      </div>

      {/* 世界设定 */}
      <div className="world-form-section"><h4><ScrollText size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 世界设定</h4>
        <div className="world-form-group"><label>世界观概述</label><textarea value={form.overview} onChange={e => update({ overview: e.target.value })} placeholder="2-3段沉浸式世界观描述..." rows={5} /></div>
        <div className="world-form-row three">
          <div className="world-form-group"><label>时间背景</label><input type="text" value={form.timePeriod} onChange={e => update({ timePeriod: e.target.value })} placeholder="1990年春" /></div>
          <div className="world-form-group"><label>地理位置</label><input type="text" value={form.location} onChange={e => update({ location: e.target.value })} placeholder="东北工业城市" /></div>
          <div className="world-form-group"><label>氛围</label><input type="text" value={form.atmosphere} onChange={e => update({ atmosphere: e.target.value })} placeholder="温暖怀旧" /></div>
        </div>
      </div>

      {/* 地理区域 */}
      <div className="world-form-section"><h4><Map size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 地理区域</h4>
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 8 }}>定义世界中的关键区域/地点（对应世界书的 lore 条目）</p>
        <div className="world-dynamic-list">
          {form.locations.map((loc, i) => (
            <div key={i} className="world-dynamic-item">
              <button className="remove-btn" onClick={() => removeLocation(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
              <div className="world-form-row" style={{ marginBottom: 0 }}>
                <div className="world-form-group" style={{ marginBottom: 0 }}><label>区域名称</label><input type="text" value={loc.name} onChange={e => updateLocation(i, { name: e.target.value })} placeholder="东域·天剑城" /></div>
                <div className="world-form-group" style={{ marginBottom: 0 }}><label>描述</label><input type="text" value={loc.description} onChange={e => updateLocation(i, { description: e.target.value })} placeholder="灵气充沛的修仙重地..." /></div>
              </div>
            </div>
          ))}
        </div>
        <button className="btn-ghost" onClick={addLocation} style={{ marginTop: 8, fontSize: 'var(--font-size-base)' }}>+ 添加区域</button>
      </div>

      {/* 文化风俗 */}
      <div className="world-form-section"><h4><BookMarked size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 文化风俗</h4>
        <div className="world-form-group"><label>文化描述</label><textarea value={form.culture} onChange={e => update({ culture: e.target.value })} placeholder="描述这个世界的信仰、习俗、禁忌、语言特色..." rows={3} /></div>
      </div>

      {/* 世界规则 */}
      <div className="world-form-section"><h4><Swords size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 世界规则</h4>
        <div className="world-form-row">
          <div className="world-form-group"><label>力量体系</label><textarea value={form.powerSystem} onChange={e => update({ powerSystem: e.target.value })} placeholder="魔法/科技/武道..." rows={2} /></div>
          <div className="world-form-group"><label>社会结构</label><textarea value={form.socialStructure} onChange={e => update({ socialStructure: e.target.value })} placeholder="封建王国/星际联邦..." rows={2} /></div>
        </div>
        <div className="world-form-group"><label>特殊规则 (每行一条)</label><textarea value={form.specialRules} onChange={e => update({ specialRules: e.target.value })} placeholder="角色可能死亡&#10;无魔法系统" rows={2} /></div>
      </div>

      {/* 经济 & 时间 */}
      <div className="world-form-section"><h4><DollarSign size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 经济 & 时间</h4>
        <div className="world-form-row three">
          <div className="world-form-group"><label>货币名称</label><input type="text" value={form.currencyName} onChange={e => update({ currencyName: e.target.value })} placeholder="人民币" /></div>
          <div className="world-form-group"><label>货币符号</label><input type="text" value={form.currencySymbol} onChange={e => update({ currencySymbol: e.target.value })} placeholder="¥" /></div>
          <div className="world-form-group"><label>物价水平</label><input type="text" value={form.priceLevel} onChange={e => update({ priceLevel: e.target.value })} placeholder="1990年物价" /></div>
        </div>
        <div className="world-form-group"><label>货币说明</label><input type="text" value={form.currencyDesc} onChange={e => update({ currencyDesc: e.target.value })} placeholder="简要说明" /></div>
        <div className="world-form-row three">
          <div className="world-form-group"><label>纪年方式</label><input type="text" value={form.calendar} onChange={e => update({ calendar: e.target.value })} placeholder="公历" /></div>
          <div className="world-form-group"><label>开始时间</label><input type="text" value={form.startTime} onChange={e => update({ startTime: e.target.value })} placeholder="1990年3月15日" /></div>
          <div className="world-form-group"><label>时间流速</label><input type="text" value={form.timeSpeed} onChange={e => update({ timeSpeed: e.target.value })} placeholder="与现实同步" /></div>
        </div>
      </div>

      {/* 势力 */}
      <div className="world-form-section"><h4><Flag size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 势力</h4>
        <div className="world-dynamic-list">
          {form.factions.map((f, i) => (
            <div key={i} className="world-dynamic-item">
              <button className="remove-btn" onClick={() => removeFaction(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
              <div className="world-form-row three" style={{ marginBottom: 0 }}>
                <div className="world-form-group" style={{ marginBottom: 0 }}><label>名称</label><input type="text" value={f.name} onChange={e => updateFaction(i, { name: e.target.value })} placeholder="势力名称" /></div>
                <div className="world-form-group" style={{ marginBottom: 0 }}><label>立场</label><select value={f.alignment} onChange={e => updateFaction(i, { alignment: e.target.value })} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px', color: 'var(--text-primary)' }}><option value="友善">友善</option><option value="中立">中立</option><option value="敌对">敌对</option></select></div>
                <div className="world-form-group" style={{ marginBottom: 0 }}><label>描述</label><input type="text" value={f.description} onChange={e => updateFaction(i, { description: e.target.value })} placeholder="简要描述" /></div>
              </div>
            </div>
          ))}
        </div>
        <button className="btn-ghost" onClick={addFaction} style={{ marginTop: 8, fontSize: 'var(--font-size-base)' }}>+ 添加势力</button>
      </div>

      {/* 预设NPC */}
      <div className="world-form-section"><h4><User size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 预设NPC</h4>
        <div className="world-dynamic-list">
          {form.presetNPCs.map((n, i) => (
            <div key={i} className="world-dynamic-item">
              <button className="remove-btn" onClick={() => removeNPC(i)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
              <div className="world-form-row" style={{ marginBottom: 0 }}>
                <div className="world-form-group" style={{ marginBottom: 0 }}><label>姓名</label><input type="text" value={n.name} onChange={e => updateNPC(i, { name: e.target.value })} placeholder="NPC姓名" /></div>
                <div className="world-form-group" style={{ marginBottom: 0 }}><label>角色定位</label><input type="text" value={n.role} onChange={e => updateNPC(i, { role: e.target.value })} placeholder="邻居大婶" /></div>
              </div>
              <div className="world-form-row" style={{ marginBottom: 0, marginTop: 6 }}>
                <div className="world-form-group" style={{ marginBottom: 0 }}><label>简介</label><input type="text" value={n.description} onChange={e => updateNPC(i, { description: e.target.value })} placeholder="1-2句简介" /></div>
                <div className="world-form-group" style={{ marginBottom: 0 }}><label>性格</label><input type="text" value={n.personality} onChange={e => updateNPC(i, { personality: e.target.value })} placeholder="热心肠、爱八卦" /></div>
              </div>
            </div>
          ))}
        </div>
        <button className="btn-ghost" onClick={addNPC} style={{ marginTop: 8, fontSize: 'var(--font-size-base)' }}>+ 添加NPC</button>
      </div>

      {/* 核心特色 */}
      <div className="world-form-section"><h4><Sparkles size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 核心特色</h4>
        <div className="world-form-group"><label>特色 (逗号分隔)</label><input type="text" value={form.highlights} onChange={e => update({ highlights: e.target.value })} placeholder="日常生活, 温情互动, 怀旧氛围" /></div>
      </div>

      {/* 系统模块 */}
      <div className="world-form-section"><h4><BarChart3 size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 系统模块</h4>
        <ModuleSelector selected={selectedModules} onToggle={onToggleModule} disabledByConflict={disabledByConflict} />
      </div>

      {/* 模块数据编辑 */}
      {form.modules && form.modules.length > 0 && (
        <div className="world-form-section"><h4><BarChart3 size={15} style={{ marginRight: 4, flexShrink: 0 }} /> 模块数据</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: 10 }}>编辑各模块的初始数据（AI已生成，可手动调整）</p>
          {form.modules.map((mod, modIdx) => {
            if (!mod.enabled) return null;
            const modData = mod.moduleConfig;
            return (
              <div key={mod.moduleId} style={{ marginBottom: 16, padding: '10px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 8, color: 'var(--accent)' }}>{mod.name} ({mod.moduleId})</div>
                {mod.moduleId === 'stat' && modData && <StatModuleEditor data={modData as any} onChange={(d) => updateModuleData(modIdx, d as unknown as Record<string, unknown>)} />}
                {mod.moduleId === 'progression' && modData && <ProgressionModuleEditor data={modData as any} onChange={(d) => updateModuleData(modIdx, d as unknown as Record<string, unknown>)} />}
                {mod.moduleId === 'survival' && modData && <SurvivalModuleEditor data={modData as any} onChange={(d) => updateModuleData(modIdx, d)} />}
                {mod.moduleId === 'business' && modData && <BusinessModuleEditor data={modData as any} onChange={(d) => updateModuleData(modIdx, d)} />}
                {mod.moduleId === 'dice' && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>骰子检定无需初始数据，运行时自动计算</div>}
                {mod.moduleId === 'talent' && <TalentModuleEditor data={(modData as any) || { categories: [] }} onChange={(d) => updateModuleData(modIdx, d)} onAiGenerate={onTalentAiGenerate} isGenerating={isGeneratingTalent} />}
                {!modData && mod.moduleId !== 'dice' && mod.moduleId !== 'talent' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>暂无数据</span>
                    <button className="btn-ghost" onClick={() => onModuleAiFill(mod.moduleId)} disabled={generatingModule === mod.moduleId} style={{ fontSize: 'var(--font-size-xs)', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {generatingModule === mod.moduleId ? <><Loader size={11} className="animate-spin" /> 生成中</> : <><Sparkles size={11} /> AI 补全</>}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
