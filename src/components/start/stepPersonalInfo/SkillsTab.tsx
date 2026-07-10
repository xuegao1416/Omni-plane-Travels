import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PlayerProfile, SkillData } from './types';
import { QUALITY_OPTIONS } from './types';

interface SkillsTabProps {
  personalInfo: PlayerProfile;
  set: <K extends keyof PlayerProfile>(key: K, val: PlayerProfile[K]) => void;
}

export default function SkillsTab({ personalInfo, set }: SkillsTabProps) {
  const addSkill = () => {
    const name = `技能${Object.keys(personalInfo.initialSkills).length + 1}`;
    set('initialSkills', { ...personalInfo.initialSkills, [name]: { 品质: '普通', 描述: '', 类型: '' } });
  };
  const removeSkill = (name: string) => {
    const next = { ...personalInfo.initialSkills }; delete next[name]; set('initialSkills', next);
  };
  const updateSkillField = (name: string, field: keyof SkillData, value: string) => {
    const next = { ...personalInfo.initialSkills };
    const skill = next[name]; if (!skill) return;
    next[name] = { ...skill, [field]: value };
    set('initialSkills', next);
  };
  const renameSkill = (oldName: string, newName: string) => {
    if (oldName === newName) return;
    const next = { ...personalInfo.initialSkills };
    const skill = next[oldName]; if (!skill) return;
    delete next[oldName];
    next[newName] = skill;
    set('initialSkills', next);
  };

  return (
    <div className="world-dynamic-list">
      {Object.entries(personalInfo.initialSkills).filter(([_, s]) => s != null).map(([name, skill]) => (
        <div key={name} className="world-dynamic-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flex: 1 }}>
            <input type="text" defaultValue={name} onBlur={e => renameSkill(name, e.target.value)} placeholder="技能名称..." style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px' }} />
            <select value={skill?.品质 ?? '普通'} onChange={e => updateSkillField(name, '品质', e.target.value)} style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-secondary)' }}>
              {QUALITY_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
            <input type="text" value={skill?.描述 ?? ''} onChange={e => updateSkillField(name, '描述', e.target.value)} placeholder="技能描述..." style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px' }} />
          </div>
          <button onClick={() => removeSkill(name)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '4px', flexShrink: 0, alignSelf: 'flex-end' }}><Trash2 size={14} /></button>
        </div>
      ))}
      <button className="btn-ghost" onClick={addSkill} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-base)', marginTop: '4px' }}><Plus size={14} /> 添加技能</button>
    </div>
  );
}
