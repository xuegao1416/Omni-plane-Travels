import { useState, useRef } from 'react';
import type { CustomNpc } from '../../storage/db';
import type { ApiConfig } from '../../api/types';
import type { WorldDef } from '../../data/worldLoader';
import type { WorldBookEntry } from '../../worldbook/index';
import { X, Wand2, Loader, Download } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import { useConfigStore } from '../../stores/configStore';
import { useNpcFill } from '../../hooks/useNpcFill';
import { exportNpcTemplateJSON, downloadJSON } from '../../storage/templateStore';

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
      padding: '6px 0 2px', borderBottom: '1px solid var(--border)', marginTop: '4px',
    }}>
      {children}
    </div>
  );
}

export default function NpcEditorModal({
  initial, onSave, onCancel,
  apiConfig, playerName, playerGender, playerAge, playerBackground,
  selectedWorld, allWorlds, worldEntry,
}: Props) {
  const t = useConfigStore(s => s.t);
  const [npc, setNpc] = useState<CustomNpc>(() => initial || emptyNpc());

  const set = <K extends keyof CustomNpc>(key: K, val: CustomNpc[K]) =>
    setNpc(prev => ({ ...prev, [key]: val }));

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            <button onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}>
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
        </div>

        <div className="world-editor-footer">
          <button className="btn-secondary" onClick={onCancel} style={{ padding: '8px 20px' }}>{t('common.cancel')}</button>
          <button className="btn-primary" onClick={() => onSave(npc)} disabled={!canSave} style={{ padding: '8px 24px' }}>
            {initial ? t('npcEditor.saveChanges') : t('npcEditor.createNpc')}
          </button>
        </div>
      </div>
    </div>
  );
}
