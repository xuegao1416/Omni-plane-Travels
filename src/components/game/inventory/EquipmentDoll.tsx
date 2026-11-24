import { useId, useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import type { EquipmentSlotDef, SlotKind } from '../../../domains/equipment/slots';
import type { EquipmentSlotView, EquipmentView, StatTotalView } from '../../../domains/equipment/viewModel';
import { getQualityColor } from '../../shared/qualityUtils';
import { SlotGlyph, type GlyphKind } from './slotGlyphs';
import { DRAG_ITEM, DRAG_SLOT } from './InventoryPack';
import '../../../ui/screens/game-equipment.css';

/**
 * 星仪人偶：主角的纸娃娃。整幅画由代码绘制（SVG 星盘、8 头身人形、引线），
 * 八个部位插槽是叠在画上的按钮：点开看装备 / 挑选可换的物品，桌面端还能从行囊拖进来、拖回行囊卸下。
 * 穿上的装备按品质颜色画在人形上（头盔、衣甲、护手、腿甲、靴子、项链、戒指、佩剑），
 * 悬停或选中时连同引线一起高亮；空着的部位悬停时显示虚线轮廓。
 */
const W = 360;
const H = 400;
const SOCKET_R = 30.6;

type Code = EquipmentSlotDef['code'];

interface Geo { x: number; y: number; ax: number; ay: number }

const GEO: Record<Code, Geo> = {
  head: { x: 46, y: 62, ax: 163, ay: 41 },
  chest: { x: 46, y: 152, ax: 128, ay: 104 },
  legs: { x: 46, y: 262, ax: 151.6, ay: 246 },
  feet: { x: 46, y: 350, ax: 147.6, ay: 357 },
  accessory1: { x: 314, y: 62, ax: 184.2, ay: 97.4 },
  weapon: { x: 314, y: 152, ax: 259.6, ay: 152 },
  hands: { x: 314, y: 242, ax: 236.4, ay: 178 },
  accessory2: { x: 314, y: 332, ax: 239.2, ay: 214 },
};

/** 左右对称的部分只画右半边（观者右侧），左边用这个变换镜像。 */
const MIRROR = 'matrix(-1 0 0 1 360 0)';

/** 人形（8 头身）：颈、躯干、双腿与脚是一笔轮廓；手臂、头、头发分开画，盖在躯干上。 */
const FIGURE = {
  body: 'M187.5 62C188 68 188.4 73 190.2 76.2C194.6 79.6 206.5 82.8 214 84.6C219.5 86 222.6 89.5 222.8 94.5C223 100 217 103.8 212.2 106.4C212.8 116 211.8 126 209.3 136C207.4 142.5 205.8 147.5 205.2 152.5C205 160.5 208.3 167.5 210.6 175.5C212.6 184.5 213.2 194.5 212.6 204.5C212 222 209.6 240 207.2 254C206.5 259 206.6 263.5 207.3 268C209.1 278 210.4 288 209.4 298C208.4 312 204.4 326 202.3 338C201.8 341.5 202.2 344.5 203 347C205.6 351 210 354.2 212.6 357.2C215 360.2 213.6 363.6 209.8 363.6L189.6 363.6C187.2 363.6 186.2 361.2 187 358.4C187.8 354.6 188.7 350 189.2 345.6C189.6 336 189.1 324 189.4 312C189.7 300 191.2 288 190.4 278C189.6 270.5 188.6 263.5 189.2 256.5C190.8 248.5 191 238.5 189 226.5C187.6 214.5 184.6 204.5 181.2 197.4C180.6 196.6 179.4 196.6 178.8 197.4C175.4 204.5 172.4 214.5 171 226.5C169 238.5 169.2 248.5 170.8 256.5C171.4 263.5 170.4 270.5 169.6 278C168.8 288 170.3 300 170.6 312C170.9 324 170.4 336 170.8 345.6C171.3 350 172.2 354.6 173 358.4C173.8 361.2 172.8 363.6 170.4 363.6L150.2 363.6C146.4 363.6 145 360.2 147.4 357.2C150 354.2 154.4 351 157 347C157.8 344.5 158.2 341.5 157.7 338C155.6 326 151.6 312 150.6 298C149.6 288 150.9 278 152.7 268C153.4 263.5 153.5 259 152.8 254C150.4 240 148 222 147.4 204.5C146.8 194.5 147.4 184.5 149.4 175.5C151.7 167.5 155 160.5 154.8 152.5C154.2 147.5 152.6 142.5 150.7 136C148.2 126 147.2 116 147.8 106.4C143 103.8 137 100 137.2 94.5C137.4 89.5 140.5 86 146 84.6C153.5 82.8 165.4 79.6 169.8 76.2C171.6 73 172 68 172.5 62Z',
  arm: 'M204 81.8C210.5 82.6 217.6 83.6 223.4 87.8C228.6 91.6 231 99.6 230.8 108.6C230.8 120 231.8 131 232.4 141C232.7 146 233.2 150 234 155C235.7 163 236.1 172 235.2 181C234.6 187 234.2 191 234.3 195C235 201 235.7 207 235.2 212.5C234.6 218 232.4 222.8 228.8 224.8C226.2 226.2 223.6 225.4 223.1 222.4C222.6 218.6 223.4 213 223.9 208.6C223.2 210.8 222.6 212.8 221.6 213.4C220.4 214 219.6 212.6 219.7 210.6C219.9 206 221.4 201 223.6 197.4C224.2 195.2 224.4 193 224.5 190.5C224.8 182.5 222.8 172.5 221.2 162.5C220.5 157.5 220 153.5 219.8 150.5C219 140 217 128 214.6 118C213.8 113.5 212.4 109.5 211.1 106.6C209 98.5 206 90 204 81.8Z',
  head: 'M180 26C188.6 26 195 32.4 195 42C195 43 194.9 44.2 194.7 45C196.6 44.3 197.9 45.4 197.6 48.2C197.3 51.6 196.3 54.6 194.3 55.6C193.4 60.4 190.4 64.8 186.4 67.2C184.4 68.2 182.2 68.7 180 68.7C177.8 68.7 175.6 68.2 173.6 67.2C169.6 64.8 166.6 60.4 165.7 55.6C163.7 54.6 162.7 51.6 162.4 48.2C162.1 45.4 163.4 44.3 165.3 45C165.1 44.2 165 43 165 42C165 32.4 171.4 26 180 26Z',
  hair: 'M164 46.5C162.4 37 165.4 27.6 173.4 24.6C177.6 23.1 182.4 23.1 186.6 24.6C194.6 27.6 197.6 37 196 46.5C194.8 46.5 194 46 193.6 45.2C193 41.2 191 38.8 188 37.6C185.4 36.6 182.8 36.2 180 36.2C177.2 36.2 174.6 36.6 172 37.6C169 38.8 167 41.2 166.4 45.2C166 46 165.2 46.5 164 46.5Z',
  /** 发缝、锁骨、胸线、腹中线、肚脐、腹股沟、膝盖：只画几笔，让人形有体积。 */
  anatomy: 'M176.4 25.4C177.8 29 178.4 32.6 178.2 36.2M184 25.2C189.2 27.8 192.6 32.6 193.6 39.2M176.6 85.2C169.4 83.6 160.6 84.4 151.6 87.4M183.4 85.2C190.6 83.6 199.4 84.4 208.4 87.4M178.4 86.4Q180 88 181.6 86.4M181.4 113.4C188.6 117.8 198.4 117.4 206.2 110.4M178.6 113.4C171.4 117.8 161.6 117.4 153.8 110.4M180 99V145M178.8 150.8Q180 152.6 181.2 150.8M203.4 163.6C198.4 174.6 191.4 184.6 184.4 192.2M156.6 163.6C161.6 174.6 168.6 184.6 175.6 192.2M194 264.5Q198.6 268.6 203.4 264.5M166 264.5Q161.4 268.6 156.6 264.5',
};

/** 各部位的装备形状，贴着人形轮廓略放大一圈：空着时不显示，穿上后按品质着色。 */
const GEAR = {
  head: 'M162.6 49C160.6 37.6 164.2 26.8 172.6 22.8C177.4 20.8 182.6 20.8 187.4 22.8C195.8 26.8 199.4 37.6 197.4 49C196 49.2 194.8 48.4 194.2 47C193.6 42 191.4 38.4 188 36.8C185.6 35.7 182.8 35.2 180 35.2C177.2 35.2 174.4 35.7 172 36.8C168.6 38.4 166.4 42 165.8 47C165.2 48.4 164 49.2 162.6 49Z',
  chest: 'M171.2 77.6C174.6 83.6 177.4 88.4 180 92.4C182.6 88.4 185.4 83.6 188.8 77.6C196.4 80.8 207.4 82.6 214.4 84C221.2 84.8 228.6 89.4 231.8 97.4C233.6 102.2 233.8 108 232.6 113.6C228.2 115.6 222 114.8 216.2 111.8C214.2 110.6 213 109 212.2 107.6C212.8 117 211.8 126.6 209.4 136.4C207.6 142.6 206 147.6 205.6 153C205.4 158.8 206.6 163.2 208.2 167.4C199.6 171.2 189.8 173.8 180 175.6C170.2 173.8 160.4 171.2 151.8 167.4C153.4 163.2 154.6 158.8 154.4 153C154 147.6 152.4 142.6 150.6 136.4C148.2 126.6 147.2 117 147.8 107.6C147 109 145.8 110.6 143.8 111.8C138 114.8 131.8 115.6 127.4 113.6C126.2 108 126.4 102.2 128.2 97.4C131.4 89.4 138.8 84.8 145.6 84C152.6 82.6 163.6 80.8 171.2 77.6Z',
  legs: 'M154.4 157.6C166 160.4 194 160.4 205.6 157.6C205.6 161.6 208.6 168 211 175.8C213 184.6 213.6 194.6 213 204.6C212.4 222 210 240 207.6 254C206.9 259 207 263.5 207.7 268C209.5 278 210.8 288 209.8 298C209.2 306.4 208 312.6 206.8 318.6L188.9 318.6C188.7 315.4 188.8 313.6 189 312C189.3 300 190.8 288 190 278C189.2 270.5 188.2 263.5 188.8 256.5C190.4 248.5 190.6 238.5 188.6 226.5C187.2 214.6 184.4 204.8 181 197.8C180.6 197.2 179.4 197.2 179 197.8C175.6 204.8 172.8 214.6 171.4 226.5C169.4 238.5 169.6 248.5 171.2 256.5C171.8 263.5 170.8 270.5 170 278C169.2 288 170.7 300 171 312C171.2 313.6 171.3 315.4 171.1 318.6L153.2 318.6C152 312.6 150.8 306.4 150.2 298C149.2 288 150.5 278 152.3 268C153 263.5 153.1 259 152.4 254C150 240 147.6 222 147 204.6C146.4 194.6 147 184.6 149 175.8C151.4 168 154.4 161.6 154.4 157.6Z',
  /** 右脚的靴子，左脚镜像。 */
  boot: 'M188.6 311.6L208.4 311.6C207.6 320 205.2 329.6 203.2 338C202.8 341.6 203.2 344.4 204 346.6C206.6 350.6 211 353.8 213.6 356.8C216.2 360 214.8 364.6 210.2 364.6L189.2 364.6C186.4 364.6 185.2 361.4 186.1 358.2C186.9 354.4 187.9 349.8 188.3 345.4C188.7 336 188.2 324 188.6 311.6Z',
  /** 右手的护手（小臂中段到指尖），左手镜像。 */
  glove: 'M219.8 163.6L237.4 163.6C236.8 171.6 236.6 177.6 235.9 182C235.3 187.4 234.9 191.2 235 195C235.8 201 236.5 207 236 212.6C235.4 218.4 233 223.6 229.1 225.7C226 227.3 222.8 226.2 222.3 222.6C221.8 218.6 222.6 213.4 223.1 209.6C222.4 211.6 221.8 213.4 221.4 214.1C220 214.9 218.8 213.4 218.9 210.8C219 205.8 220.6 200.8 222.9 197.2C223.5 195 223.6 192.6 223.7 190.4C224 184.2 222.2 174.6 219.8 163.6Z',
};

const STARS: Array<[number, number, number]> = [
  [34, 118, 1.2], [92, 28, .9], [118, 330, 1.1], [326, 108, 1], [268, 30, 1.3], [300, 290, .9],
  [62, 214, .8], [336, 200, 1.1], [244, 376, .9], [24, 300, 1], [150, 384, .8], [210, 22, .9],
];

function ticksPath(): string {
  const out: string[] = [];
  for (let index = 0; index < 72; index++) {
    const angle = (index / 72) * Math.PI * 2;
    const inner = index % 6 === 0 ? 162 : 167;
    out.push(`M${(180 + Math.cos(angle) * inner).toFixed(1)} ${(200 + Math.sin(angle) * inner).toFixed(1)}L${(180 + Math.cos(angle) * 172).toFixed(1)} ${(200 + Math.sin(angle) * 172).toFixed(1)}`);
  }
  return out.join('');
}

function orbitGlyphs(): string {
  return Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2 + Math.PI / 8;
    const x = 180 + Math.cos(angle) * 156;
    const y = 200 + Math.sin(angle) * 156;
    return `M${x.toFixed(1)} ${(y - 4).toFixed(1)}l3 4-3 4-3-4z`;
  }).join('');
}

