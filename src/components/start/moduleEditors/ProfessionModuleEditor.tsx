import { BookOpen, ExternalLink } from 'lucide-react';
import type { ProfessionWorldBinding } from '../../../modules/schema';
import { getProfessionPack, isProfessionBinding, resolveProfessionBinding } from '../../../data/professions';

export function ProfessionModuleEditor({
  data,
  onChange,
  onOpenLibrary,
}: {
  data: ProfessionWorldBinding | Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  onOpenLibrary?: () => void;
}) {
  const binding: ProfessionWorldBinding = isProfessionBinding(data) ? data : { packIds: [] };
  const resolved = resolveProfessionBinding(binding);
  const packs = binding.packIds.map(getProfessionPack).filter(Boolean);
  return (
    <div className="profession-library__binding">
      <header>
        <div>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><BookOpen size={15} />职业典藏引用</strong>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 3 }}>世界只保存包 ID；完整职业树、天赋与主动能力在职业典藏中独立维护。</div>
        </div>
        <button className="btn-primary btn-sm" onClick={onOpenLibrary}><ExternalLink size={14} />打开职业典藏</button>
      </header>
      <div className="profession-library__binding-list">
        {packs.length ? packs.map(pack => <span key={pack!.manifest.id}>{pack!.manifest.name}</span>) : <span>尚未挂载职业包</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, color: 'var(--text-muted)', fontSize: 11 }}>
        <span>{resolved.professions.length} 个可选职业</span>
        <span>{resolved.professions.reduce((sum, item) => sum + item.abilities.length, 0)} 个能力节点</span>
        <span>{resolved.innateTalents.length} 个先天天赋</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        <input type="checkbox" checked={binding.allowNoProfession !== false} onChange={event => onChange({ ...binding, allowNoProfession: event.target.checked })} />允许角色选择无职业
      </label>
    </div>
  );
}
