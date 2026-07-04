// 内联骰子检定卡片 — 渲染在消息正文中的可交互骰子卡片
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Dice6 } from 'lucide-react';
import type { DiceRoll, StatModuleSchema } from '../../../modules/schema';
import { rollDice, getCheckableAttributes, calcModifier } from '../../../modules/xpAlgorithm';

interface InlineDiceCardProps {
  /** AI 指定的属性名（如 "力量"、"敏捷"） */
  attr: string;
  /** AI 指定的难度等级 */
  dc: number;
  /** 数值属性模块数据（用于获取可检定属性列表） */
  statData?: StatModuleSchema;
  /** 掷骰结果回调 */
  onRoll?: (roll: DiceRoll) => void;
}

export default function InlineDiceCard({ attr, dc, statData, onRoll }: InlineDiceCardProps) {
  const [animating, setAnimating] = useState(false);
  const [result, setResult] = useState<DiceRoll | null>(null);

  // 动态获取当前世界的可检定属性
  const checkableAttrs = useMemo(() => statData ? getCheckableAttributes(statData) : [], [statData]);

  // 根据属性名查找匹配（兼容 name 和 id 匹配）
  const initialAttr = useMemo(() => {
    if (!attr) return checkableAttrs[0]?.id || '';
    const found = checkableAttrs.find(a => a.name === attr || a.id === attr);
    return found?.id || checkableAttrs[0]?.id || '';
  }, [attr, checkableAttrs]);

  const [selectedAttr, setSelectedAttr] = useState(initialAttr);

  // 当 initialAttr 变化时同步（首次渲染后 statData 可能异步到达）
  useEffect(() => {
    if (initialAttr && !selectedAttr) {
      setSelectedAttr(initialAttr);
    }
  }, [initialAttr, selectedAttr]);

  const selectedAttrData = checkableAttrs.find(a => a.id === selectedAttr);
  const modifier = selectedAttrData ? calcModifier(selectedAttrData.value) : 0;

  const handleRoll = useCallback(() => {
    if (!selectedAttrData || animating) return;

    setAnimating(true);
    setTimeout(() => {
      const rollResult = rollDice(selectedAttrData.value, dc);
      const roll: DiceRoll = {
        attributeName: selectedAttrData.name,
        attributeValue: selectedAttrData.value,
        modifier: rollResult.modifier,
        d20: rollResult.d20,
        total: rollResult.total,
        dc,
        success: rollResult.success,
        isNatural20: rollResult.isNatural20,
        isNatural1: rollResult.isNatural1,
        timestamp: Date.now(),
      };
      setResult(roll);
      onRoll?.(roll);
      setAnimating(false);
    }, 300);
  }, [selectedAttrData, dc, animating, onRoll]);

  // 结果颜色
  const resultColor = result
    ? result.isNatural20 ? '#22c55e'
    : result.isNatural1 ? '#ef4444'
    : result.success ? 'var(--accent)'
    : 'var(--text-muted)'
    : undefined;

  return (
    <div className="inline-dice-card">
      {/* 头部 */}
      <div className="inline-dice-header">
        <Dice6 size={14} />
        <span>骰子检定</span>
        <span className="inline-dice-dc">DC {dc}</span>
      </div>

      {/* 操作区 */}
      <div className="inline-dice-controls">
        {checkableAttrs.length > 0 ? (
          <select
            className="inline-dice-select"
            value={selectedAttr}
            onChange={e => setSelectedAttr(e.target.value)}
          >
            {checkableAttrs.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.value})</option>
            ))}
          </select>
        ) : (
          <span className="inline-dice-no-attr">{attr || '无可用属性'}</span>
        )}

        {selectedAttrData && (
          <span className="inline-dice-modifier">
            修正 {modifier >= 0 ? '+' : ''}{modifier}
          </span>
        )}

        <button
          className="inline-dice-roll-btn"
          onClick={handleRoll}
          disabled={!selectedAttrData || animating}
        >
          {animating ? '🎲...' : '🎲 掷骰'}
        </button>
      </div>

      {/* 结果展示 */}
      {result && (
        <div className="inline-dice-result" style={{ borderLeftColor: resultColor }}>
          <div className="inline-dice-result-header">
            <span className="inline-dice-result-attr">{result.attributeName}检定</span>
            <span className="inline-dice-result-status" style={{ color: resultColor }}>
              {result.isNatural20 ? '🎉 大成功！' : result.isNatural1 ? '💀 大失败！' : result.success ? '成功 ✓' : '失败 ✗'}
            </span>
          </div>
          <div className="inline-dice-result-formula">
            d20(<strong>{result.d20}</strong>) + 修正({result.modifier >= 0 ? '+' : ''}{result.modifier}) = <strong>{result.total}</strong>
            {' '}vs DC{result.dc}
          </div>
        </div>
      )}
    </div>
  );
}