function linkPath(code: Code): string {
  const geo = GEO[code];
  const left = geo.x < W / 2;
  const startX = geo.x + (left ? SOCKET_R : -SOCKET_R);
  const bend = startX + (left ? 20 : -20);
  return `M${startX} ${geo.y}H${bend}L${geo.ax} ${geo.ay}`;
}

function glyphFor(slot: EquipmentSlotDef): GlyphKind {
  return slot.code === 'accessory2' ? 'accessory2' : slot.kind;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export interface EquipmentDollProps {
  view: EquipmentView;
  /** 当前选中的部位（详情浮层打开时高亮）。 */
  activeSlot?: string | null;
  onSlotClick?: (slot: EquipmentSlotView) => void;
  /** 正在从行囊拖动的物品能穿在哪类部位（高亮能放下的插槽）。 */
  dragKind?: SlotKind | null;
  onDropItem?: (itemKey: string, slotKey: string) => void;
  /** 从插槽拖出装备（拖回行囊即卸下）。 */
  onDragSlot?: (slotKey: string | null) => void;
  readOnly?: boolean;
}

export function EquipmentDoll({ view, activeSlot, onSlotClick, dragKind, onDropItem, onDragSlot, readOnly }: EquipmentDollProps) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const ticks = useMemo(ticksPath, []);
  const orbit = useMemo(orbitGlyphs, []);
  const byCode = Object.fromEntries(view.slots.map(slot => [slot.slot.code, slot])) as Record<Code, EquipmentSlotView>;
  const hotKey = hover ?? activeSlot ?? null;
  const partState = (code: Code) => {
    const slot = byCode[code];
    return {
      'data-on': Boolean(slot?.item) || undefined,
      'data-hot': slot && hotKey === slot.slot.key ? true : undefined,
      style: slot?.item ? ({ '--q': getQualityColor(slot.item.品质 ?? '普通') } as CSSProperties) : undefined,
    };
  };
  const bodyFill = `url(#${uid}-body)`;
  const necklace = partState('accessory1');
  const ring = partState('accessory2');
  const gear = view.totals.filter(total => total.bonus !== 0);

  const dropHandlers = (slot: EquipmentSlotView) => ({
    onDragOver: (event: DragEvent) => {
      if (readOnly || !onDropItem || dragKind !== slot.slot.kind || !event.dataTransfer.types.includes(DRAG_ITEM)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropOver(slot.slot.key);
    },
    onDragLeave: () => setDropOver(current => (current === slot.slot.key ? null : current)),
    onDrop: (event: DragEvent) => {
      setDropOver(null);
      const item = event.dataTransfer.getData(DRAG_ITEM);
      if (!item || dragKind !== slot.slot.kind) return;
      event.preventDefault();
      onDropItem?.(item, slot.slot.key);
    },
  });

  return (
    <div className="eqd">
      <div className="eqd__stage">
        <svg className="eqd__art" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
          <defs>
            {/* 全身共用一条竖向渐变，头、手臂与躯干的颜色才连得上 */}
            <linearGradient id={`${uid}-body`} x1="0" y1="20" x2="0" y2="370" gradientUnits="userSpaceOnUse">
              <stop offset="0" className="eqd-stop-top" />
              <stop offset="1" className="eqd-stop-bottom" />
            </linearGradient>
            <radialGradient id={`${uid}-halo`} cx="50%" cy="50%" r="50%">
              <stop offset="0" className="eqd-stop-glow" stopOpacity=".2" />
              <stop offset="1" className="eqd-stop-glow" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* 星盘 */}
          <ellipse cx="180" cy="196" rx="120" ry="150" fill={`url(#${uid}-halo)`} />
          <circle className="eqd-ring eqd-ring--outer" cx="180" cy="200" r="172" />
          <path className="eqd-ticks" d={ticks} />
          <circle className="eqd-ring eqd-ring--inner" cx="180" cy="200" r="150" />
          <circle className="eqd-ring eqd-ring--inner" cx="180" cy="200" r="104" />
          <g className="eqd-orbit"><path d={orbit} /></g>
          {STARS.map(([x, y, r], index) => <circle key={index} className="eqd-star" cx={x} cy={y} r={r} />)}
          <ellipse className="eqd-plinth eqd-plinth--glow" cx="180" cy="364" rx="70" ry="12" />
          <ellipse className="eqd-plinth" cx="180" cy="364" rx="78" ry="13" />
          <ellipse className="eqd-plinth" cx="180" cy="364" rx="54" ry="8" opacity=".6" />

          {/* 人偶：躯干与腿、两臂、头与头发，再加几笔结构线 */}
          <path className="eqd-body" fill={bodyFill} d={FIGURE.body} />
          <path className="eqd-body" fill={bodyFill} d={FIGURE.arm} />
          <path className="eqd-body" fill={bodyFill} d={FIGURE.arm} transform={MIRROR} />
          <path className="eqd-body" fill={bodyFill} d={FIGURE.head} />
          <path className="eqd-hair" d={FIGURE.hair} />
          <path className="eqd-detail" d={FIGURE.anatomy} />

          {/* 悬在右侧的佩剑（武器位） */}
          <g className="eqd-weapon" {...partState('weapon')}>
            <path d="M256 83.6l3 4-3 4-3-4z" />
            <path d="M253.8 92h4.4v20h-4.4z" />
            <path d="M244 113.6Q256 110.4 268 113.6L266.6 117Q256 114.6 245.4 117z" />
            <path className="eqd-blade" d="M252.6 116.6h6.8V192L256 206l-3.4-14z" />
            <path d="M256 121v66" />
          </g>

          {/* 装备：先腿后靴，再盖上衣甲、护手与头盔 */}
          <g className="eqd-part" {...partState('legs')}><path className="eqd-gear" d={GEAR.legs} /></g>
          <g className="eqd-part" {...partState('feet')}>
            <path className="eqd-gear" d={GEAR.boot} />
            <path className="eqd-gear" d={GEAR.boot} transform={MIRROR} />
          </g>
          <g className="eqd-part" {...partState('chest')}><path className="eqd-gear" d={GEAR.chest} /></g>
          <g className="eqd-part" {...partState('hands')}>
            <path className="eqd-gear" d={GEAR.glove} />
            <path className="eqd-gear" d={GEAR.glove} transform={MIRROR} />
          </g>
          <g className="eqd-part" {...partState('head')}><path className="eqd-gear" d={GEAR.head} /></g>
          <g {...necklace}>
            <path className="eqd-chain" data-on={necklace['data-on']} d="M171.8 78.6C174.4 85.4 177.2 89.8 180 92M188.2 78.6C185.6 85.4 182.8 89.8 180 92" />
            <path className="eqd-gem" data-on={necklace['data-on']} d="M180 92l4.2 5.2-4.2 6-4.2-6z" />
          </g>
          <g {...ring}>
            <path className="eqd-chain" data-on={ring['data-on']} d="M223.2 214.6C227.4 215.8 231.6 215.8 235.6 214.4" />
            <path className="eqd-gem" data-on={ring['data-on']} d="M236.6 210.6l2.6 3.4-2.6 3.6-2.6-3.6z" />
          </g>

          {/* 引线画在人偶上面，落点在身体上也看得见 */}
          {view.slots.map(slot => {
            const state = partState(slot.slot.code);
            const geo = GEO[slot.slot.code];
            return (
              <g key={slot.slot.key} style={state.style}>
                <path className="eqd-link" d={linkPath(slot.slot.code)} data-on={state['data-on']} data-hot={state['data-hot']} />
                <circle className="eqd-anchor" cx={geo.ax} cy={geo.ay} r="2.4" data-hot={state['data-hot']} />
              </g>
            );
          })}
        </svg>

        {view.slots.map(slot => {
          const geo = GEO[slot.slot.code];
          const item = slot.item;
          const droppable = dragKind ? (dragKind === slot.slot.kind ? (dropOver === slot.slot.key ? 'over' : 'ok') : 'no') : undefined;
          const canDragOut = Boolean(item && onDragSlot && !readOnly);
          return (
            <button
              key={slot.slot.key}
              type="button"
              className="eqd__socket"
              style={{ left: `${(geo.x / W) * 100}%`, top: `${(geo.y / H) * 100}%`, ...(item ? { '--q': getQualityColor(item.品质 ?? '普通') } : {}) } as CSSProperties}
              data-slot={slot.slot.code}
              data-filled={Boolean(item) || undefined}
              data-hot={hotKey === slot.slot.key || undefined}
              data-drop={droppable}
              aria-label={item ? `${slot.slot.label}：${item.名称}${item.品质 ? `（${item.品质}）` : ''}` : `${slot.slot.label}：空${slot.candidates.length ? `，行囊里有 ${slot.candidates.length} 件可换` : ''}`}
              title={item ? `${slot.slot.label} · ${item.名称}` : `${slot.slot.label}${slot.candidates.length ? ` · 可换 ${slot.candidates.length} 件` : ''}`}
              disabled={!onSlotClick}
              onClick={() => onSlotClick?.(slot)}
              onMouseEnter={() => setHover(slot.slot.key)}
              onMouseLeave={() => setHover(current => (current === slot.slot.key ? null : current))}
              onFocus={() => setHover(slot.slot.key)}
              onBlur={() => setHover(current => (current === slot.slot.key ? null : current))}
              draggable={canDragOut || undefined}
              onDragStart={canDragOut ? event => {
                event.dataTransfer.setData(DRAG_SLOT, slot.slot.key);
                event.dataTransfer.effectAllowed = 'move';
                onDragSlot?.(slot.slot.key);
              } : undefined}
              onDragEnd={canDragOut ? () => onDragSlot?.(null) : undefined}
              {...dropHandlers(slot)}
            >
              <SlotGlyph kind={glyphFor(slot.slot)} />
              <span className="eqd__socket-label">{item ? item.名称 : slot.slot.label}</span>
            </button>
          );
        })}
      </div>

      <div className="eqd__panel">
        <div className="eqd__summary"><span>已穿戴</span><strong>{view.worn}<small style={{ fontSize: 11, color: 'var(--text-muted)' }}> / {view.slots.length}</small></strong></div>
        {gear.length > 0 ? (
          <dl className="eqd__totals" aria-label="装备加成">
            {gear.map(total => <TotalRow key={total.id} total={total} />)}
          </dl>
        ) : (
          <p className="eq-hint">{readOnly ? '身上还没有带来加成的装备。' : '点插槽挑选行囊里能穿的物品；桌面上也可以把行囊里的装备直接拖到插槽上。'}</p>
        )}
      </div>
    </div>
  );
}

function TotalRow({ total }: { total: StatTotalView }) {
  const vital = total.kind === 'vital';
  const from = vital ? total.cap - total.bonus : total.effective - total.bonus;
  const to = vital ? total.cap : total.effective;
  const scale = Math.max(1, total.baseCap, to, from);
  const sign = total.bonus > 0 ? 'up' : 'down';
  const baseWidth = (Math.min(from, to) / scale) * 100;
  const bonusWidth = (Math.abs(total.bonus) / scale) * 100;
  return (
    <div className="eqd__total">
      <dt>{total.name}{vital ? '上限' : ''}</dt>
      <dd>{formatNumber(from)} → {formatNumber(to)}<small data-sign={sign}>{total.bonus > 0 ? '+' : ''}{formatNumber(total.bonus)}</small></dd>
      <span className="eqd__bar" aria-hidden="true">
        <i style={{ width: `${Math.max(0, baseWidth)}%` }} />
        <i data-sign={sign} style={{ left: `${Math.max(0, baseWidth)}%`, width: `${Math.min(100 - baseWidth, bonusWidth)}%` }} />
      </span>
    </div>
  );
}
