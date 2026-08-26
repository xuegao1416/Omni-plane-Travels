import { useCallback } from 'react';
import { materializeStatInitData } from '../../gameplay/creation/creationPoints';
import type { PlayerProfile } from '../../storage/db';

interface UseCreationAllocationsOptions {
  personalInfo: PlayerProfile;
  setPersonalInfo: (profile: PlayerProfile) => void;
  statConfig?: Record<string, unknown>;
}

function sanitizeAllocations(allocations: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(allocations).flatMap(([key, value]) => (
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? [[key, Math.floor(value)] as const]
        : []
    )),
  );
}

export default function useCreationAllocations({
  personalInfo,
  setPersonalInfo,
  statConfig,
}: UseCreationAllocationsOptions) {
  const allocations = personalInfo.creationPointAllocations ?? {};
  const applyAllocations = useCallback((nextAllocations: Record<string, number>) => {
    const next = sanitizeAllocations(nextAllocations);
    setPersonalInfo({
      ...personalInfo,
      creationPointAllocations: next,
      moduleInitData: statConfig ? {
        ...personalInfo.moduleInitData,
        '数值属性': materializeStatInitData(statConfig, next),
      } : personalInfo.moduleInitData,
    });
  }, [personalInfo, setPersonalInfo, statConfig]);

  return { allocations, applyAllocations };
}
