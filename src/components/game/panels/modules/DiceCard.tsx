// 骰子检定卡片 — d20检定UI
import { useState, useCallback, memo } from 'react';
import { Dice6 } from 'lucide-react';
import type { DiceModuleSchema, DiceRoll, StatModuleSchema } from '../../../../modules/schema';
import { rollDice, getCheckableAttributes, calcModifier } from '../../../../modules/xpAlgorithm';
import { Collapsible } from '../../../shared/Collapsible';
import { DICE_DEFAULTS } from '../../../../modules/defaults';

interface DiceCardProps {
  data: DiceModuleSchema;
  /** 数值属性模块数据（用于获取可检定属性列表） */
  statData?: StatModuleSchema;
  /** 更新骰子数据的回调 */
  onUpdate?: (roll: DiceRoll) => void;
  /** 自定义标题（世界创建时设置的模块名称） */
  title?: string;
}

export default memo(function DiceCard({ data, statData, onUpdate, title }: DiceCardProps) {
  const [selectedAttr, setSelectedAttr] = useState<string>('');
  const [dc, setDc] = useState(DICE_DEFAULTS.defaultDC);
  const [animating, setAnimating] = useState(false);

  const checkableAttrs = statData ? getCheckableAttributes(statData) : [];

  const handleRoll = useCallback(() => {
    if (!selectedAttr || !statData) return;

    const attr = checkableAttrs.find(a => a.id === selectedAttr);
    if (!attr) return;

    setAnimating(true);

    // 掷骰动画延迟
    setTimeout(() => {
      const result = rollDice(attr.value, dc);
      const roll: DiceRoll = {
        attributeName: attr.name,
        attributeValue: attr.value,
        modifier: result.modifier,
        d20: result.d20,
        total: result.total,
        dc,
        success: result.success,
        isNatural20: result.isNatural20,
        isNatural1: result.isNatural1,
        timestamp: Date.now(),
      };

      onUpdate?.(roll);
      setAnimating(false);
    }, 300);
  }, [selectedAttr, dc, statData, checkableAttrs, onUpdate]);

  return (
    <Collapsible icon={<Dice6 size={15} />} title={title || '骰子检定'} defaultOpen={true}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* 操作区 */}
        {checkableAttrs.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={selectedAttr}
              onChange={e => setSelectedAttr(e.target.value)}
              style={{
                flex: 1, minWidth: '80px',
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: '6px', padding: '4px 8px', fontSize: 'var(--font-size-xs)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="">选择属性</option>
              {checkableAttrs.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.value})</option>
              ))}
            </select>
            <input
              type="number"
              value={dc}
              onChange={e => setDc(Number(e.target.value) || 10)}
              min={1}
              max={30}
              style={{
                width: '50px',
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: '6px', padding: '4px 6px', fontSize: 'var(--font-size-xs)',
                color: 'var(--text-primary)', textAlign: 'center',
              }}
              title="难度等级(DC)"
            />
            <button
              onClick={handleRoll}
              disabled={!selectedAttr || animating}
              className="btn-primary btn-xs"
              style={{
                background: animating ? 'var(--accent-dim)' : undefined,
                cursor: animating ? 'wait' : undefined,
                opacity: !selectedAttr ? 0.5 : 1,
              }}
            >
              {animating ? '🎲...' : '🎲 掷骰'}
            </button>
          </div>
        )}

        {/* 修正值预览 */}
        {selectedAttr && statData && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            修正值：{calcModifier(checkableAttrs.find(a => a.id === selectedAttr)?.value ?? 10) >= 0 ? '+' : ''}
            {calcModifier(checkableAttrs.find(a => a.id === selectedAttr)?.value ?? 10)}
          </div>
        )}

        {/* 最近一次结果 */}
        {data.lastRoll && (
          <DiceResult roll={data.lastRoll} />
        )}

        {/* 历史记录 */}
        {data.history && data.history.length > 1 && (
          <div style={{ marginTop: '4px' }}>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '4px' }}>历史记录</div>
            {data.history.slice(-5).reverse().map((roll, i) => (
              <DiceResult key={roll.timestamp + i} roll={roll} compact />
            ))}
          </div>
        )}
      </div>
    </Collapsible>
  );
});

function DiceResult({ roll, compact }: { roll: DiceRoll; compact?: boolean }) {
  const resultColor = roll.isNatural20 ? 'var(--success)' : roll.isNatural1 ? 'var(--danger)' : roll.success ? 'var(--accent)' : 'var(--text-muted)';

  if (compact) {
    return (
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', padding: '1px 0' }}>
        {roll.attributeName}：d20({roll.d20}) + {roll.modifier} = {roll.total} vs DC{roll.dc}
        {roll.success ? ' ✓' : ' ✗'}
      </div>
    );
  }

  return (
    <div style={{
      padding: '6px 8px', borderRadius: '6px',
      background: roll.isNatural20 ? 'var(--success-bg-soft)' : roll.isNatural1 ? 'var(--danger-bg-soft)' : 'var(--bg-tertiary)',
      border: `1px solid ${resultColor}30`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>
          {roll.attributeName}检定
        </span>
        <span style={{
          fontSize: 'var(--font-size-xs)', fontWeight: 600,
          color: resultColor,
        }}>
          {roll.success ? '成功 ✓' : '失败 ✗'}
        </span>
      </div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: '2px' }}>
        d20(<strong>{roll.d20}</strong>) + 修正({roll.modifier >= 0 ? '+' : ''}{roll.modifier}) = <strong>{roll.total}</strong>
        {' '}vs DC{roll.dc}
      </div>
      {roll.isNatural20 && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--success)', fontWeight: 600, marginTop: '2px' }}>
          🎉 大成功！
        </div>
      )}
      {roll.isNatural1 && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--danger)', fontWeight: 600, marginTop: '2px' }}>
          💀 大失败！
        </div>
      )}
    </div>
  );
}
