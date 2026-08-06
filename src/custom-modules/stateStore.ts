import type { GameState } from '../schema/variables';
import type {
  CustomGameplayModule,
  JsonValue,
  StateFieldDefinition,
} from './schema';

export interface CustomModuleRuntimeLogEntry {
  lifecycle: string;
  message: string;
  at: number;
}

export interface CustomModuleRuntimeState {
  moduleVersion: string;
  enabled: boolean;
  values: Record<string, JsonValue>;
  runtime: {
    lastLifecycle?: string;
    lastRunAt?: number;
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
  module: CustomGameplayModule,
  enabled = true,
): CustomModuleRuntimeState {
  const values: Record<string, JsonValue> = {};
  for (const [key, field] of Object.entries(module.state)) {
    values[key] = defaultForField(field);
  }
  return {
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
  module: CustomGameplayModule,
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

  const next = createInitialCustomModuleState(module, enabled);
  for (const key of Object.keys(next.values)) {
    if (key in current.values) next.values[key] = cloneJson(current.values[key]);
  }
  next.runtime.log = current.runtime.log.slice(-100);
  gameState.customModules[module.id] = next;
  return next;
}

export function removeCustomModuleState(gameState: GameState, moduleId: string): void {
  if (!gameState.customModules) return;
  delete gameState.customModules[moduleId];
  if (Object.keys(gameState.customModules).length === 0) delete gameState.customModules;
}

