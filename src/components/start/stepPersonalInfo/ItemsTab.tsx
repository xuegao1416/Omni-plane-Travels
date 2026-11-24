import { Plus,Trash2 } from 'lucide-react';
import type { PlayerProfile,InventoryItem } from './types';
import { QUALITY_OPTIONS } from './types';
import { playerInventoryLayout } from '../../../domains/inventory/capacity';

interface ItemsTabProps {
  personalInfo: PlayerProfile;
  set: <K extends keyof PlayerProfile>(key: K, val: PlayerProfile[K]) => void;
}

export default function ItemsTab({ personalInfo, set }: ItemsTabProps) {
  // 开局行囊与游戏内同一套容量：随身 12 格，带上背包类物品才能多装。
  const layout = playerInventoryLayout(personalInfo.initialItems);
  const full = layout.used >= layout.capacity;
  const addItem = () => {
    if (full) return;
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
      {Object.entries(personalInfo.initialItems).filter(([_, it]) => it != null).map(([name, item]) => (
        <div key={name} className="world-dynamic-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0 }}>
            <input type="text" defaultValue={name} onBlur={e => renameItem(name, e.target.value)} placeholder="物品名称..." style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px', maxWidth: '100%', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
              <input type="number" value={item?.数量 ?? 1} onChange={e => updateItemField(name, '数量', e.target.value)} min={1} style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px', width: '50px', boxSizing: 'border-box' }} placeholder="数量" />
              <select value={item?.品质 ?? '普通'} onChange={e => updateItemField(name, '品质', e.target.value)} style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--bg-secondary)', width: '70px', boxSizing: 'border-box' }}>
                {QUALITY_OPTIONS.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
              <input type="text" value={item?.类型 ?? ''} onChange={e => updateItemField(name, '类型', e.target.value)} placeholder="类型(武器/防具/消耗品...)" style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px', flex: 1, minWidth: '80px', boxSizing: 'border-box' }} />
            </div>
            <input type="text" value={item?.备注 ?? ''} onChange={e => updateItemField(name, '备注', e.target.value)} placeholder="备注(用途、来源等)..." style={{ fontSize: 'var(--font-size-base)', padding: '6px 8px', maxWidth: '100%', boxSizing: 'border-box' }} />
          </div>
          <button onClick={() => removeItem(name)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '4px', flexShrink: 0, alignSelf: 'flex-end' }}><Trash2 size={14} /></button>
        </div>
      ))}
      <div style={{ fontSize: 'var(--font-size-sm)', color: layout.overflow > 0 ? 'var(--danger)' : 'var(--text-muted)', marginTop: '4px', lineHeight: 1.5 }}>
        行囊 {layout.used}/{layout.capacity} 格{layout.bags.length ? `（含背包 ${layout.bags.map(bag => `${bag.name}+${bag.size}`).join('、')}）` : ''}
        {full ? '：已装满。类型写「背包」的物品会扩充格数，旅途中拿到背包也能多带。' : '：每种物品占一格，同名物品叠放不占新格。'}
      </div>
      <button className="btn-ghost" onClick={addItem} disabled={full} title={full ? '行囊已满' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-base)', marginTop: '4px' }}><Plus size={14} /> 添加物品</button>
    </div>
  );
}
