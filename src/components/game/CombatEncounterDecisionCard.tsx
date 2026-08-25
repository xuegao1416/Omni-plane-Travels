import { useEffect, useRef } from 'react';
import { BookOpenText, Footprints, ShieldAlert, Swords } from 'lucide-react';
import type { CombatEncounterRequest } from '../../gameplay/protocols';

export type CombatEncounterDecision = 'fight' | 'escape' | 'narrative';

interface Props {
  request: CombatEncounterRequest;
  saving?: boolean;
  error?: string | null;
  onChoose: (decision: CombatEncounterDecision) => void;
}

const threatLabels: Record<CombatEncounterRequest['proposal']['threatBand'], string> = {
  weak: '弱小',
  matched: '匹敌',
  dangerous: '危险',
  boss: '首领',
  overwhelming: '压倒性',
};

export default function CombatEncounterDecisionCard({ request, saving = false, error, onChoose }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [request.proposal.id]);

  return (
    <div className="combat-decision" role="dialog" aria-modal="true" aria-labelledby="combat-decision-title">
      <article className="combat-decision__card">
        <span className="combat-decision__eyebrow"><ShieldAlert size={15} aria-hidden="true" />遭遇确认 · {threatLabels[request.proposal.threatBand]}</span>
        <h2 id="combat-decision-title" ref={headingRef} tabIndex={-1}>冲突已经发生</h2>
        <p>{request.proposal.context}</p>
        <div className="combat-decision__sides">
          <span>可选友方 {request.proposal.allies.length + 1} 名</span>
          <span>敌方 {request.proposal.enemies.length} 名</span>
        </div>
        {error && <div className="combat-decision__error" role="alert">{error}</div>}
        <div className="combat-decision__actions">
          <button type="button" className="combat-decision__primary" onClick={() => onChoose('fight')} disabled={saving}>
            <Swords size={17} aria-hidden="true" /><span><strong>迎战</strong><small>进入编队与本地机械战斗</small></span>
          </button>
          <button type="button" onClick={() => onChoose('escape')} disabled={saving}>
            <Footprints size={17} aria-hidden="true" /><span><strong>尝试脱离</strong><small>交给下一段正文判断能否离开</small></span>
          </button>
          <button type="button" onClick={() => onChoose('narrative')} disabled={saving}>
            <BookOpenText size={17} aria-hidden="true" /><span><strong>叙事处理</strong><small>不进入机械战场，由正文承接冲突</small></span>
          </button>
        </div>
        <span className="combat-decision__status" aria-live="polite">{saving ? '正在保存选择…' : '选择会立即写入当前存档，并只承接一次。'}</span>
      </article>
    </div>
  );
}
