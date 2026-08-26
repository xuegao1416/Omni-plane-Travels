import { useEffect, useRef, useState } from 'react';
import { BookOpen, Dices, Library, Shield, Sparkles, X } from 'lucide-react';
import type { ProfessionModuleSchema } from '../../modules/schema';
import type { PlayerProfile } from '../../storage/db';
import { validateProfessionSelection } from '../../gameplay/profession';
import {
  CREATION_MAX_DRAWS,
  computeCreationSpending,
  creationDrawCost,
  drawRandomTalent,
  isDivineTalent,
  talentDirectCost,
} from '../../gameplay/creation/creationPoints';
import { professionEmblemSrc, resolveProfessionVisual } from '../../data/professions/professionVisuals';
import { EntrySlicedButton } from './EntrySurface';
import ProfessionTarotOverlay from './professionTarot/ProfessionTarotOverlay';
import StepAbilityAlloc from './StepAbilityAlloc';
import TalentCodexOverlay, { TalentGlyph } from './TalentCodexOverlay';
import useCreationAllocations from './useCreationAllocations';

interface StepProfessionTalentsProps {
  config: ProfessionModuleSchema;
  personalInfo: PlayerProfile;
  setPersonalInfo: (profile: PlayerProfile) => void;
  statConfig?: Record<string, unknown>;
  pointScale: number;
  onOpenProfessionLibrary?: () => void;
  onModalStateChange?: (open: boolean) => void;
}

