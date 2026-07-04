import type { ProfilePanelProps } from './profilePanel/types';
import { IdentitySection } from './profilePanel/IdentitySection';
import { StatsSection } from './profilePanel/StatsSection';
import { SkillsSection } from './profilePanel/SkillsSection';
import { ItemsSection } from './profilePanel/ItemsSection';

export default function ProfilePanel({ gameState, hasBusinessModule }: ProfilePanelProps) {
  const p = gameState.玩家;
  const w = gameState.世界;

  return (
    <div>
      <IdentitySection player={p} hasBusinessModule={hasBusinessModule} />
      <StatsSection world={w} />
      <SkillsSection skills={p.技能系统} />
      <ItemsSection items={p.物品栏} />
    </div>
  );
}
