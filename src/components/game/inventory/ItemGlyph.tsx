import type { CSSProperties } from 'react';
import { Lock } from 'lucide-react';
import { getItemIcon } from '../../shared/itemIcons';
import { getQualityColor } from '../../shared/qualityUtils';
import { bagSize } from '../../../domains/inventory/capacity';
import { itemSlotKind } from '../../../domains/equipment/slots';
import { SlotGlyph, type GlyphKind } from './slotGlyphs';

type ItemLike = { 类型?: string; 品质?: string; 装备部位?: string; 扩容?: number; 属性加成?: unknown };

/** 物品用哪个图标：装备按部位、背包用背包，其余按类型（lucide）。 */
export function ItemIcon({ name, item, glyph, className }: { name: string; item?: ItemLike; glyph?: GlyphKind; className?: string }) {
  const kind: GlyphKind | undefined = glyph ?? (bagSize(name, item as never) > 0 ? 'bag' : itemSlotKind(name, item as never));
  if (kind) return <SlotGlyph kind={kind} className={className} />;
  const Icon = getItemIcon(item ?? {});
  return <Icon className={className} strokeWidth={1.7} aria-hidden="true" />;
}

export function qualityStyle(quality: string | undefined, extra?: CSSProperties): CSSProperties {
  return { '--q': getQualityColor(quality ?? '普通'), ...extra } as CSSProperties;
}

/** 珐琅底的物品徽记。sealed：幕后内容，角色还不知道是什么。 */
export function ItemGlyph({ name, item, glyph, size = 'md', sealed }: { name: string; item?: ItemLike; glyph?: GlyphKind; size?: 'sm' | 'md' | 'lg'; sealed?: boolean }) {
  return (
    <span className={`eq-glyph${size !== 'md' ? ` eq-glyph--${size}` : ''}${sealed ? ' eq-glyph--sealed' : ''}`} style={qualityStyle(item?.品质)} aria-hidden="true">
      {sealed ? <Lock strokeWidth={1.7} /> : <ItemIcon name={name} item={item} glyph={glyph} />}
    </span>
  );
}

/** 「膂力 +3」这样的加成标签；sign 决定颜色。 */
export function BonusChips({ chips, empty }: { chips: Array<{ id: string; name: string; value: number; kind?: string }>; empty?: string }) {
  if (!chips.length) return empty ? <span className="eq-hint">{empty}</span> : null;
  return (
    <span className="eq-chips">
      {chips.map(chip => (
        <span key={chip.id} className="eq-chip" data-sign={chip.value > 0 ? 'up' : 'down'}>
          {chip.name}{chip.kind === 'vital' ? '上限' : ''}<b>{chip.value > 0 ? '+' : ''}{chip.value}</b>
        </span>
      ))}
    </span>
  );
}
