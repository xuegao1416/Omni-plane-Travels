import type { ProfilePanelProps } from './profilePanel/types';
import { IdentitySection } from './profilePanel/IdentitySection';
import { SkillsSection } from './profilePanel/SkillsSection';
import { ItemsSection } from './profilePanel/ItemsSection';
import { ProfessionSection } from './profilePanel/ProfessionSection';

export default function ProfilePanel({ gameState, hasBusinessModule, professionConfig, statConfig }: ProfilePanelProps) {
  const p = gameState.玩家;

  return (
    <div>
      <IdentitySection player={p} hasBusinessModule={hasBusinessModule} />
      <ProfessionSection gameState={gameState} config={professionConfig} statConfig={statConfig} />
      <SkillsSection skills={p.技能系统} />
      <ItemsSection items={p.物品栏} />
    </div>
  );
}
