import type { ProfilePanelProps } from './profilePanel/types';
import { IdentitySection } from './profilePanel/IdentitySection';
import { SkillsSection } from './profilePanel/SkillsSection';
import { ItemsSection } from './profilePanel/ItemsSection';
import { ProfessionSection } from './profilePanel/ProfessionSection';
import { EquipmentSection } from './profilePanel/EquipmentSection';
import { GearSheets } from './profilePanel/GearSheets';
import { useGearActions } from './profilePanel/useGearActions';
import { buildPlayerEquipmentView } from '../../../domains/equipment/viewModel';
import { playerInventoryLayout } from '../../../domains/inventory/capacity';

export default function ProfilePanel({ gameState, world, hasBusinessModule, professionConfig, statConfig, onCommand }: ProfilePanelProps) {
  const p = gameState.玩家;
  const gear = useGearActions(onCommand);
  // 装备体系随数值属性启用；行囊（容量与背包）所有世界都有。
  const equipment = buildPlayerEquipmentView(gameState, world);
  const layout = playerInventoryLayout(p.物品栏);

  return (
    <div>
      <IdentitySection player={p} hasBusinessModule={hasBusinessModule} />
      {equipment && <EquipmentSection view={equipment} gear={gear} />}
      <ItemsSection layout={layout} gear={gear} equipmentEnabled={Boolean(equipment)} />
      <ProfessionSection gameState={gameState} config={professionConfig} statConfig={statConfig} />
      <SkillsSection skills={p.技能系统} />
      <GearSheets gameState={gameState} world={world} gear={gear} equipment={equipment} layout={layout} />
    </div>
  );
}
