import { useState, type CSSProperties, type DragEvent } from 'react';
import type { BagView, InventoryCell, InventoryLayout } from '../../../domains/inventory/capacity';
import { SLOT_KIND_LABEL, type SlotKind } from '../../../domains/equipment/slots';
import { SlotGlyph } from './slotGlyphs';
import { ItemGlyph, ItemIcon, qualityStyle } from './ItemGlyph';
import '../../../ui/screens/game-equipment.css';

/** 拖拽时携带的数据类型：行囊里的物品 / 装备栏里的部位。 */
export const DRAG_ITEM = 'application/x-omni-item';
export const DRAG_SLOT = 'application/x-omni-slot';

export interface InventoryPackProps {
  layout: InventoryLayout;
  title?: string;
  selectedKey?: string | null;
  onSelect?: (cell: InventoryCell) => void;
  onSelectBag?: (bag: BagView) => void;
  /** 物品能穿在哪类部位（给格子打标记、允许拖到纸娃娃上）。 */
  equipKind?: (cell: InventoryCell) => SlotKind | undefined;
  /** 允许把格子拖去纸娃娃。 */
  draggable?: boolean;
  draggingKey?: string | null;
  onDragItem?: (cell: InventoryCell | null, kind?: SlotKind) => void;
  /** 从纸娃娃拖下来的部位放到行囊上 = 卸下。 */
  slotDragActive?: boolean;
  onDropSlot?: (slotKey: string) => void;
  emptyNote?: string;
}

function meterState(layout: InventoryLayout): 'ok' | 'full' | 'over' {
  if (layout.overflow > 0) return 'over';
  return layout.free === 0 ? 'full' : 'ok';
}

/**
 * 行囊：格子数 = 容量，满了就是满了；背包放在上方的行囊位里扩充格数。
 * 格子按可用宽度自动排列（auto-fill），抽屉、手机卷宗与 NPC 面板里都不会撑破右侧一列。
 */
export function InventoryPack({
  layout, title = '行囊', selectedKey, onSelect, onSelectBag, equipKind, draggable, draggingKey, onDragItem,
  slotDragActive, onDropSlot, emptyNote,
}: InventoryPackProps) {
  const [dropHover, setDropHover] = useState(false);
  const visible = layout.cells.slice(0, layout.capacity);
  const overflow = layout.cells.slice(layout.capacity);
  const empties = Math.max(0, layout.capacity - visible.length);
  const fill = layout.capacity > 0 ? Math.min(100, Math.round((layout.used / layout.capacity) * 100)) : 100;
  const state = meterState(layout);
  const bagSockets = Math.max(0, layout.rules.bagSlots - layout.bags.length);

  const acceptsSlot = (event: DragEvent) => Boolean(slotDragActive && onDropSlot && event.dataTransfer.types.includes(DRAG_SLOT));
  const gridDrop = {
    onDragOver: (event: DragEvent) => { if (!acceptsSlot(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropHover(true); },
    onDragLeave: () => setDropHover(false),
    onDrop: (event: DragEvent) => {
      setDropHover(false);
      const slot = event.dataTransfer.getData(DRAG_SLOT);
      if (!slot || !acceptsSlot(event)) return;
      event.preventDefault();
      onDropSlot?.(slot);
    },
  };

  const renderCell = (cell: InventoryCell, over = false) => {
    const kind = equipKind?.(cell);
    const canDrag = Boolean(draggable && kind && onDragItem);
    return (
      <button
        key={cell.key}
        type="button"
        className={`eqi__cell${over ? ' eqi__cell--over' : ''}`}
        style={qualityStyle(cell.item.品质)}
        aria-pressed={selectedKey === cell.key}
        aria-label={`${cell.key}${cell.count > 1 ? ` ×${cell.count}` : ''}，${cell.item.品质}${kind ? `，可装备在${SLOT_KIND_LABEL[kind]}` : ''}${over ? '，超出容量' : ''}`}
        title={`${cell.key}${cell.count > 1 ? ` ×${cell.count}` : ''}${cell.item.类型 ? ` · ${cell.item.类型}` : ''}`}
        data-dragging={draggingKey === cell.key || undefined}
        draggable={canDrag || undefined}
        onDragStart={canDrag ? event => {
          event.dataTransfer.setData(DRAG_ITEM, cell.key);
          event.dataTransfer.effectAllowed = 'move';
          onDragItem?.(cell, kind);
        } : undefined}
        onDragEnd={canDrag ? () => onDragItem?.(null) : undefined}
        onClick={onSelect ? () => onSelect(cell) : undefined}
        disabled={!onSelect}
      >
        {kind && <span className="eqi__mark" aria-hidden="true"><SlotGlyph kind={kind} strokeWidth={2.4} /></span>}
        {cell.spareBag && <span className="eqi__mark eqi__mark--bag" aria-hidden="true" title="行囊位已满，这只背包暂时只占一格"><SlotGlyph kind="bag" strokeWidth={2.4} /></span>}
        {cell.count > 1 && <span className="eqi__qty">×{cell.count}</span>}
        <ItemIcon name={cell.key} item={cell.item} />
        <span className="eqi__name">{cell.key}</span>
      </button>
    );
  };

  return (
    <div className="eqi">
      <div className="eqi__head">
        {title && <span>{title}</span>}
        <div className="eqi__meter" data-state={state} role="meter" aria-label="行囊容量" aria-valuemin={0} aria-valuemax={layout.capacity} aria-valuenow={layout.used}>
          <i style={{ '--fill': `${fill}%` } as CSSProperties} />
        </div>
        <span className="eqi__count">{layout.used}<small> / {layout.capacity} 格</small></span>
      </div>

      <div className="eqi__bags" style={{ '--bag-slots': layout.rules.bagSlots } as CSSProperties} aria-label={`行囊位 ${layout.bags.length}/${layout.rules.bagSlots}`}>
        {layout.bags.map((bag, index) => (
          <button key={`${bag.key}-${index}`} type="button" className="eqi__bag" style={qualityStyle(bag.item.品质)} onClick={onSelectBag ? () => onSelectBag(bag) : undefined} disabled={!onSelectBag} title={`${bag.name}：行囊 +${bag.size} 格`}>
            <ItemGlyph name={bag.name} item={bag.item} glyph="bag" size="sm" />
            <span><strong>{bag.name}</strong><small>+{bag.size} 格</small></span>
          </button>
        ))}
        {Array.from({ length: bagSockets }, (_, index) => (
          <span key={`empty-bag-${index}`} className="eqi__bag eqi__bag--empty" title="获得背包后放在这里，扩充行囊">空行囊位</span>
        ))}
      </div>

      <div className="eqi__grid" aria-label="行囊格子" data-drop={slotDragActive && dropHover ? 'ok' : undefined} {...gridDrop}>
        {visible.map(cell => renderCell(cell))}
        {Array.from({ length: empties }, (_, index) => <span key={`empty-${index}`} className="eqi__cell eqi__cell--empty" aria-hidden="true" />)}
      </div>
      {visible.length === 0 && emptyNote && <p className="eqi__empty-note">{emptyNote}</p>}

      {overflow.length > 0 && (
        <>
          <div className="eqi__overflow" role="alert">超载 {overflow.length} 件：行囊装不下，先丢弃或交出一些物品</div>
          <div className="eqi__grid" aria-label="超出容量的物品">{overflow.map(cell => renderCell(cell, true))}</div>
        </>
      )}
    </div>
  );
}
