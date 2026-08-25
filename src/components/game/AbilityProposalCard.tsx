import { useEffect, useMemo, useRef } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { AbilityProposal } from '../../gameplay/protocols';
import { balanceAbilityProposal } from '../../gameplay/abilitySystem';

interface Props {
  proposal: AbilityProposal;
  remainingCount?: number;
  saving?: boolean;
  error?: string | null;
  onResolve: (proposalId: string, decision: 'accept' | 'reject') => void;
}

const targetLabels: Record<AbilityProposal['target'], string> = {
  self: '自身',
  ally: '友方',
  enemy: '敌方',
  area: '敌方群体',
  none: '无目标',
};

const categoryLabels: Record<AbilityProposal['category'], string> = {
  innate_talent: '先天天赋',
  profession: '职业能力',
  free_skill: '自由技能',
  dynamic: '剧情能力',
  pet: '宠物能力',
  summon: '召唤能力',
  combat_item: '战斗道具',
};

export default function AbilityProposalCard({ proposal, remainingCount = 1, saving = false, error, onResolve }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const preview = useMemo(() => balanceAbilityProposal(proposal), [proposal]);
  const action = preview.mechanics?.combatAction;
  const cost = (preview.mechanics?.costs ?? []).reduce((total, item) => total + item.amount, 0);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [proposal.id]);

  return (
    <div className="combat-decision ability-proposal" role="dialog" aria-modal="true" aria-labelledby="ability-proposal-title">
      <article className="combat-decision__card ability-proposal__card">
        <span className="combat-decision__eyebrow"><Sparkles size={15} aria-hidden="true" />能力提案 · 本地配平预览</span>
        <h2 id="ability-proposal-title" ref={headingRef} tabIndex={-1}>{proposal.name}</h2>
        <p>{proposal.description}</p>
        <div className="ability-proposal__meta">
          <span>{categoryLabels[proposal.category]}</span><span>{proposal.rarity}</span><span>目标：{targetLabels[proposal.target]}</span>
        </div>
        <div className="ability-proposal__mechanics" aria-label="本地生成的机械定义">
          <strong>确认后写入的机械</strong>
          <span>{action?.damage ? `基础伤害 ${action.damage}` : action?.healing ? `基础治疗 ${action.healing}` : '被动/叙事能力'}</span>
          <span>消耗 {cost} · 冷却 {preview.mechanics?.cooldownRounds ?? 0} 回合</span>
          {action?.scaling?.[0] && <span>规范属性倍率 {Math.round(action.scaling[0].coefficient * 100)}%</span>}
          {action?.appliesStatus && <span>附加状态：{action.appliesStatus.name}（{action.appliesStatus.durationRounds ?? 1} 回合）</span>}
        </div>
        <small>模型只提出名称、用途、目标与品质；以上数值由本地规则生成。{remainingCount > 1 ? `之后还有 ${remainingCount - 1} 项待确认。` : ''}</small>
        {error && <div className="combat-decision__error" role="alert">{error}</div>}
        <div className="ability-proposal__actions">
          <button type="button" className="combat-decision__primary" onClick={() => onResolve(proposal.id, 'accept')} disabled={saving}><Check size={16} />确认获得</button>
          <button type="button" onClick={() => onResolve(proposal.id, 'reject')} disabled={saving}><X size={16} />放弃</button>
        </div>
        <span className="combat-decision__status" aria-live="polite">{saving ? '正在写入存档…' : '确认或放弃都会立即保存，不会重复弹出。'}</span>
      </article>
    </div>
  );
}
