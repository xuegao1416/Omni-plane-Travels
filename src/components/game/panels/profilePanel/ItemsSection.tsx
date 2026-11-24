import { Backpack } from 'lucide-react';
import { Collapsible } from '../../../shared/Collapsible';
import type { InventoryLayout } from '../../../../domains/inventory/capacity';
import { itemSlotKind } from '../../../../domains/equipment/slots';
import { InventoryPack } from '../../inventory/InventoryPack';
import type { useGearActions } from './useGearActions';

type Gear = ReturnType<typeof useGearActions>;

/**
 * 人物档案 · 行囊：格子数就是容量（随身格 + 背包扩充），不再铺满 48 格。
 * 点物品看详情、装备或丢弃；装备体系启用时，可穿戴的物品能直接拖到上方的纸娃娃上。
 */
export function ItemsSection({ layout, gear, equipmentEnabled }: { layout: InventoryLayout; gear: Gear; equipmentEnabled: boolean }) {
  const { sheet, open, drag, setDrag, feedback, run, canAct } = gear;
  return (
    <Collapsible icon={<Backpack size={15} />} title="行囊" count={layout.used}>
      <div className="eq-section">
        {feedback?.at === 'pack' && <div className="eq-feedback" data-tone={feedback.tone} role="status"><span>{feedback.text}</span></div>}
        <InventoryPack
          layout={layout}
          title="容量"
          selectedKey={sheet?.kind === 'item' || sheet?.kind === 'bag' ? sheet.key : null}
          onSelect={cell => open({ kind: 'item', key: cell.key })}
          onSelectBag={bag => open({ kind: 'bag', key: bag.key })}
          equipKind={equipmentEnabled ? cell => itemSlotKind(cell.key, cell.item) : undefined}
          draggable={equipmentEnabled && canAct}
          draggingKey={drag?.kind === 'item' ? drag.key : null}
          onDragItem={(cell, kind) => setDrag(cell && kind ? { kind: 'item', key: cell.key, slotKind: kind } : null)}
          slotDragActive={drag?.kind === 'slot'}
          onDropSlot={slot => { setDrag(null); run('equipment.unequip', { slot }, '卸下装备', 'pack', false); }}
          emptyNote="行囊空空如也。"
        />
      </div>
    </Collapsible>
  );
}
