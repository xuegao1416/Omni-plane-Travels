import type { GameState } from '../schema/variables';
import type {
  CustomGameplayModuleDefinition,
  CustomGameplayModuleV3,
  JsonValue,
  StateFieldDefinition,
} from './schema';
import { normalizeCustomGameplayModule } from './normalize';
import { isRuntimeValueCompatible } from './actionExecutor';

export interface CustomModuleRuntimeLogEntry {
  lifecycle: string;
  message: string;
  at: number;
}

export interface CustomModuleRuntimeState {
  definition?: CustomGameplayModuleV3;
  moduleVersion: string;
  enabled: boolean;
  values: Record<string, JsonValue>;
  runtime: {
    lastLifecycle?: string;
    lastRunAt?: number;
    processedEvents?: string[];
    log: CustomModuleRuntimeLogEntry[];
  };
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultForField(field: StateFieldDefinition): JsonValue {
  if (field.type === 'object') {
    const objectDefault: Record<string, JsonValue> = { ...field.default };
    for (const [key, child] of Object.entries(field.fields)) {
      if (!(key in objectDefault)) objectDefault[key] = defaultForField(child);
    }
    return objectDefault;
  }
  return cloneJson(field.default as JsonValue);
}

export function createInitialCustomModuleState(
  module: CustomGameplayModuleDefinition,
  enabled = true,
): CustomModuleRuntimeState {
  const values: Record<string, JsonValue> = {};
  for (const [key, field] of Object.entries(module.state)) {
    values[key] = defaultForField(field);
  }
  return {
    definition: (() => { const parsed = normalizeCustomGameplayModule(module); return parsed.ok ? parsed.data : undefined; })(),
    moduleVersion: module.version,
    enabled,
    values,
    runtime: { log: [] },
  };
}

/**
 * Installs a module's own state namespace into a save. Existing state is kept
 * when the module version is unchanged, so loading a save never resets player
 * progress. A version change gets defaults plus the still-compatible values.
 */
export function installCustomModuleState(
  gameState: GameState,
  module: CustomGameplayModuleDefinition,
  enabled = true,
): CustomModuleRuntimeState {
  if (!gameState.customModules) gameState.customModules = {};
  const current = gameState.customModules[module.id];
  if (!current) {
    const created = createInitialCustomModuleState(module, enabled);
    gameState.customModules[module.id] = created;
    return created;
  }

  current.enabled = enabled;
  if (current.moduleVersion === module.version) return current;

  const migrated = migrateCustomModuleState(current, module);
  if (!migrated.state) throw new Error(`模块状态迁移冲突：${migrated.conflicts.join(', ')}`);
  const next = migrated.state;
  next.enabled = enabled;
  gameState.customModules[module.id] = next;
  return next;
}

export function migrateCustomModuleState(current: CustomModuleRuntimeState, module: CustomGameplayModuleDefinition): { state?: CustomModuleRuntimeState; conflicts: string[] } {
  const next = createInitialCustomModuleState(module, current.enabled);
  const conflicts: string[] = [];
  for (const [key, field] of Object.entries(module.state)) {
    if (!Object.hasOwn(current.values, key)) continue;
    if (!isRuntimeValueCompatible(field, current.values[key])) conflicts.push(key);
    else next.values[key] = cloneJson(current.values[key]);
  }
  next.runtime = JSON.parse(JSON.stringify(current.runtime));
  return conflicts.length ? { conflicts } : { state: next, conflicts };
}

export function removeCustomModuleState(gameState: GameState, moduleId: string): void {
  if (!gameState.customModules) return;
  delete gameState.customModules[moduleId];
  if (Object.keys(gameState.customModules).length === 0) delete gameState.customModules;
}
