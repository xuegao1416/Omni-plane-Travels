import { Shield } from 'lucide-react';
import { Collapsible } from '../../../shared/Collapsible';
import type { EquipmentView } from '../../../../domains/equipment/viewModel';
import { EquipmentDoll } from '../../inventory/EquipmentDoll';
import type { useGearActions } from './useGearActions';

type Gear = ReturnType<typeof useGearActions>;

/** 人物档案 · 装备：星仪人偶（纸娃娃），与下方行囊联动。 */
export function EquipmentSection({ view, gear }: { view: EquipmentView; gear: Gear }) {
  const { sheet, open, drag, setDrag, feedback, run, canAct } = gear;
  return (
    <Collapsible icon={<Shield size={15} />} title="装备" count={view.worn}>
      <div className="eq-section">
        {feedback?.at === 'gear' && <div className="eq-feedback" data-tone={feedback.tone} role="status"><span>{feedback.text}</span></div>}
        <EquipmentDoll
          view={view}
          activeSlot={sheet?.kind === 'slot' ? sheet.slot : null}
          onSlotClick={slot => open({ kind: 'slot', slot: slot.slot.key })}
          dragKind={drag?.kind === 'item' ? drag.slotKind : null}
          onDropItem={(item, slot) => { setDrag(null); run('equipment.equip', { item, slot }, `装备${item}`, 'gear', false); }}
          onDragSlot={slot => setDrag(slot ? { kind: 'slot', slot } : null)}
          readOnly={!canAct}
        />
      </div>
    </Collapsible>
  );
}
