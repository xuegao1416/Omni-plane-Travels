import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PlayerProfile, InventoryItem } from './types';
import { QUALITY_OPTIONS } from './types';

interface ItemsTabProps {
  personalInfo: PlayerProfile;
  set: <K extends keyof PlayerProfile>(key: K, val: PlayerProfile[K]) => void;
}

export default function ItemsTab({ personalInfo, set }: ItemsTabProps) {
  const addItem = () => {
    const name = `物品${Object.keys(personalInfo.initialItems).length + 1}`;
    set('initialItems', { ...personalInfo.initialItems, [name]: { 数量: 1, 类型: '', 品质: '普通', 备注: '' } });
  };
  const removeItem = (name: string) => {
    const next = { ...personalInfo.initialItems }; delete next[name]; set('initialItems', next);
  };
  const updateItemField = (name: string, field: keyof InventoryItem, value: any) => {
    const next = { ...personalInfo.initialItems };
    const item = next[name]; if (!item) return;
    next[name] = { ...item, [field]: field === '数量' ? Number(value) || 1 : value };
    set('initialItems', next);
  };
  const renameItem = (oldName: string, newName: string) => {
    if (oldName === newName) return;
    const next = { ...personalInfo.initialItems };
    const item = next[oldName]; if (!item) return;
    delete next[oldName];
    next[newName] = item;
    set('initialItems', next);
  };

  return (
    <div className="world-dynamic-list">
      {Object.entries(personalInfo.initialItems).map(([name, item]) => (
        <div key={name} className="world-dynamic-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
            <input type="text" defaultValue={name} onBlur={e => renameItem(name, e.target.value)} placeholder="物品名称..." style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px' }} />
            <div style={{ display: 'flex', gap: '6px' }}>
              <input type="number" value={item.数量} onChange={e => updateItemField(name, '数量', e.target.value)} min={1} style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px', width: '50px' }} placeholder="数量" />
              <select value={item.品质} onChange={e => updateItemField(name, '品质', e.target.value)} style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-secondary)', width: '70px' }}>
                {QUALITY_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
              <input type="text" value={item.类型} onChange={e => updateItemField(name, '类型', e.target.value)} placeholder="类型(武器/防具/消耗品...)" style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px', flex: 1 }} />
            </div>
            <input type="text" value={item.备注} onChange={e => updateItemField(name, '备注', e.target.value)} placeholder="备注(用途、来源等)..." style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px' }} />
          </div>
          <button onClick={() => removeItem(name)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '4px', flexShrink: 0, alignSelf: 'flex-end' }}><Trash2 size={14} /></button>
        </div>
      ))}
      <button className="btn-ghost" onClick={addItem} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-base)', marginTop: '4px' }}><Plus size={14} /> 添加物品</button>
    </div>
  );
}
