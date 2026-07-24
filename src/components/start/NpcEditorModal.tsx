import { useState } from 'react';
import type { CustomNpc } from '../../storage/db';
import type { ApiConfig } from '../../api/types';
import type { WorldDef } from '../../data/worldLoader';
import type { WorldBookEntry } from '../../worldbook/index';
import type { WorldModule } from '../../data/worlds-schema';
import { X, Wand2, Loader, Download, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { useConfigStore } from '../../stores/configStore';
import { useNpcFill } from '../../hooks/useNpcFill';
import { exportNpcTemplateJSON, downloadJSON } from '../../storage/templateStore';

const QUALITY_OPTIONS = ['普通', '精良', '稀有', '史诗', '传说'] as const;

interface Props {
  initial?: CustomNpc | null;
  onSave: (npc: CustomNpc) => void;
  onCancel: () => void;
  apiConfig?: ApiConfig | null;
  playerName?: string;
  playerGender?: string;
  playerAge?: string;
  playerBackground?: string;
  selectedWorld?: string;
  allWorlds?: WorldDef[];
  worldEntry?: WorldBookEntry | null;
  worldModules?: WorldModule[];
}

const emptyNpc = (): CustomNpc => ({
  id: uuid(),
  name: '', gender: '', age: '', race: '', relationshipType: '',
  occupation: '', socialStatus: '',
  personality: '', hiddenPersonality: '', currentThought: '',
  appearance: '', currentOutfit: '',
  currentAction: '', currentLocation: '', currentState: '',
  shortTermGoal: '', longTermGoal: '',
  background: '',
  chronicles: [],
  skillsList: {},
  itemsList: {},
});

/** 分组标题 */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--accent)',
      padding: '6px 0 2px', borderBottom: '1px solid var(--border)', marginTop: 'var(--space-1)',
    }}>
      {children}
    </div>
  );
}

