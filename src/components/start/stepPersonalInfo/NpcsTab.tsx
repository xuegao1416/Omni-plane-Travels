import React from 'react';
import { Plus, Trash2, Pencil } from 'lucide-react';
import type { PlayerProfile, CustomNpc } from './types';

interface NpcsTabProps {
  personalInfo: PlayerProfile;
  set: <K extends keyof PlayerProfile>(key: K, val: PlayerProfile[K]) => void;
  onEditNpc: (npc: CustomNpc) => void;
  onOpenPicker: () => void;
}

export default function NpcsTab({ personalInfo, set, onEditNpc, onOpenPicker }: NpcsTabProps) {
  const removeNpc = (id: string) => {
    set('customNpcs', personalInfo.customNpcs.filter(n => n.id !== id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {personalInfo.customNpcs.map(npc => (
        <div key={npc.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)' }}>{npc.name || '未命名'}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[npc.gender, npc.age && `${npc.age}岁`, npc.race, npc.relationshipType].filter(Boolean).join(' / ') || '未设定'}
            </div>
            {(Object.keys(npc.skillsList).length > 0 || Object.keys(npc.itemsList).length > 0 || npc.chronicles.length > 0) && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)', marginTop: '2px' }}>
                {Object.keys(npc.skillsList).length > 0 && `${Object.keys(npc.skillsList).length}技能 `}
                {Object.keys(npc.itemsList).length > 0 && `${Object.keys(npc.itemsList).length}物品 `}
                {npc.chronicles.length > 0 && `${npc.chronicles.length}事迹`}
              </div>
            )}
          </div>
          <button onClick={() => onEditNpc(npc)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}><Pencil size={14} /></button>
          <button onClick={() => removeNpc(npc.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '4px' }}><Trash2 size={14} /></button>
        </div>
      ))}
      <button className="btn-ghost" onClick={onOpenPicker} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--font-size-base)' }}><Plus size={14} /> 创建NPC</button>
    </div>
  );
}
