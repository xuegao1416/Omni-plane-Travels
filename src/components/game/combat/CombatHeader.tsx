import { ArrowLeft, Swords } from 'lucide-react';
import type { CombatSessionV2 } from '../../../gameplay/protocols';

const riskLabels: Record<CombatSessionV2['riskMode'], string> = { normal: '普通', hard: '困难', inferno: '炼狱' };

export default function CombatHeader({
  session, saving, error, readOnly, initiativeNames, onLeave,
}: {
  session: CombatSessionV2;
  saving: boolean;
  error?: string | null;
  readOnly: boolean;
  initiativeNames: string[];
  onLeave: () => void;
}) {
  return <>
    <header className="combat-wireframe__header">
      <div className="combat-wireframe__heading"><span className="combat-wireframe__eyebrow"><Swords size={15} aria-hidden="true" />{riskLabels[session.riskMode]}风险 · 第 {session.round} 回合</span><h1>{session.encounter.context}</h1></div>
      <div className="combat-wireframe__header-tools"><span className={`combat-wireframe__save-status${error ? ' is-error' : ''}`} aria-live="polite">{saving ? '正在保存…' : error ? error : readOnly ? '封存存档 · 只读查看' : '战斗状态已保存'}</span><button type="button" className="combat-wireframe__leave" onClick={onLeave} disabled={saving}><ArrowLeft size={16} aria-hidden="true" />保存并返回旅庭</button></div>
    </header>
    {initiativeNames.length > 0 && <div className="combat-wireframe__initiative" aria-label={`行动顺序：${initiativeNames.join('、')}`}><span>行动顺序</span>{initiativeNames.map((name, index) => <b key={`${name}-${index}`} className={session.initiativeOrder[index] === session.activeUnitId ? 'is-active' : ''}>{index + 1}. {name}</b>)}</div>}
  </>;
}
