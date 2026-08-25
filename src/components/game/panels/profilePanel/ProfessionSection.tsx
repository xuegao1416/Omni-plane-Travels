import { useMemo, useState } from 'react';
import { GitBranch, Sparkles, Star } from 'lucide-react';
import type { ProfessionAbilityDef, ProfessionAbilityMechanics, ProfessionModuleSchema, StatModuleSchema } from '../../../../modules/schema';
import type { GameState } from '../../../../schema/variables';
import { describeProfessionAbilityMechanics, describeProfessionMechanics } from '../../../../gameplay/profession';
import { Collapsible } from '../../../shared/Collapsible';
import { DetailModal, DetailRow } from './shared';

const TYPE_LABEL: Record<ProfessionAbilityDef['type'], string> = {
  active: '主动能力',
  passive: '被动能力',
  specialization: '职业专精',
  ultimate: '终极能力',
};

type SelectedDetail =
  | { kind: 'ability'; ability: ProfessionAbilityDef; rank: number; uses: number }
  | { kind: 'talent'; name: string; description?: string; mechanics?: ProfessionAbilityMechanics; source: '先天天赋' | '后天觉醒' };

export function ProfessionSection({
  gameState,
  config,
  statConfig,
}: {
  gameState: GameState;
  config?: ProfessionModuleSchema;
  statConfig?: StatModuleSchema;
}) {
  const [selected, setSelected] = useState<SelectedDetail | null>(null);
  const runtime = gameState.玩家.能力系统?.职业状态;
  const profession = config?.professions.find(item => item.id === runtime?.职业ID);
  const unlocked = useMemo(() => Object.entries(runtime?.已解锁能力 ?? {}).map(([id, owned]) => ({
    id,
    owned,
    definition: profession?.abilities.find(item => item.id === id),
  })), [profession, runtime?.已解锁能力]);
  const innate = Object.entries(gameState.玩家.能力系统?.先天天赋 ?? {}).map(([id, value]) => ({
    id,
    name: value.名称,
    description: config?.innateTalents.find(item => item.id === id)?.description,
    mechanics: config?.innateTalents.find(item => item.id === id)?.mechanics,
    source: '先天天赋' as const,
  }));
  const awakened = Object.entries(gameState.玩家.能力系统?.后天天赋 ?? {}).map(([id, value]) => ({
    id,
    name: value.名称 || id,
    description: value.描述,
    mechanics: undefined,
    source: '后天觉醒' as const,
  }));
  const talents = [...innate, ...awakened];

  if (!runtime && talents.length === 0) return null;

  return (
    <>
      {runtime && (
        <Collapsible icon={<GitBranch size={15} />} title={`职业能力 · ${runtime.职业名称 || '无职业'}`} count={unlocked.length}>
          <div className="profile-profession-summary">
            <span>职业 Lv.{runtime.职业等级}</span>
            <span>可用能力点 {runtime.能力点}</span>
            <small>{runtime.职业ID ? '完整分支与可解锁节点请在“职业书”中查看。' : '当前角色未选择固定职业。'}</small>
          </div>
          {unlocked.length > 0 ? unlocked.map(({ id, owned, definition }) => {
            const ability: ProfessionAbilityDef = definition ?? {
              id,
              name: owned.名称 || id,
              description: '此能力来自旧存档；当前职业包中没有对应定义。',
              type: owned.类型 ?? 'passive',
            };
            return (
              <button
                type="button"
                key={id}
                className="profile-ability-row"
                onClick={() => setSelected({ kind: 'ability', ability, rank: owned.等级, uses: owned.使用次数 ?? 0 })}
              >
                <span><Sparkles size={12} />{ability.name}</span>
                <small>{TYPE_LABEL[ability.type]} · Lv.{owned.等级}</small>
              </button>
            );
          }) : runtime.职业ID ? (
            <p className="profile-profession-empty">尚未投入能力点。职业不是自由技能列表，解锁后才会出现在这里。</p>
          ) : null}
        </Collapsible>
      )}

      {talents.length > 0 && (
        <Collapsible icon={<Star size={15} />} title="天赋" count={talents.length} defaultOpen={false}>
          {talents.map(talent => (
            <button
              type="button"
              key={`${talent.source}:${talent.id}`}
              className="profile-ability-row"
              onClick={() => setSelected({ kind: 'talent', name: talent.name, description: talent.description, mechanics: talent.mechanics, source: talent.source })}
            >
              <span><Star size={12} />{talent.name}</span>
              <small>{talent.source}</small>
            </button>
          ))}
        </Collapsible>
      )}

      {selected?.kind === 'ability' && (
        <DetailModal title={selected.ability.name} onClose={() => setSelected(null)} icon={<GitBranch size={17} />}>
          <DetailRow label="归属" value={`${runtime?.职业名称 ?? '职业'} · ${TYPE_LABEL[selected.ability.type]}`} />
          <DetailRow label="等级" value={selected.rank} />
          <DetailRow label="使用次数" value={selected.uses} />
          <DetailRow label="描述" value={selected.ability.description} />
          {describeProfessionAbilityMechanics(selected.ability, statConfig, gameState) && (
            <DetailRow label="机制" value={describeProfessionAbilityMechanics(selected.ability, statConfig, gameState)} />
          )}
          {!!selected.ability.diceModifier && <DetailRow label="检定" value={`${selected.ability.diceModifier >= 0 ? '+' : ''}${selected.ability.diceModifier}`} />}
        </DetailModal>
      )}
      {selected?.kind === 'talent' && (
        <DetailModal title={selected.name} onClose={() => setSelected(null)} icon={<Star size={17} />}>
          <DetailRow label="来源" value={selected.source} />
          <DetailRow label="描述" value={selected.description || '暂无额外说明'} />
          {describeProfessionMechanics(selected.mechanics, statConfig) && <DetailRow label="机制" value={describeProfessionMechanics(selected.mechanics, statConfig)} />}
        </DetailModal>
      )}
    </>
  );
}