export default function StepProfessionTalents({
  config,
  personalInfo,
  setPersonalInfo,
  statConfig,
  pointScale,
  onOpenProfessionLibrary,
  onModalStateChange,
}: StepProfessionTalentsProps) {
  const [tarotOpen, setTarotOpen] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const [drawResultId, setDrawResultId] = useState<string | null>(null);
  const [drawNotice, setDrawNotice] = useState('');
  const drawTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const professionId = personalInfo.professionId ?? null;
  const talentIds = personalInfo.innateTalentIds ?? [];
  const drawnTalentIds = personalInfo.creationDrawnTalentIds ?? [];
  const drawCount = personalInfo.creationDrawCount ?? 0;
  const selectedProfession = config.professions.find(item => item.id === professionId);
  const drawResult = config.innateTalents.find(talent => talent.id === drawResultId);
  const spending = computeCreationSpending(config, {
    riskMode: personalInfo.combatRiskMode ?? 'normal',
    pointScale,
    talentIds,
    drawnTalentIds,
    drawCount,
    allocations: personalInfo.creationPointAllocations ?? {},
  });
  const structureValidation = validateProfessionSelection(
    config,
    professionId,
    talentIds,
    Number.MAX_SAFE_INTEGER,
  );
  const drawCost = creationDrawCost(pointScale);
  const { allocations, applyAllocations } = useCreationAllocations({
    personalInfo,
    setPersonalInfo,
    statConfig,
  });

  useEffect(() => {
    onModalStateChange?.(tarotOpen || codexOpen);
    return () => onModalStateChange?.(false);
  }, [codexOpen, onModalStateChange, tarotOpen]);

  useEffect(() => () => {
    if (drawTimerRef.current) clearTimeout(drawTimerRef.current);
  }, []);

  const chooseProfession = (id: string | null) => {
    const profession = config.professions.find(item => item.id === id);
    setPersonalInfo({ ...personalInfo, professionId: id, career: profession?.name ?? '' });
  };

  const removeTalent = (id: string) => {
    setPersonalInfo({
      ...personalInfo,
      innateTalentIds: talentIds.filter(item => item !== id),
      creationDrawnTalentIds: drawnTalentIds.filter(item => item !== id),
    });
  };

  const toggleTalent = (id: string) => {
    if (talentIds.includes(id)) {
      removeTalent(id);
      return;
    }
    const talent = config.innateTalents.find(item => item.id === id);
    if (!talent || isDivineTalent(talent)) return;
    const candidate = validateProfessionSelection(
      config,
      professionId,
      [...talentIds, id],
      Number.MAX_SAFE_INTEGER,
    );
    if (!candidate.ok || spending.remaining < talentDirectCost(talent.cost, pointScale)) return;
    setPersonalInfo({ ...personalInfo, innateTalentIds: [...talentIds, id] });
  };

  const handleDraw = () => {
    if (drawCount >= CREATION_MAX_DRAWS || spending.remaining < drawCost) return;
    const talent = drawRandomTalent(config.innateTalents, talentIds);
    if (!talent) {
      setDrawNotice('牌库中已没有符合前置与互斥规则的天赋。');
      return;
    }
    setDrawNotice('');
    setPersonalInfo({
      ...personalInfo,
      innateTalentIds: [...talentIds, talent.id],
      creationDrawnTalentIds: [...new Set([...drawnTalentIds, talent.id])],
      creationDrawCount: drawCount + 1,
    });
    setDrawResultId(talent.id);
    if (drawTimerRef.current) clearTimeout(drawTimerRef.current);
    drawTimerRef.current = setTimeout(() => {
      drawTimerRef.current = null;
      setDrawResultId(null);
    }, 2000);
  };

  const maxTier = selectedProfession
    ? Math.max(1, ...selectedProfession.abilities.map(ability => ability.tier ?? 1))
    : 0;
  const visual = selectedProfession ? resolveProfessionVisual(selectedProfession) : null;
  const drawDisabled = drawCount >= CREATION_MAX_DRAWS || spending.remaining < drawCost;
  const drawTitle = drawCount >= CREATION_MAX_DRAWS
    ? `命运之牌已抽尽（${CREATION_MAX_DRAWS}/${CREATION_MAX_DRAWS}）`
    : spending.remaining < drawCost
      ? `还需要 ${drawCost} 点降临点数`
      : '抽取一项尚未拥有且满足规则的先天天赋';

  return (
    <div className="profession-creation-step profession-creation-step--v2">
      <header className="profession-creation-step__header">
        <span>第二步 · 道路与命格</span>
        <h2>职业与先天天赋</h2>
        <p>先翻开命运之牌确定道路，再把同一池降临点数分配给属性、直选天赋或命运抽卡。</p>
      </header>

      <section className="tarot-stage" aria-label="职业展示台">
        <div className="tarot-stage__card" data-accent={visual?.accentKey ?? 'silver'}>
          <span className="tarot-stage__emblem">
            {visual
              ? <img src={professionEmblemSrc(visual.emblemKey)} alt="" aria-hidden="true" />
              : <Shield size={42} strokeWidth={1.25} aria-hidden="true" />}
          </span>
          <div>
            <small>当前道路</small>
            <strong>{selectedProfession?.name ?? (professionId === null ? '无职者' : '尚未翻开命运之牌')}</strong>
            <p>{selectedProfession?.description ?? '不依附固定职业树，以自由技能与先天禀赋书写旅途。'}</p>
            {selectedProfession && (
              <span className="tarot-stage__tiers" aria-label={`${maxTier} 阶成长`}>
                {[1, 2, 3, 4].map(tier => <i key={tier} className={tier <= maxTier ? 'is-filled' : ''}>{tier}</i>)}
              </span>
            )}
          </div>
        </div>
        <div className="tarot-stage__actions">
          <EntrySlicedButton frame="dawn-v4-compact" tone="primary" icon={Sparkles} onClick={() => setTarotOpen(true)}>
            翻开职业牌阵
          </EntrySlicedButton>
          {config.allowNoProfession !== false && professionId !== null && (
            <button type="button" className="tarot-stage__free-path" onClick={() => chooseProfession(null)}>维持无职者之道</button>
          )}
        </div>
      </section>

      {statConfig && (
        <StepAbilityAlloc
          statConfig={statConfig}
          allocations={allocations}
          poolRemaining={spending.remaining}
          onChange={applyAllocations}
        />
      )}

      <section className="talent-forge" aria-label="先天天赋">
        <header className="talent-forge__heading">
          <span><Sparkles size={16} aria-hidden="true" /><strong>先天天赋 · 熔铸</strong></span>
          <span className="talent-forge__pool">剩余降临点数 <strong>{spending.remaining}</strong> / {spending.pool}</span>
        </header>

        <div className="talent-forge__chips" aria-label="已选先天天赋">
          {talentIds.map(id => {
            const talent = config.innateTalents.find(item => item.id === id);
            if (!talent) return (
              <span className="talent-chip is-missing" key={id}>
                <Sparkles className="talent-chip__icon is-fallback" size={18} aria-hidden="true" />
                <strong>已失效天赋</strong>
                <em>职业包已变更</em>
                <button type="button" aria-label={`移除失效天赋${id}`} title="移除失效天赋" onClick={() => removeTalent(id)}><X size={13} /></button>
              </span>
            );
            const drawn = drawnTalentIds.includes(id);
            const divine = isDivineTalent(talent);
            return (
              <span className={`talent-chip${divine ? ' is-divine' : ''}${drawn ? ' is-drawn' : ''}`} key={id}>
                <TalentGlyph talent={talent} contextId={professionId ?? id} className="talent-chip__icon" />
                <strong>{talent.name}</strong>
                <em>{drawn ? '命运' : `${talentDirectCost(talent.cost, pointScale)} 点`}</em>
                <button type="button" aria-label={`移除${talent.name}`} title={`移除${talent.name}`} onClick={() => removeTalent(id)}><X size={13} /></button>
              </span>
            );
          })}
          {talentIds.length === 0 && <p>尚未熔铸天赋；也可以保留全部点数用于属性。</p>}
        </div>

        <div className="talent-forge__actions">
          <button type="button" onClick={() => setCodexOpen(true)}><BookOpen size={14} />查阅天赋全典</button>
          <button type="button" className="talent-forge__draw" onClick={handleDraw} disabled={drawDisabled} title={drawTitle}>
            <Dices size={15} />命运抽卡（{drawCount}/{CREATION_MAX_DRAWS}）· {drawCost} 点
          </button>
          <button type="button" onClick={onOpenProfessionLibrary} disabled={!onOpenProfessionLibrary}><Library size={14} />天赋包工坊</button>
        </div>

        {drawResult && (
          <div className={`talent-draw-result${isDivineTalent(drawResult) ? ' is-divine' : ''}`} role="status">
            <TalentGlyph talent={drawResult} contextId={professionId ?? drawResult.id} className="talent-draw-result__icon" />
            <span><small>命运翻开</small><strong>{drawResult.name}</strong><em>{drawResult.rarity ?? '普通'}</em></span>
          </div>
        )}
        {drawNotice && <p className="profession-creation-step__notice" role="status">{drawNotice}</p>}
        {!structureValidation.ok && <p className="profession-creation-step__error" role="status">{structureValidation.reason}</p>}
        {!spending.ok && <p className="profession-creation-step__error" role="status">{spending.reason}</p>}
      </section>

      {tarotOpen && (
        <ProfessionTarotOverlay
          professions={config.professions}
          selectedId={professionId}
          allowNoProfession={config.allowNoProfession !== false}
          onConfirm={id => { chooseProfession(id); setTarotOpen(false); }}
          onClose={() => setTarotOpen(false)}
        />
      )}
      {codexOpen && (
        <TalentCodexOverlay
          config={config}
          talentIds={talentIds}
          drawnTalentIds={drawnTalentIds}
          remaining={spending.remaining}
          directCost={talent => talentDirectCost(talent.cost, pointScale)}
          onSelect={toggleTalent}
          onClose={() => setCodexOpen(false)}
        />
      )}
    </div>
  );
}
