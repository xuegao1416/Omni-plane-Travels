/**
 * 模板卡片 — 列表视图中的单个模板条目
 */
import { Trash2, User, Users, BookOpen, Clock } from 'lucide-react';
import type { NpcTemplate, PlayerPreset, HistoryPreset } from '../../../storage/templateStore';
import type { TemplateCardProps } from './types';
import s from './styles.module.css';

function getLabel(tpl: NpcTemplate | PlayerPreset | HistoryPreset, mode: string): string {
  if (mode === 'npc') return (tpl as NpcTemplate).npc.name || '未命名NPC';
  if (mode === 'history') return (tpl as HistoryPreset).name;
  return (tpl as PlayerPreset).name;
}

function getSub(tpl: NpcTemplate | PlayerPreset | HistoryPreset, mode: string): string {
  if (mode === 'npc') {
    const npc = (tpl as NpcTemplate).npc;
    return [npc.gender, npc.age && `${npc.age}岁`, npc.relationshipType].filter(Boolean).join(' · ');
  }
  if (mode === 'history') {
    const hp = tpl as HistoryPreset;
    const count = Object.values(hp.segments).filter(v => v.trim()).length;
    return `${count} 个阶段已填写`;
  }
  const p = tpl as PlayerPreset;
  return [p.gender, p.age && `${p.age}岁`, p.career].filter(Boolean).join(' · ');
}

function getIcon(mode: string) {
  if (mode === 'npc') return <Users size={16} />;
  if (mode === 'history') return <BookOpen size={16} />;
  return <User size={16} />;
}

export function TemplateCard({ tpl, mode, onSelect, onDelete }: TemplateCardProps) {
  const label = getLabel(tpl, mode);
  const sub = getSub(tpl, mode);
  const timeStr = new Date(tpl.createdAt).toLocaleDateString();

  return (
    <div className={s.templateCard} onClick={() => onSelect(tpl)}>
      <div className={s.templateIcon}>
        {getIcon(mode)}
      </div>
      <div className={s.templateInfo}>
        <div className={s.templateName}>{tpl.name}</div>
        <div className={s.templateMeta}>
          <span>{label}</span>
          {sub && <span>· {sub}</span>}
        </div>
        <div className={s.templateTime}>
          <Clock size={10} /> {timeStr}
        </div>
      </div>
      <button
        className={s.deleteBtn}
        onClick={e => onDelete(e, tpl.id)}
        title="删除模板"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
