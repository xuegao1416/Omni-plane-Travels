import { customGameplayModuleSchema } from './manifestSchema';
import type {
  CustomGameplayModule,
  ModuleValidationIssue,
} from './schema';

export type NormalizedModuleResult = {
  ok: true;
  data: CustomGameplayModule;
  warnings: ModuleValidationIssue[];
} | {
  ok: false;
  data?: undefined;
  errors: ModuleValidationIssue[];
  warnings: ModuleValidationIssue[];
}

function trimOptional(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Applies only harmless metadata defaults/cleanup before the strict schema runs.
 * It deliberately does not coerce gameplay values or silently remove fields.
 */
export function normalizeCustomGameplayModule(input: unknown): NormalizedModuleResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ path: [], code: 'invalid-module', severity: 'error', message: '模块必须是 JSON 对象' }],
      warnings: [],
    };
  }

  const source = input as Record<string, unknown>;
  const candidate: Record<string, unknown> = { ...source };

  for (const key of ['id', 'name', 'version', 'author', 'description']) {
    if (key in candidate) candidate[key] = trimOptional(candidate[key]);
  }
  if (candidate.id !== undefined && typeof candidate.id === 'string') {
    candidate.id = candidate.id.toLowerCase();
  }

  if (candidate.logic && typeof candidate.logic === 'object' && !Array.isArray(candidate.logic)) {
    const logic = candidate.logic as Record<string, unknown>;
    candidate.logic = {
      ...logic,
      onGameStart: logic.onGameStart ?? [],
      onTurnEnd: logic.onTurnEnd ?? [],
      onTick: logic.onTick ?? [],
      onChoice: logic.onChoice ?? [],
    };
  }
  if (candidate.permissions && typeof candidate.permissions === 'object' && !Array.isArray(candidate.permissions)) {
    const permissions = candidate.permissions as Record<string, unknown>;
    candidate.permissions = {
      ...permissions,
      read: permissions.read ?? [],
      write: permissions.write ?? 'own-state-only',
    };
  }
  if (candidate.view && typeof candidate.view === 'object' && !Array.isArray(candidate.view)) {
    const view = candidate.view as Record<string, unknown>;
    candidate.view = { ...view, slot: view.slot ?? 'right-panel', components: view.components ?? [] };
  }

  const parsed = customGameplayModuleSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String),
        code: issue.path.at(-1) === 'write' ? 'invalid-permission' : issue.code,
        severity: 'error' as const,
        message: issue.message,
      })),
      warnings: [],
    };
  }

  return { ok: true, data: parsed.data as CustomGameplayModule, warnings: [] };
}
