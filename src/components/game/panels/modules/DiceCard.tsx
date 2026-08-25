// 骰子检定只在正文中自动触发；侧栏仅提供只读记录。
import { memo } from 'react';
import { Dice6, Sparkles, XCircle } from 'lucide-react';
import type { DiceModuleSchema, DiceRoll } from '../../../../modules/schema';
import { Collapsible } from '../../../shared/Collapsible';

interface DiceCardProps {
  data: DiceModuleSchema;
  title?: string;
}

export default memo(function DiceCard({ data, title }: DiceCardProps) {
  const history = data.history ?? [];
  return (
    <Collapsible icon={<Dice6 size={15} />} title={title || '检定记录'} defaultOpen={false}>
      {data.lastRoll ? (
        <>
          <DiceResult roll={data.lastRoll} />
          {history.length > 1 && (
            <div style={{ marginTop: 6 }}>
              {history.slice(-5, -1).reverse().map((roll, index) => <DiceResult key={`${roll.timestamp}-${index}`} roll={roll} compact />)}
            </div>
          )}
          <p style={{ margin: '7px 0 0', color: 'var(--text-muted)', fontSize: '10px' }}>检定由正文情境自动触发并结算，属性、难度和修正不可在这里手动改选。</p>
        </>
      ) : <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>尚未发生需要判定的行动。</div>}
    </Collapsible>
  );
});

function DiceResult({ roll, compact }: { roll: DiceRoll; compact?: boolean }) {
  const resultColor = roll.isNatural20 ? 'var(--success)' : roll.isNatural1 ? 'var(--danger)' : roll.success ? 'var(--accent)' : 'var(--text-muted)';
  const margin = roll.total - roll.dc;
  const tier = roll.isNatural20 ? '大成功' : roll.isNatural1 ? '大失败' : margin >= 10 ? '卓越成功' : margin >= 0 ? '成功' : margin >= -4 ? '险些成功' : '失败';
  if (compact) return <div style={{ padding: '2px 0', color: 'var(--text-muted)', fontSize: '10px' }}>{roll.attributeName}：{roll.total} / DC{roll.dc} · {tier}</div>;
  return (
    <div style={{ padding: '7px 8px', border: `1px solid color-mix(in srgb, ${resultColor} 30%, var(--border))`, borderRadius: 6, background: 'var(--bg-tertiary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: resultColor, fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
        <span>{roll.attributeName}检定</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{roll.isNatural20 || margin >= 10 ? <Sparkles size={12} /> : !roll.success ? <XCircle size={12} /> : null}{tier}</span>
      </div>
      <div style={{ marginTop: 3, color: 'var(--text-secondary)', fontSize: '10px' }}>d20({roll.d20}) + {roll.modifier >= 0 ? '+' : ''}{roll.modifier} = {roll.total} vs DC{roll.dc}</div>
      {!!roll.bonuses?.length && <div style={{ marginTop: 2, color: 'var(--text-muted)', fontSize: '9px' }}>修正来源：{roll.bonuses.map(item => `${item.source} ${item.value >= 0 ? '+' : ''}${item.value}`).join('、')}</div>}
    </div>
  );
}
