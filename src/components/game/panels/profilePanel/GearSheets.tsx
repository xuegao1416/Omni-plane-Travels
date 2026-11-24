import type { GameState } from '../../../../schema/variables';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { InventoryLayout } from '../../../../domains/inventory/capacity';
import { bagSize } from '../../../../domains/inventory/capacity';
import { SLOT_KIND_LABEL, itemSlotKind } from '../../../../domains/equipment/slots';
import { compareCandidate, itemBonusChips, statsConfigFor, type EquipmentView } from '../../../../domains/equipment/viewModel';
import { BonusChips, ItemGlyph, qualityStyle } from '../../inventory/ItemGlyph';
import { ItemSheet, SheetBlock, SheetRows, type SheetAction } from '../../inventory/ItemSheet';
import type { useGearActions } from './useGearActions';

type Gear = ReturnType<typeof useGearActions>;

function QualityChip({ quality }: { quality?: string }) {
  return <span className="eq-chip eq-chip--quality" style={qualityStyle(quality)}>{quality || '普通'}</span>;
}

/** 人物档案里打开的物品 / 部位详情。 */
export function GearSheets({ gameState, world, gear, equipment, layout }: {
  gameState: GameState;
  world?: WorldDef;
  gear: Gear;
  equipment?: EquipmentView;
  layout: InventoryLayout;
}) {
  const { sheet, open, run, feedback, canAct } = gear;
  if (!sheet) return null;
  const close = () => open(null);
  const stats = statsConfigFor(world, gameState);
  const error = feedback?.at === 'sheet' ? <div className="eq-feedback" data-tone="error" role="alert"><span>{feedback.text}</span></div> : null;

  if (sheet.kind === 'item' || sheet.kind === 'bag') {
    const name = sheet.key;
    const item = gameState.玩家.物品栏?.[name];
    if (!item) return null;
    const kind = equipment ? itemSlotKind(name, item) : undefined;
    const comparison = kind ? compareCandidate(gameState, world, name) : undefined;
    const size = bagSize(name, item);
    const activeBags = layout.bags.filter(bag => bag.key === name).length;
    const count = Math.max(1, Math.trunc(Number(item.数量) || 1));
    const bonuses = equipment ? itemBonusChips(stats, item) : [];
    const actions: SheetAction[] = [];
    if (kind && comparison) {
      actions.push({
        key: 'equip', label: comparison.current ? `换上（替下${comparison.current.名称}）` : `装备到${comparison.slot.label}`, tone: 'primary', disabled: !canAct,
        onClick: () => run('equipment.equip', { item: name, slot: comparison.slot.key }, `装备${name}`, 'gear', true),
      });
    }
    if (count > 1) actions.push({ key: 'drop-one', label: '丢弃一件', disabled: !canAct, onClick: () => run('inventory.discard', { item: name, count: 1 }, `丢弃${name}`, 'pack', true) });
    actions.push({
      key: 'drop', label: count > 1 ? `全部丢弃（${count}）` : '丢弃', tone: 'danger', disabled: !canAct,
      confirm: `丢弃「${name}」${count > 1 ? `×${count}` : ''}？丢掉的物品只能通过回滚找回。`,
      onClick: () => run('inventory.discard', { item: name }, `丢弃${name}`, 'pack', true),
    });
    return (
      <ItemSheet
        title={name}
        quality={item.品质}
        glyph={<ItemGlyph name={name} item={item} size="lg" />}
        meta={<>
          <QualityChip quality={item.品质} />
          {item.类型 && <span className="eq-chip">{item.类型}</span>}
          {kind && <span className="eq-chip">可装备 · {SLOT_KIND_LABEL[kind]}</span>}
          {size > 0 && <span className="eq-chip">背包 +{size} 格</span>}
        </>}
        actions={actions}
        onClose={close}
      >
        {error}
        <SheetRows rows={[
          ['数量', count],
          ['备注', item.备注],
          ...(size > 0 ? [['行囊位', activeBags > 0 ? `使用中${activeBags > 1 ? ` ×${activeBags}` : ''}，扩充 ${size * activeBags} 格` : '行囊位已满，这只背包暂时只占一格'] as [string, string]] : []),
        ]} />
        {bonuses.length > 0 && <SheetBlock title="穿戴加成"><BonusChips chips={bonuses} /></SheetBlock>}
        {comparison?.current && (
          <SheetBlock title={`换上后 · 替下「${comparison.current.名称}」`}>
            <BonusChips chips={comparison.delta} empty="属性没有变化" />
          </SheetBlock>
        )}
        {comparison && !comparison.current && <p className="eq-hint">{comparison.slot.label}目前空着，穿上就能得到上面的加成。</p>}
        {!equipment && itemSlotKind(name, item) && <p className="eq-hint">这个世界没有启用装备体系，物品只作为随身行李。</p>}
      </ItemSheet>
    );
  }

  const slot = equipment?.slots.find(entry => entry.slot.key === sheet.slot);
  if (!slot) return null;
  const item = slot.item;
  const picks = slot.candidates.map(name => ({ name, item: gameState.玩家.物品栏[name]!, comparison: compareCandidate(gameState, world, name, slot.slot.key) }));
  const actions: SheetAction[] = item ? [{
    key: 'unequip', label: '卸下放回行囊', tone: 'secondary', disabled: !canAct,
    onClick: () => run('equipment.unequip', { slot: slot.slot.key }, `卸下${item.名称}`, 'pack', true),
  }] : [];
  return (
    <ItemSheet
      title={item ? item.名称 : `${slot.slot.label}（空）`}
      quality={item?.品质}
      glyph={item ? <ItemGlyph name={item.名称} item={item} size="lg" /> : <ItemGlyph name={slot.slot.label} glyph={slot.slot.code === 'accessory2' ? 'accessory2' : slot.slot.kind} size="lg" />}
      meta={<>
        <span className="eq-chip">{slot.slot.label}</span>
        {item && <QualityChip quality={item.品质} />}
        {item?.类型 && <span className="eq-chip">{item.类型}</span>}
      </>}
      actions={actions}
      onClose={close}
    >
      {error}
      {item && <SheetRows rows={[['备注', item.备注]]} />}
      {item && <SheetBlock title="穿戴加成"><BonusChips chips={slot.bonuses} empty="这件装备不带属性加成" /></SheetBlock>}
      <SheetBlock title={item ? '更换为' : '行囊里能穿在这里的物品'}>
        {picks.length > 0 ? (
          <div className="eq-sheet__list">
            {picks.map(pick => (
              <button
                key={pick.name}
                type="button"
                className="eq-pick"
                style={qualityStyle(pick.item.品质)}
                disabled={!canAct}
                onClick={() => run('equipment.equip', { item: pick.name, slot: slot.slot.key }, `装备${pick.name}`, 'gear', true)}
              >
                <ItemGlyph name={pick.name} item={pick.item} size="sm" />
                <span>
                  <strong>{pick.name}</strong>
                  <BonusChips chips={pick.comparison?.delta ?? []} empty="属性没有变化" />
                </span>
                <em>{item ? '换上' : '装备'}</em>
              </button>
            ))}
          </div>
        ) : <p className="eq-hint">行囊里没有能穿在{slot.slot.label}的物品。</p>}
      </SheetBlock>
    </ItemSheet>
  );
}
