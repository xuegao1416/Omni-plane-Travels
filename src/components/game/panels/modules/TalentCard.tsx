import { memo } from 'react';
import { BookOpen, CircleCheck, LockKeyhole, Play, Sparkles, Star, RotateCcw, Zap, X } from 'lucide-react';
import type { TalentModuleSchema } from '../../../../modules/schema';
import type { GameState } from '../../../../schema/variables';
import { canLearnSkill, canUnlockTalent } from '../../../../gameplay/modules/talent';
import { Collapsible } from '../../../shared/Collapsible';
import { getQualityColor } from '../../../shared/qualityUtils';

interface TalentCardProps {
  data: TalentModuleSchema;
  gameState: GameState;
  abilityState?: GameState['玩家']['能力系统'];
  currentTick?: number;
  onUnlockTalent?: (talentId: string) => void;
  onLearnSkill?: (skillId: string) => void;
  onUseSkill?: (skillId: string) => void;
  onAwakenAbility?: (abilityId: string) => void;
  onRespec?: () => void;
  onEquipAbility?: (abilityId: string, slotId: string) => void;
  onUnequipAbility?: (abilityId: string) => void;
  title?: string;
}

export default memo(function TalentCard({
  data,
  gameState,
  abilityState,
  currentTick = 0,
  onUnlockTalent,
  onLearnSkill,
  onUseSkill,
  onAwakenAbility,
  onRespec,
  onEquipAbility,
  onUnequipAbility,
  title,
}: TalentCardProps) {
  const talentPoints = abilityState?.天赋点 ?? 0;
  const skillPoints = abilityState?.技能点 ?? 0;
  const talents = data.categories.flatMap(category => category.talents ?? []);
  const skills = data.skills ?? [];
  const context = { tick: currentTick, enabledModules: ['talent'] as const };
  const allNodes = [...talents, ...skills];
  const nodeById = new Map(allNodes.map(node => [node.id, node]));
  const equippedIds = new Set(Object.values(abilityState?.装备槽 ?? {}).flat());
  const isOwned = (id: string) => Boolean(abilityState?.已解锁天赋[id] || abilityState?.已掌握技能[id]);
  const position = (node: { graph?: { x: number; y: number } }, index: number) => {
    if (node.graph && Number.isFinite(node.graph.x) && Number.isFinite(node.graph.y)) return { left: `${Math.max(2, Math.min(94, node.graph.x))}%`, top: `${Math.max(4, Math.min(86, node.graph.y))}%` };
    return { left: `${8 + (index % 3) * 42}%`, top: `${6 + Math.floor(index / 3) * 30}%` };
  };
  const prerequisiteLines = allNodes.flatMap((node, index) => (node.prerequisites ?? []).map(parentId => {
    const parentIndex = allNodes.findIndex(item => item.id === parentId); if (parentIndex < 0) return null;
    const from = position(allNodes[parentIndex], parentIndex), to = position(node, index);
    return <line key={`${parentId}-${node.id}`} x1={String(from.left).replace('%', '')} y1={String(from.top).replace('%', '')} x2={String(to.left).replace('%', '')} y2={String(to.top).replace('%', '')} />;
  }).filter(Boolean));

  return (
    <Collapsible icon={<Star size={15} />} title={title || '天赋与技能'} defaultOpen={true}>
      <div className="ability-module">
        <div className="ability-module__points">
          <span><Sparkles size={12} aria-hidden="true" /> 天赋点 <strong>{talentPoints}</strong></span>
          <span><BookOpen size={12} aria-hidden="true" /> 技能点 <strong>{skillPoints}</strong></span>
        </div>

        {allNodes.length > 0 && (
          <section className="ability-module__section">
            <div className="ability-module__section-heading"><h5>能力树</h5>{onRespec && <button className="btn-ghost btn-xs" onClick={onRespec} title="返还已投入的天赋点与技能点"><RotateCcw size={12} aria-hidden="true" />洗点</button>}</div>
            <div className="talent-graph" aria-label="天赋与技能树">
              <svg className="talent-graph__edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{prerequisiteLines}</svg>
              {allNodes.map((node, index) => {
                const isTalent = talents.some(item => item.id === node.id);
                const owned = isTalent ? abilityState?.已解锁天赋[node.id] : abilityState?.已掌握技能[node.id];
                const awakening = node.awakening; const awakened = Boolean(abilityState?.已觉醒?.[node.id]);
                const pos = position(node, index);
                return <div key={node.id} className={`talent-graph__node ${owned ? 'is-owned' : ''} ${awakened ? 'is-awakened' : ''}`} style={pos}>
                  <div className="talent-graph__node-title">{isTalent ? <Star size={11} /> : <BookOpen size={11} />}{node.name}</div>
                  <small>{owned ? `Lv.${owned.等级}/${Math.max(1, node.maxRank ?? 1)}` : (node.branch || node.rarity)}</small>
                  {node.prerequisites?.length ? <small>前置 {node.prerequisites.length}</small> : null}
                  {awakening && owned && !awakened && onAwakenAbility && <button className="btn-ghost btn-xs" onClick={() => onAwakenAbility(node.id)}><Zap size={11} />觉醒</button>}
                  {!owned && isTalent && onUnlockTalent && (() => { const check = canUnlockTalent(gameState, data, node.id, context); return <button className="btn-ghost btn-xs" onClick={() => onUnlockTalent(node.id)} disabled={!check.ok} title={check.reason}><LockKeyhole size={11} />解锁</button>; })()}
                  {!owned && !isTalent && onLearnSkill && (() => { const check = canLearnSkill(gameState, data, node.id, context); return <button className="btn-ghost btn-xs" onClick={() => onLearnSkill(node.id)} disabled={!check.ok} title={check.reason}><BookOpen size={11} />学习</button>; })()}
                </div>;
              })}
            </div>
          </section>
        )}

        {talents.length > 0 && (
          <section className="ability-module__section">
            <h5>天赋</h5>
            {talents.map(talent => {
              const owned = abilityState?.已解锁天赋[talent.id];
              const maxRank = Math.max(1, talent.maxRank ?? 1);
              const maxed = (owned?.等级 ?? 0) >= maxRank;
              const availability = canUnlockTalent(gameState, data, talent.id, context);
              const color = getQualityColor(talent.rarity);
              return (
                <div className="ability-module__row" key={talent.id}>
                  <span className="ability-module__quality" style={{ color }} aria-hidden="true">●</span>
                  <div className="ability-module__content">
                    <div className="ability-module__name">
                      <strong>{talent.name}</strong>
                      <span style={{ color }}>{talent.rarity}</span>
                      {owned && <small>Lv.{owned.等级}/{maxRank}</small>}
                      {abilityState?.已觉醒?.[talent.id] && <small><Zap size={10} />已觉醒</small>}
                    </div>
                    <p>{talent.description}</p>
                  </div>
                  <button
                    className="btn-ghost btn-xs"
                    onClick={() => onUnlockTalent?.(talent.id)}
                    disabled={!onUnlockTalent || !availability.ok}
                    title={maxed ? '已达到最高等级' : availability.reason ?? `消耗 ${talent.pointCost ?? 1} 天赋点`}
                  >
                    {maxed ? <CircleCheck size={14} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}
                    <span>{maxed ? '已掌握' : owned ? '提升' : '解锁'}</span>
                  </button>
                </div>
              );
            })}
          </section>
        )}

        {skills.length > 0 && (
          <section className="ability-module__section">
            <h5>技能</h5>
            {skills.map(skill => {
              const learned = abilityState?.已掌握技能[skill.id];
              const cooldown = Math.max(0, (learned?.冷却至轮次 ?? 0) - currentTick);
              const maxRank = Math.max(1, skill.maxRank ?? 1);
              const availability = canLearnSkill(gameState, data, skill.id, context);
              return (
                <div className="ability-module__row" key={skill.id}>
                  <BookOpen className="ability-module__skill-icon" size={14} aria-hidden="true" />
                  <div className="ability-module__content">
                    <div className="ability-module__name">
                      <strong>{skill.name}</strong>
                      {learned && <small>Lv.{learned.等级}/{maxRank}</small>}
                      {cooldown > 0 && <small>冷却 {cooldown} 轮</small>}
                      {learned && <small>熟练度 {learned.熟练度 ?? 0}</small>}
                      {abilityState?.已觉醒?.[skill.id] && <small><Zap size={10} />已觉醒</small>}
                    </div>
                    <p>{skill.description}</p>
                  </div>
                  {learned ? (
                    <button className="btn-primary btn-xs" onClick={() => onUseSkill?.(skill.id)} disabled={!onUseSkill || cooldown > 0} title={cooldown > 0 ? `剩余 ${cooldown} 轮` : '使用技能'}>
                      <Play size={13} aria-hidden="true" /><span>使用</span>
                    </button>
                  ) : (
                    <button className="btn-ghost btn-xs" onClick={() => onLearnSkill?.(skill.id)} disabled={!onLearnSkill || !availability.ok} title={availability.reason ?? `消耗 ${skill.pointCost ?? 1} 技能点`}>
                      <BookOpen size={13} aria-hidden="true" /><span>学习</span>
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {(data.equipmentSlots?.length ?? 0) > 0 && (
          <section className="ability-module__section">
            <h5>装备槽</h5>
            {data.equipmentSlots!.map(slot => {
              const current = abilityState?.装备槽?.[slot.id] ?? [];
              const candidates = allNodes.filter(node => isOwned(node.id) && !equippedIds.has(node.id) && (!node.equipmentSlot || node.equipmentSlot === slot.id));
              return (
                <div className="ability-module__row" key={slot.id}>
                  <div className="ability-module__content">
                    <div className="ability-module__name"><strong>{slot.name}</strong><small>{current.length}/{Math.max(1, slot.capacity ?? 1)}</small></div>
                    {slot.description && <p>{slot.description}</p>}
                    {current.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{current.map(id => <button key={id} type="button" className="btn-ghost btn-xs" onClick={() => onUnequipAbility?.(id)} disabled={!onUnequipAbility} title="卸下能力"><span>{nodeById.get(id)?.name ?? id}</span><X size={10} /></button>)}</div>}
                  </div>
                  {current.length < Math.max(1, slot.capacity ?? 1) && candidates.length > 0 && <select aria-label={`装备到${slot.name}`} defaultValue="" onChange={event => { if (event.target.value) { onEquipAbility?.(event.target.value, slot.id); event.target.value = ''; } }} disabled={!onEquipAbility} style={{ minWidth: 0, maxWidth: 120 }}><option value="">装备…</option>{candidates.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select>}
                </div>
              );
            })}
          </section>
        )}

        {talents.length === 0 && skills.length === 0 && (
          <div className="ability-module__empty">这个世界尚未配置天赋或技能。</div>
        )}
      </div>
    </Collapsible>
  );
});