/** 可折叠分组 */
function CollapsibleSection({ title, count, expanded, onToggle, children }: {
  title: string; count: number; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="form-group">
      <label onClick={onToggle} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {count > 0 && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{count}</span>}
          <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', color: 'var(--text-muted)' }} />
        </span>
      </label>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function NpcEditorModal({
  initial, onSave, onCancel,
  apiConfig, playerName, playerGender, playerAge, playerBackground,
  selectedWorld, allWorlds, worldEntry, worldModules,
}: Props) {
  const t = useConfigStore(s => s.t);
  const [npc, setNpc] = useState<CustomNpc>(() => initial || emptyNpc());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // 模块检测
  const statMod = worldModules?.find(m => m.moduleId === 'stat' && m.enabled);
  const progMod = worldModules?.find(m => m.moduleId === 'progression' && m.enabled);
  const statConfig = statMod?.moduleConfig as any;
  const progConfig = progMod?.moduleConfig as any;

  const set = <K extends keyof CustomNpc>(key: K, val: CustomNpc[K]) =>
    setNpc(prev => ({ ...prev, [key]: val }));

  // 技能/物品 Map 操作
  const renameMapKey = (field: 'skillsList' | 'itemsList', oldKey: string, newKey: string) => {
    if (!newKey.trim() || oldKey === newKey) return;
    setNpc(prev => {
      const map = { ...(prev[field] as any) };
      const val = map[oldKey]; if (!val) return prev;
      delete map[oldKey]; map[newKey] = val;
      return { ...prev, [field]: map };
    });
  };
  const removeMapEntry = (field: 'skillsList' | 'itemsList', key: string) => {
    setNpc(prev => { const map = { ...(prev[field] as any) }; delete map[key]; return { ...prev, [field]: map }; });
  };
  const addMapEntry = (field: 'skillsList' | 'itemsList', defaultValue: any) => {
    const prefix = field === 'skillsList' ? '技能' : '物品';
    const name = `${prefix}${Object.keys(npc[field]).length + 1}`;
    setNpc(prev => ({ ...prev, [field]: { ...(prev[field] as any), [name]: defaultValue } }));
  };
  const updateSkillField = (name: string, field: string, value: string) => {
    setNpc(prev => {
      const map = { ...prev.skillsList };
      const skill = map[name]; if (!skill) return prev;
      map[name] = { ...skill, [field]: value };
      return { ...prev, skillsList: map };
    });
  };
  const updateItemField = (name: string, field: string, value: any) => {
    setNpc(prev => {
      const map = { ...prev.itemsList };
      const item = map[name]; if (!item) return prev;
      map[name] = { ...item, [field]: field === '数量' ? Number(value) || 1 : value };
      return { ...prev, itemsList: map };
    });
  };
  const setSurvivalStat = (key: string, value: number) => {
    setNpc(prev => ({ ...prev, survivalStats: { ...(prev.survivalStats || {}), [key]: value } }));
  };

  const canSave = npc.name.trim().length > 0;

  // NPC AI 补全
  const { isFilling, fillElapsed, handleAiFill } = useNpcFill({
    apiConfig: apiConfig || null,
    npc,
    playerName: playerName || '',
    playerGender: playerGender || '',
    playerAge: playerAge || '',
    playerBackground: playerBackground || '',
    selectedWorld: selectedWorld || '',
    allWorlds: allWorlds || [],
    worldEntry: worldEntry || null,
    setNpc,
  });

  return (
    <div className="world-editor-overlay" onClick={onCancel}>
      <div className="world-editor-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: '720px' }}>
        <div className="world-editor-header">
          <span style={{ fontWeight: '600', fontSize: '1rem' }}>
            {initial ? '编辑NPC' : '创建NPC'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <button
              className="pi-ai-btn"
              onClick={() => {
                const json = exportNpcTemplateJSON({
                  id: npc.id,
                  name: npc.name || 'NPC模板',
                  createdAt: Date.now(),
                  npc,
                });
                downloadJSON(json, `NPC_${npc.name || '未命名'}.json`);
              }}
              disabled={!npc.name.trim()}
              title="导出NPC为JSON"
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
            >
              <Download size={12} /> 导出JSON
            </button>
            {apiConfig && (
              <button
                className="pi-ai-btn"
                onClick={handleAiFill}
                disabled={isFilling || !npc.name.trim()}
                title="AI 补全NPC信息"
              >
                {isFilling ? <><Loader size={12} className="animate-spin" /> 生成中{fillElapsed > 0 ? ` ${fillElapsed}s` : ''}</> : <><Wand2 size={12} /> AI 补全</>}
              </button>
            )}
            <button onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 'var(--space-1)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="world-editor-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

          {/* ── 基础信息 ── */}
          <SectionTitle>基础信息</SectionTitle>
          <div className="form-group">
            <label>姓名 *</label>
            <input type="text" value={npc.name} onChange={e => set('name', e.target.value)} placeholder="NPC姓名..." />
          </div>
          <div className="form-group">
            <label>性别</label>
            <div className="gender-radio-group">
              {['男', '女', '其他'].map(g => (
                <div key={g} className={`gender-radio${npc.gender === g ? ' selected' : ''}`} onClick={() => set('gender', g)}>
                  {g === '男' ? '♂' : g === '女' ? '♀' : '⚧'} {g}
                </div>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>年龄</label>
            <input type="text" value={npc.age} onChange={e => set('age', e.target.value)} placeholder="如: 20, 少年..." />
          </div>
          <div className="form-group">
            <label>种族</label>
            <input type="text" value={npc.race} onChange={e => set('race', e.target.value)} placeholder="如: 人类, 精灵..." />
          </div>
          <div className="form-group">
            <label>与主角关系</label>
            <input type="text" value={npc.relationshipType} onChange={e => set('relationshipType', e.target.value)} placeholder="如: 青梅竹马、师父、宿敌..." />
          </div>

          {/* ── 社会身份 ── */}
          <SectionTitle>社会身份</SectionTitle>
          <div className="form-group">
            <label>职业</label>
            <input type="text" value={npc.occupation} onChange={e => set('occupation', e.target.value)} placeholder="如: 剑士、商人..." />
          </div>
          <div className="form-group">
            <label>社会地位</label>
            <input type="text" value={npc.socialStatus} onChange={e => set('socialStatus', e.target.value)} placeholder="如: 贵族、平民..." />
          </div>

          {/* ── 外貌与性格 ── */}
          <SectionTitle>外貌与性格</SectionTitle>
          <div className="form-group">
            <label>外貌</label>
            <textarea value={npc.appearance} onChange={e => set('appearance', e.target.value)} placeholder="描述外貌特征..." rows={2} />
          </div>
          <div className="form-group">
            <label>表性格</label>
            <textarea value={npc.personality} onChange={e => set('personality', e.target.value)} placeholder="外在表现的性格特征..." rows={2} />
          </div>
          <div className="form-group">
            <label>里性格</label>
            <textarea value={npc.hiddenPersonality} onChange={e => set('hiddenPersonality', e.target.value)} placeholder="隐藏的内心性格..." rows={2} />
          </div>

          {/* ── 状态 ── */}
          <SectionTitle>状态</SectionTitle>
          <div className="form-group">
            <label>穿着</label>
            <textarea value={npc.currentOutfit} onChange={e => set('currentOutfit', e.target.value)} placeholder="描述穿着打扮..." rows={2} />
          </div>
          <div className="form-group">
            <label>当前想法</label>
            <input type="text" value={npc.currentThought} onChange={e => set('currentThought', e.target.value)} placeholder="NPC此刻在想什么..." />
          </div>
          <div className="form-group">
            <label>当前行动</label>
            <input type="text" value={npc.currentAction} onChange={e => set('currentAction', e.target.value)} placeholder="NPC正在做什么..." />
          </div>
          <div className="form-group">
            <label>当前位置</label>
            <input type="text" value={npc.currentLocation} onChange={e => set('currentLocation', e.target.value)} placeholder="NPC在什么地方..." />
          </div>
          <div className="form-group">
            <label>当前状态</label>
            <input type="text" value={npc.currentState} onChange={e => set('currentState', e.target.value)} placeholder="动作/表情/情绪..." />
          </div>

          {/* ── 目标 ── */}
          <SectionTitle>目标</SectionTitle>
          <div className="form-group">
            <label>短期目标</label>
            <input type="text" value={npc.shortTermGoal} onChange={e => set('shortTermGoal', e.target.value)} placeholder="近期想做的事..." />
          </div>
          <div className="form-group">
            <label>长期目标</label>
            <input type="text" value={npc.longTermGoal} onChange={e => set('longTermGoal', e.target.value)} placeholder="人生追求..." />
          </div>

          {/* ── 背景 ── */}
          <SectionTitle>背景</SectionTitle>
          <div className="form-group">
            <textarea value={npc.background} onChange={e => set('background', e.target.value)} placeholder="简述NPC的背景故事..." rows={3} />
          </div>

          {/* ── 技能列表 ── */}
          <CollapsibleSection
            title="技能列表" count={Object.keys(npc.skillsList).length}
            expanded={expandedSections.has('skills')} onToggle={() => toggleSection('skills')}
          >
            {Object.entries(npc.skillsList).filter(([_, s]) => s != null).map(([name, skill]) => (
              <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="text" defaultValue={name}
                    onBlur={e => { if (e.target.value !== name) renameMapKey('skillsList', name, e.target.value); }}
                    placeholder="技能名称..." style={{ flex: 1, fontSize: 'var(--font-size-base)', padding: '5px 8px' }} />
                  <select value={skill?.品质 ?? '普通'} onChange={e => updateSkillField(name, '品质', e.target.value)}
                    style={{ fontSize: 'var(--font-size-base)', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-secondary)' }}>
                    {QUALITY_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
                  </select>
                  <button onClick={() => removeMapEntry('skillsList', name)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 'var(--space-1)' }}><Trash2 size={14} /></button>
                </div>
                <input type="text" value={skill?.描述 ?? ''} onChange={e => updateSkillField(name, '描述', e.target.value)} placeholder="技能描述..." style={{ fontSize: 'var(--font-size-base)', padding: '5px 8px' }} />
                <input type="text" value={skill?.类型 ?? ''} onChange={e => updateSkillField(name, '类型', e.target.value)} placeholder="类型(攻击/防御/辅助...)" style={{ fontSize: 'var(--font-size-base)', padding: '5px 8px' }} />
              </div>
            ))}
            <button className="btn-ghost" onClick={() => addMapEntry('skillsList', { 品质: '普通', 描述: '', 类型: '' })} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-1)' }}><Plus size={14} /> 添加技能</button>
          </CollapsibleSection>

          {/* ── 物品列表 ── */}
          <CollapsibleSection
            title="物品列表" count={Object.keys(npc.itemsList).length}
            expanded={expandedSections.has('items')} onToggle={() => toggleSection('items')}
          >
            {Object.entries(npc.itemsList).filter(([_, it]) => it != null).map(([name, item]) => (
              <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="text" defaultValue={name}
                    onBlur={e => { if (e.target.value !== name) renameMapKey('itemsList', name, e.target.value); }}
                    placeholder="物品名称..." style={{ flex: 1, fontSize: 'var(--font-size-base)', padding: '5px 8px' }} />
                  <input type="number" value={item?.数量 ?? 1} onChange={e => updateItemField(name, '数量', e.target.value)} min={1} style={{ fontSize: 'var(--font-size-base)', padding: '5px 8px', width: '50px' }} />
                  <select value={item?.品质 ?? '普通'} onChange={e => updateItemField(name, '品质', e.target.value)}
                    style={{ fontSize: 'var(--font-size-base)', padding: '5px 8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-secondary)' }}>
                    {QUALITY_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
                  </select>
                  <button onClick={() => removeMapEntry('itemsList', name)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 'var(--space-1)' }}><Trash2 size={14} /></button>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input type="text" value={item?.类型 ?? ''} onChange={e => updateItemField(name, '类型', e.target.value)} placeholder="类型(武器/防具/消耗品...)" style={{ flex: 1, fontSize: 'var(--font-size-base)', padding: '5px 8px' }} />
                  <input type="text" value={item?.备注 ?? ''} onChange={e => updateItemField(name, '备注', e.target.value)} placeholder="备注..." style={{ flex: 1, fontSize: 'var(--font-size-base)', padding: '5px 8px' }} />
                </div>
              </div>
            ))}
            <button className="btn-ghost" onClick={() => addMapEntry('itemsList', { 数量: 1, 类型: '', 品质: '普通', 备注: '' })} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-1)' }}><Plus size={14} /> 添加物品</button>
          </CollapsibleSection>

          {/* ── 人物事迹 ── */}
          <CollapsibleSection
            title="人物事迹" count={npc.chronicles.length}
            expanded={expandedSections.has('chronicles')} onToggle={() => toggleSection('chronicles')}
          >
            {(npc.chronicles ?? []).map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', flexShrink: 0 }}>{i + 1}.</span>
                <input type="text" value={c} onChange={e => {
                  const next = [...npc.chronicles]; next[i] = e.target.value; set('chronicles', next);
                }} placeholder="事迹内容..." style={{ flex: 1, fontSize: 'var(--font-size-base)', padding: '5px 8px' }} />
                <button onClick={() => { const next = npc.chronicles.filter((_, j) => j !== i); set('chronicles', next); }}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 'var(--space-1)', flexShrink: 0 }}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn-ghost" onClick={() => set('chronicles', [...npc.chronicles, ''])} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-1)' }}><Plus size={14} /> 添加事迹</button>
          </CollapsibleSection>

          {/* ── 生存属性（仅当世界启用 stat 模块时显示）── */}
          {statConfig && (
            <CollapsibleSection
              title={statMod!.name || '生存属性'} count={npc.survivalStats ? Object.keys(npc.survivalStats).length : 0}
              expanded={expandedSections.has('stats')} onToggle={() => toggleSection('stats')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                  {[{ key: '血量', cfg: statConfig.attrA, fallback: 100 }, { key: '体力值', cfg: statConfig.attrB, fallback: 100 }].map(({ key, cfg, fallback }) => (
                    <div key={key}>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>{cfg?.name || key}</span>
                      <input type="number" value={npc.survivalStats?.[key] ?? fallback}
                        onChange={e => setSurvivalStat(key, Number(e.target.value) || 0)}
                        style={{ fontSize: 'var(--font-size-base)', padding: '5px 8px', width: '100%', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                </div>
                {['dim1','dim2','dim3','dim4','dim5','dim6'].filter(k => statConfig[k]).length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
                    {(['dim1','dim2','dim3','dim4','dim5','dim6'] as const).map(key => {
                      const dim = statConfig[key];
                      if (!dim) return null;
                      return (
                        <div key={key}>
                          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>{dim.name}</span>
                          <input type="number" value={npc.survivalStats?.[key] ?? dim.value ?? 0}
                            onChange={e => setSurvivalStat(key, Number(e.target.value) || 0)}
                            style={{ fontSize: 'var(--font-size-base)', padding: '5px 8px', width: '100%', boxSizing: 'border-box', textAlign: 'center' }} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* ── 段位（仅当世界启用 progression 模块时显示）── */}
          {progConfig?.tiers?.length > 0 && (
            <CollapsibleSection
              title={progMod!.name || '成长体系'} count={npc.tierIndex != null ? 1 : 0}
              expanded={expandedSections.has('tier')} onToggle={() => toggleSection('tier')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                {progConfig.tiers.map((tier: any, i: number) => (
                  <label key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '5px 10px',
                    borderRadius: '6px', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
                    background: (npc.tierIndex ?? 0) === i ? 'var(--accent-dim)' : 'transparent',
                    border: `1px solid ${(npc.tierIndex ?? 0) === i ? 'var(--accent)' : 'var(--border)'}`,
                    transition: 'all 0.12s',
                  }}>
                    <input type="radio" name="npcTier" checked={(npc.tierIndex ?? 0) === i}
                      onChange={() => set('tierIndex', i)} style={{ display: 'none' }} />
                    <span style={{ fontWeight: 600, color: (npc.tierIndex ?? 0) === i ? 'var(--accent)' : 'var(--text-primary)', minWidth: '1.5em' }}>{i + 1}.</span>
                    <span style={{ fontWeight: 600, color: (npc.tierIndex ?? 0) === i ? 'var(--accent)' : 'var(--text-primary)' }}>{tier.name}</span>
                    {tier.description && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tier.description}</span>}
                  </label>
                ))}
              </div>
            </CollapsibleSection>
          )}
        </div>

        <div className="world-editor-footer">
          <button className="btn-secondary" onClick={onCancel} style={{ padding: 'var(--space-2) var(--space-5)' }}>{t('common.cancel')}</button>
          <button className="btn-primary" onClick={() => onSave(npc)} disabled={!canSave} style={{ padding: 'var(--space-2) var(--space-6)' }}>
            {initial ? t('npcEditor.saveChanges') : t('npcEditor.createNpc')}
          </button>
        </div>
      </div>
    </div>
  );
}
