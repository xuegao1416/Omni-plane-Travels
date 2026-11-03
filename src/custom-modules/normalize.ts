import { customGameplayModuleV1Schema,customGameplayModuleV2Schema,customGameplayModuleV3Schema } from './manifestSchema';
import type {
CustomGameplayModuleV3, Condition, V2Condition,
ModuleValidationIssue
} from './schema';

export type NormalizedModuleResult = {
  ok: true;
  data: CustomGameplayModuleV3;
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
export function normalizeCustomGameplayModule(input: unknown, source: 'import' | 'internal' = 'import'): NormalizedModuleResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ path: [], code: 'invalid-module', severity: 'error', message: '模块必须是 JSON 对象' }],
      warnings: [],
    };
  }

  const candidate: Record<string, unknown> = { ...input as Record<string, unknown> };
  if (source === 'internal' && candidate.schemaVersion === 1) {
    return { ok: false, errors: [{ path: ['schemaVersion'], code: 'unsupported-stored-version', severity: 'error', message: '本地模块仅支持 V2 → V3 迁移；V1 原始数据已保留，请导出后重新导入。' }], warnings: [] };
  }

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
      ...(candidate.schemaVersion !== 1 ? { onButton: logic.onButton ?? [] } : {}),
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

  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3) {
    return {
      ok: false,
      errors: [{
        path: ['schemaVersion'], code: 'invalid-version', severity: 'error',
        message: '新模块必须使用 schemaVersion 3；导入支持 1、2、3',
      }],
      warnings: [],
    };
  }
  // Dispatch by the discriminator instead of asking a top-level union to
  // explain the failure. Zod otherwise collapses useful V2 field errors into
  // one root-level "Invalid input", leaving the repair model nothing to act on.
  const parsed = candidate.schemaVersion === 1
    ? customGameplayModuleV1Schema.safeParse(candidate)
    : candidate.schemaVersion === 2 ? customGameplayModuleV2Schema.safeParse(candidate)
    : customGameplayModuleV3Schema.safeParse(candidate);
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

  if (parsed.data.schemaVersion === 3) return { ok: true, data: parsed.data as CustomGameplayModuleV3, warnings: [] };
  // V1 is an external import adapter. There is a single V2 -> V3 internal migration.
  const legacy = parsed.data;
  const convertCondition = (condition: Condition): V2Condition => {
    if (condition.type === 'compare') return { ...condition, source: 'state' };
    if (condition.type === 'not') return { ...condition, condition: convertCondition(condition.condition) };
    return { ...condition, conditions: condition.conditions.map(convertCondition) };
  };
  const logic = Object.fromEntries(['onGameStart', 'onTurnEnd', 'onTick', 'onChoice', 'onButton'].map(lifecycle => {
    const rules = (legacy.logic as Record<string, Array<{ when?: unknown; actions: unknown[] }>>)[lifecycle] ?? [];
    return [lifecycle, rules.map((rule, index) => ({ ...rule, id: `${lifecycle}-${index + 1}`,
      ...(rule.when && legacy.schemaVersion === 1 ? { when: convertCondition(rule.when as Condition) } : {}),
    }))];
  }));
  const migrated = { ...legacy, schemaVersion: 3, inputs: 'inputs' in legacy ? legacy.inputs : {}, capabilities: [], items: {}, logic };
  return { ok: true, data: migrated as unknown as CustomGameplayModuleV3, warnings: [] };
}
