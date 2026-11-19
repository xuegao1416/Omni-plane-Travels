// 内联骰子检定卡片：正文完成后交给本地骰子模块自动结算（种子随机、计入状态与天赋/职业加成），玩家不选择机械结果。
// 回合还在处理时暂不结算，回合结束后卡片重新挂载会再请求一次。
import { useEffect,useMemo,useRef,useState } from 'react';
import { CheckCircle2,Dices,Sparkles,XCircle } from 'lucide-react';
import type { DiceModuleSchema,DiceRoll,StatModuleSchema } from '../../../modules/schema';
import { resolveCheckableAttribute } from '../../../modules/xpAlgorithm';
import { createDiceRoll, type DiceRollRequest } from '../../../gameplay/modules/dice';
import { diceAttributeModifier } from '../../../domains/dice/module';
import { findStat } from '../../../domains/stats/module';
import JourneyCardShell from '../shared/JourneyCardShell';

interface InlineDiceCardProps {
  attr: string;
  dc: number;
  requestId: string;
  existingRoll?: DiceRoll;
  statData?: StatModuleSchema;
  diceData?: DiceModuleSchema;
  /** 交给骰子模块结算并提交；返回 null 表示暂时不能结算（例如回合还在处理）。未提供时只在本地预览。 */
  onRoll?: (request: DiceRollRequest) => DiceRoll | null;
}

export default function InlineDiceCard({
  attr,
  dc,
  requestId,
  existingRoll,
  statData,
  diceData = {},
  onRoll,
}: InlineDiceCardProps) {
  const [animating, setAnimating] = useState(!existingRoll);
  const [result, setResult] = useState<DiceRoll | null>(existingRoll ?? null);
  const [waiting, setWaiting] = useState(false);
  const startedRef = useRef(false);
  const selectedAttribute = useMemo(
    () => statData ? resolveCheckableAttribute(statData, attr) : undefined,
    [attr, statData],
  );
  const matchingBonuses = useMemo(() => selectedAttribute
    ? (diceData.runtimeBonuses ?? []).filter(bonus => !bonus.statIds?.length || bonus.statIds.some(statId => statId === selectedAttribute.id))
    : [], [diceData.runtimeBonuses, selectedAttribute]);

  useEffect(() => {
    if (existingRoll) {
      setResult(existingRoll);
      setAnimating(false);
      return undefined;
    }
    if (!selectedAttribute || startedRef.current) {
      setAnimating(false);
      return undefined;
    }
    startedRef.current = true;
    setAnimating(true);
    const timer = window.setTimeout(() => {
      const request: DiceRollRequest = {
        requestId,
        attributeId: selectedAttribute.id,
        attributeName: selectedAttribute.name,
        attributeValue: selectedAttribute.value,
        dc,
        timestamp: Date.now(),
        advantageMode: 'normal',
        bonuses: matchingBonuses,
      };
      const range = statData ? findStat(statData, selectedAttribute.id)?.range : undefined;
      const roll = onRoll
        ? onRoll(request)
        : createDiceRoll(diceData, { ...request, ...(range ? { attributeModifier: diceAttributeModifier(diceData, selectedAttribute.value, range) } : {}) });
      setAnimating(false);
      if (!roll) {
        setWaiting(true);
        return;
      }
      setResult(roll);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [dc, diceData, existingRoll, matchingBonuses, onRoll, requestId, selectedAttribute, statData]);

  const resultColor = result
    ? result.isNatural20 ? 'var(--success)'
      : result.isNatural1 ? 'var(--danger)'
        : result.success ? 'var(--accent)'
          : 'var(--text-muted)'
    : undefined;

  return (
    <JourneyCardShell className="game-journey-card--dice" label="自动检定" mode="panel">
      <div className="inline-dice-card">
        <div className="inline-dice-header">
          <Dices size={14} aria-hidden="true" />
          <span>{selectedAttribute?.name ?? (attr || '骰子')}检定</span>
          <span className="inline-dice-dc">DC {dc}</span>
        </div>

        <div className="inline-dice-body">
          <div className={`inline-dice-core${animating ? ' is-rolling' : ''}`} aria-hidden="true">
            <span className="inline-dice-core__value">{result?.d20 ?? 'D20'}</span>
            <Dices size={18} strokeWidth={1.4} />
          </div>
          <div className="inline-dice-controls">
            {selectedAttribute ? (
              <>
                <strong>{selectedAttribute.name}</strong>
                <span className="inline-dice-modifier">{selectedAttribute.semanticLabel ?? selectedAttribute.id} · 当前值 {selectedAttribute.value}</span>
                {matchingBonuses.length > 0 && <small>职业/天赋修正：{matchingBonuses.map(item => `${item.source} ${item.value >= 0 ? '+' : ''}${item.value}`).join('、')}</small>}
                <small>{animating ? '本地系统正在自动结算…' : waiting && !result ? '本回合处理完后自动结算。' : '本次检定已自动结算，结果不可手动改选。'}</small>
              </>
            ) : (
              <span className="inline-dice-no-attr">当前世界没有可用于“{attr}”的数值属性，未执行检定。</span>
            )}
          </div>
        </div>

        {result && (
          <div className="inline-dice-result" style={{ borderLeftColor: resultColor }}>
            <div className="inline-dice-result-header">
              <span className="inline-dice-result-attr">{result.attributeName}检定</span>
              <span className="inline-dice-result-status" style={{ color: resultColor }}>
                {result.isNatural20 ? <><Sparkles size={13} /> 大成功</> : result.isNatural1 ? <><XCircle size={13} /> 大失败</> : result.success ? <><CheckCircle2 size={13} /> 成功</> : <><XCircle size={13} /> 失败</>}
              </span>
            </div>
            <div className="inline-dice-result-formula">
              d20(<strong>{result.d20}</strong>) + 属性修正({result.modifier >= 0 ? '+' : ''}{result.modifier}) = <strong>{result.total}</strong> vs DC{result.dc}
            </div>
          </div>
        )}
      </div>
    </JourneyCardShell>
  );
}
