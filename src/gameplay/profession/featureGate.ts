import type { WorldDef } from '../../data/worlds-schema';
import type { V3FeatureFlags } from '../protocols';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Profession UI/context is available only when the world module and v3 flag both allow it. */
export function isProfessionModuleEnabled(worldDef?: Pick<WorldDef, 'modules'>, flags?: Partial<V3FeatureFlags>): boolean {
  const module = worldDef?.modules?.find(item => item.moduleId === 'profession');
  if (!module?.enabled) return false;
  if (typeof flags?.professionsEnabled === 'boolean') return flags.professionsEnabled;
  const config = record(module.moduleConfig ?? module.data);
  const nestedFlags = record(config?.featureFlags);
  if (config?.professionsEnabled === true || nestedFlags?.professionsEnabled === true) return true;
  // v3 worlds keep profession content in the library and store references only.
  // A non-empty binding is therefore the canonical enable signal for new worlds.
  if (Array.isArray(config?.packIds) && config.packIds.some(id => typeof id === 'string' && id.trim())) return true;
  // Legacy worlds embedded profession definitions directly; their enabled module
  // is the historical feature flag and must remain playable after migration.
  return Array.isArray(config?.professions) || Array.isArray(config?.innateTalents);
}
