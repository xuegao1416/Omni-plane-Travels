import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { NpcEquipmentView, EquipmentView, StatChip } from '../../../domains/equipment/viewModel';
import type { EquipmentSlotDef } from '../../../domains/equipment/slots';
import { getQualityColor } from '../../shared/qualityUtils';
import { SlotGlyph, type GlyphKind } from './slotGlyphs';
import { BonusChips, ItemGlyph, qualityStyle } from './ItemGlyph';
import '../../../ui/screens/game-equipment.css';

/**
 * 人物装备环：NPC 的头像居中，八个部位沿星环排开。穿着装备的部位在外环亮出一段品质色弧，
 * 点插槽在下方展开这件装备，并和主角同部位的装备比较加成。
 */
const SIZE = 320;
const C = SIZE / 2;
const RING = 122;
const ANGLES: Record<EquipmentSlotDef['code'], number> = {
  head: -90, accessory1: -45, weapon: 0, hands: 45, feet: 90, legs: 135, chest: 180, accessory2: 225,
};

function point(angle: number, radius: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [C + Math.cos(rad) * radius, C + Math.sin(rad) * radius];
}

function arc(angle: number, radius: number, spread = 15): string {
  const [x1, y1] = point(angle - spread, radius);
  const [x2, y2] = point(angle + spread, radius);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${radius} ${radius} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function glyphFor(slot: EquipmentSlotDef): GlyphKind {
  return slot.code === 'accessory2' ? 'accessory2' : slot.kind;
}

function compareChips(mine: StatChip[], theirs: StatChip[]): StatChip[] {
  const ids = [...new Set([...theirs.map(chip => chip.id), ...mine.map(chip => chip.id)])];
  return ids.flatMap(id => {
    const a = theirs.find(chip => chip.id === id);
    const b = mine.find(chip => chip.id === id);
    const value = Math.round(((a?.value ?? 0) - (b?.value ?? 0)) * 100) / 100;
    return value ? [{ id, name: (a ?? b)!.name, value, kind: (a ?? b)!.kind }] : [];
  });
}

export function NpcGearRing({ view, portrait, name, player }: {
  view: NpcEquipmentView;
  portrait: ReactNode;
  name: string;
  /** 主角的装备（用于同部位比较）；世界没有装备体系时不传。 */
  player?: EquipmentView;
}) {
  const [selected, setSelected] = useState<string | null>(() => view.slots.find(slot => slot.item)?.slot.key ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const ticks = useMemo(() => Array.from({ length: 48 }, (_, index) => {
    const [x1, y1] = point(index * 7.5, 150);
    const [x2, y2] = point(index * 7.5, index % 6 === 0 ? 142 : 146);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }).join(''), []);
  const current = view.slots.find(slot => slot.slot.key === selected && slot.item);
  const mine = current ? player?.slots.find(slot => slot.slot.key === current.slot.key) : undefined;
  const hot = hover ?? selected;

  return (
    <div className="eqr">
      <div className="eqr__stage">
        <svg className="eqr__art" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
          <circle className="eqr-ring eqr-ring--track" cx={C} cy={C} r={RING} />
          <circle className="eqr-ring eqr-ring--outer" cx={C} cy={C} r="150" />
          <path className="eqr-ring" d={ticks} strokeWidth="1" opacity=".35" />
          <circle className="eqr-ring eqr-ring--inner" cx={C} cy={C} r={RING} />
          <circle className="eqr-ring eqr-ring--inner" cx={C} cy={C} r="66" />
          <g className="eqr-orbit">
            {Array.from({ length: 6 }, (_, index) => {
              const [x, y] = point(index * 60 + 30, 136);
              return <circle key={index} cx={x} cy={y} r="1.6" />;
            })}
          </g>
          {view.slots.map(slot => {
            const angle = ANGLES[slot.slot.code];
            const [x1, y1] = point(angle, 66);
            const [x2, y2] = point(angle, RING - 27);
            const style = slot.item ? ({ '--q': getQualityColor(slot.item.品质 ?? '普通') } as CSSProperties) : undefined;
            return (
              <g key={slot.slot.key} style={style}>
                <line className="eqr-spoke" x1={x1} y1={y1} x2={x2} y2={y2} data-on={Boolean(slot.item) || undefined} data-hot={hot === slot.slot.key || undefined} />
                {slot.item && <path className="eqr-arc" d={arc(angle, 150)} />}
              </g>
            );
          })}
        </svg>
        <div className="eqr__portrait" aria-hidden="true">{portrait}</div>
        {view.slots.map(slot => {
          const [x, y] = point(ANGLES[slot.slot.code], RING);
          const item = slot.item;
          return (
            <button
              key={slot.slot.key}
              type="button"
              className="eqd__socket eqr__socket"
              style={{ left: `${(x / SIZE) * 100}%`, top: `${(y / SIZE) * 100}%`, ...(item ? { '--q': getQualityColor(item.品质 ?? '普通') } : {}) } as CSSProperties}
              data-filled={Boolean(item) || undefined}
              data-hot={hot === slot.slot.key || undefined}
              aria-pressed={selected === slot.slot.key}
              aria-label={item ? `${slot.slot.label}：${item.名称}` : `${slot.slot.label}：空`}
              title={item ? `${slot.slot.label} · ${item.名称}` : `${slot.slot.label} · 空`}
              onClick={() => setSelected(current => (current === slot.slot.key ? null : slot.slot.key))}
              onMouseEnter={() => setHover(slot.slot.key)}
              onMouseLeave={() => setHover(value => (value === slot.slot.key ? null : value))}
              onFocus={() => setHover(slot.slot.key)}
              onBlur={() => setHover(value => (value === slot.slot.key ? null : value))}
            >
              <SlotGlyph kind={glyphFor(slot.slot)} />
              <span className="eqd__socket-label">{item ? item.名称 : slot.slot.label}</span>
            </button>
          );
        })}
      </div>
      <p className="eq-hint" style={{ textAlign: 'center' }}>{name} · 穿戴 {view.worn} / {view.slots.length}</p>

      {current?.item && (
        <div className="eqr__card" style={qualityStyle(current.item.品质)} aria-live="polite">
          <ItemGlyph name={current.item.名称} item={current.item} glyph={glyphFor(current.slot)} size="lg" />
          <div>
            <h5>{current.item.名称}<small>{[current.slot.label, current.item.品质, current.item.类型 !== current.slot.label ? current.item.类型 : ''].filter(Boolean).join(' · ')}</small></h5>
            <BonusChips chips={current.bonuses} />
            {current.item.备注 && <p>{current.item.备注}</p>}
            {player && (current.item.属性加成 ? (
              <div className="eqr__compare">
                {mine?.item ? `与你的「${mine.item.名称}」相比：` : '你这个部位还空着，换上它会带来：'}
                <BonusChips chips={compareChips(mine?.bonuses ?? [], current.bonuses)} empty="加成相同" />
              </div>
            ) : <p className="eqr__compare">还看不出这件装备有什么门道。</p>)}
          </div>
        </div>
      )}

      {view.extras.length > 0 && (
        <div className="eqr__extras">
          <span className="eqr__label">其他随身装备</span>
          <span className="eq-chips">
            {view.extras.map((extra, index) => (
              <span key={`${extra.label}-${index}`} className="eq-chip eq-chip--quality" style={qualityStyle(extra.item.品质)} title={extra.item.备注 || extra.label}>
                {extra.label !== extra.item.名称 ? `${extra.label}：` : ''}{extra.item.名称}
              </span>
            ))}
          </span>
        </div>
      )}

      {view.totals.some(total => total.bonus !== 0) && (
        <div className="eqr__extras">
          <span className="eqr__label">装备加成</span>
          <BonusChips chips={view.totals.filter(total => total.bonus !== 0).map(total => ({ id: total.id, name: `${total.name} ${total.base}→${Math.round((total.base + total.bonus) * 100) / 100}`, value: total.bonus }))} />
        </div>
      )}
    </div>
  );
}
