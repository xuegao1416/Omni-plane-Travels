import type { PlayerProfile, WorldModule } from './types';

interface ProgressionInitEditorProps {
  worldModules?: WorldModule[];
  personalInfo: PlayerProfile;
  setPersonalInfo: (info: PlayerProfile) => void;
}

export default function ProgressionInitEditor({
  worldModules,
  personalInfo,
  setPersonalInfo,
}: ProgressionInitEditorProps) {
  const progressionModule = worldModules?.find(module => module.moduleId === 'progression' && module.enabled);
  const config = progressionModule?.moduleConfig as { tiers?: Array<{ name: string; description?: string }> } | undefined;
  if (!config?.tiers?.length) return null;

  const progression = (personalInfo.moduleInitData?.['成长体系'] ?? {}) as Record<string, unknown>;
  const selectedIndex = Number.isInteger(progression.currentTierIndex)
    ? Number(progression.currentTierIndex)
    : 0;

  const selectTier = (currentTierIndex: number) => {
    setPersonalInfo({
      ...personalInfo,
      moduleInitData: {
        ...(personalInfo.moduleInitData ?? {}),
        '成长体系': { ...progression, currentTierIndex },
      },
    });
  };

  return (
    <div className="progression-init-editor" role="radiogroup" aria-label="初始段位">
      {config.tiers.map((tier, index) => {
        const selected = selectedIndex === index;
        return (
          <label key={`${tier.name}-${index}`} className={`progression-init-option${selected ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="initial-progression-tier"
              checked={selected}
              onChange={() => selectTier(index)}
            />
            <span>{index + 1}</span>
            <strong>{tier.name}</strong>
            {tier.description && <small>{tier.description}</small>}
          </label>
        );
      })}
    </div>
  );
}
