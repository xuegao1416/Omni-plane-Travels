import { RotateCcw,Sparkles } from 'lucide-react';
import type { CombatSessionV2 } from '../../../gameplay/protocols';
import PlanarFrame from '../../../ui/planar/PlanarFrame';
import { EmblemDefeat,EmblemEscape,EmblemVictory } from './combatArt';

export default function CombatResult({ session, saving, readOnly, onContinueNarration, onRetry }: { session: CombatSessionV2; saving: boolean; readOnly: boolean; onContinueNarration: () => void; onRetry: () => void }) {
  if (!session.result) return null;
  const status = session.result.status;
  const tone = status === 'victory' ? 'victory' : status === 'defeat' ? 'defeat' : 'escape';
  const title = status === 'victory' ? '战斗胜利' : status === 'escaped' ? '已脱离战斗' : status === 'defeat' ? '战斗失败' : '战斗结束';
  const narration = session.result.narration.status;
  const copy = narration === 'pending' ? '机械结算与奖励已安全保存，正在生成承接正文。' : narration === 'failed' ? `机械结算已保存；承接正文失败：${session.result.narration.error ?? '模型未返回正文'}。可以安全重试，不会重复结算。` : '承接正文已完成。';
  const actions = session.actionSequence.filter(action => action.resolved && !action.rejected);
  const dealt = actions.filter(action => session.participants.find(unit => unit.id === action.unitId)?.side !== 'enemy').reduce((sum, action) => sum + action.damage, 0);
  const crits = actions.filter(action => action.critical).length;
  const Emblem = tone === 'victory' ? EmblemVictory : tone === 'defeat' ? EmblemDefeat : EmblemEscape;
  return (
    <div className={`cb-result is-${tone}`} role="status">
      <PlanarFrame variant="plate" material="cloth" gem={tone === 'defeat' ? 'garnet' : 'amber'} className="cb-result__card">
        <span className="cb-result__seal"><span className="cb-result__rays" aria-hidden="true" /><Emblem /></span>
        <h2>{title}</h2>
        <dl className="cb-result__stats">
          <div><dt>回合</dt><dd>{session.round}</dd></div>
          <div><dt>造成伤害</dt><dd>{dealt}</dd></div>
          <div><dt>暴击</dt><dd>{crits}</dd></div>
        </dl>
        <p className={narration === 'pending' ? 'is-pending' : ''}>{narration === 'pending' && <i aria-hidden="true" />}{copy}</p>
        {narration !== 'succeeded' && <div className="cb-result__actions">
          <button type="button" className="pk-btn pk-btn--primary" onClick={onContinueNarration} disabled={saving}><Sparkles size={15} aria-hidden="true" /><span>重试承接正文</span></button>
          {session.riskMode !== 'inferno' && <button type="button" className="pk-btn pk-btn--secondary" onClick={onRetry} disabled={readOnly}><RotateCcw size={15} aria-hidden="true" />{saving ? '中止承接并恢复战前' : '恢复战前检查点'}</button>}
        </div>}
      </PlanarFrame>
    </div>
  );
}
