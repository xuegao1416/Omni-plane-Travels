import { normalizeCustomGameplayModule } from './normalize';
import type {
  Condition,
  CustomGameplayModule,
  CustomModuleAction,
  JsonValue,
  ModuleValidationIssue,
  StateFieldDefinition,
  ViewComponent,
} from './schema';

export interface CustomModuleValidationResult {
  valid: boolean;
  normalized?: CustomGameplayModule;
  errors: ModuleValidationIssue[];
  warnings: ModuleValidationIssue[];
}

type FieldInfo = {
  field: StateFieldDefinition;
  path: string[];
};

const FORBIDDEN_ROOTS = new Set([
  '世界',
  '玩家',
  '人物档案',
  'memoryRuntime',
  'memoryConfig',
  'simulationRuntime',
  'customModules',
]);

function issue(path: string[], code: string, message: string): ModuleValidationIssue {
  return { path, code, message, severity: 'error' };
}

function pathParts(path: string): string[] {
  return path.split('.').map((part) => part.trim()).filter(Boolean);
}

function findField(state: Record<string, StateFieldDefinition>, path: string): FieldInfo | undefined {
  const parts = pathParts(path);
  if (parts.length === 0) return undefined;
  let field = state[parts[0]];
  if (!field) return undefined;
  const resolved = [parts[0]];
  for (const part of parts.slice(1)) {
    if (field.type !== 'object' || !field.fields[part]) return undefined;
    field = field.fields[part];
    resolved.push(part);
  }
  return { field, path: resolved };
}

function fieldType(field: StateFieldDefinition): string {
  return field.type === 'enum' ? 'string' : field.type;
}

function jsonType(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isCompatible(field: StateFieldDefinition, value: JsonValue): boolean {
  switch (field.type) {
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string' && (field.maxLength === undefined || value.length <= field.maxLength);
    case 'boolean': return typeof value === 'boolean';
    case 'enum': return typeof value === 'string' && field.values.includes(value);
    case 'array': return Array.isArray(value);
    case 'object': return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }
}

function isForbidden(path: string): boolean {
  return FORBIDDEN_ROOTS.has(pathParts(path)[0] ?? '');
}

function validatePath(
  state: Record<string, StateFieldDefinition>,
  rawPath: string,
  path: string[],
  errors: ModuleValidationIssue[],
): FieldInfo | undefined {
  const normalized = pathParts(rawPath);
  if (normalized.length === 0) {
    errors.push(issue(path, 'invalid-state-path', '状态路径不能为空'));
    return undefined;
  }
  if (isForbidden(rawPath)) {
    errors.push(issue([...path, rawPath], 'forbidden-state-path', '自定义模块不能访问核心游戏状态'));
    return undefined;
  }
  const found = findField(state, rawPath);
  if (!found) {
    errors.push(issue([...path, rawPath], 'unknown-state-path', '状态路径不存在于模块自己的 state 中'));
    return undefined;
  }
  return found;
}

function validateCondition(
  condition: Condition | undefined,
  state: Record<string, StateFieldDefinition>,
  path: string[],
  errors: ModuleValidationIssue[],
): void {
  if (!condition) return;
  if (condition.type === 'compare') {
    const found = validatePath(state, condition.path, path, errors);
    if (!found) return;
    const actualType = fieldType(found.field);
    if (['gt', 'gte', 'lt', 'lte'].includes(condition.operator) && actualType !== 'number') {
      errors.push(issue([...path, condition.path], 'type-mismatch', `${condition.operator} 只允许用于 number 状态`));
    }
    if (condition.operator === 'contains' && !['string', 'array'].includes(actualType)) {
      errors.push(issue([...path, condition.path], 'type-mismatch', 'contains 只允许用于 string 或 array 状态'));
    }
    if (condition.operator === 'in' && !Array.isArray(condition.value)) {
      errors.push(issue([...path, condition.path], 'type-mismatch', 'in 的 value 必须是数组'));
    }
    if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(condition.operator) && !isCompatible(found.field, condition.value)) {
      errors.push(issue([...path, condition.path], 'type-mismatch', `条件值类型 ${jsonType(condition.value)} 与状态类型不匹配`));
    }
    return;
  }
  if (condition.type === 'not') {
    validateCondition(condition.condition, state, [...path, 'condition'], errors);
    return;
  }
  condition.conditions.forEach((nested, index) => validateCondition(nested, state, [...path, 'conditions', String(index)], errors));
}

function validateAction(
  action: CustomModuleAction,
  state: Record<string, StateFieldDefinition>,
  path: string[],
  errors: ModuleValidationIssue[],
): void {
  if (action.type === 'log') return;
  const found = validatePath(state, action.path, path, errors);
  if (!found) return;
  const type = fieldType(found.field);
  if ((action.type === 'add' || action.type === 'subtract') && type !== 'number') {
    errors.push(issue([...path, action.path], 'type-mismatch', `${action.type} 只允许用于 number 状态`));
  }
  if (action.type === 'toggle' && type !== 'boolean') {
    errors.push(issue([...path, action.path], 'type-mismatch', 'toggle 只允许用于 boolean 状态'));
  }
  if ((action.type === 'append' || action.type === 'remove') && found.field.type !== 'array') {
    errors.push(issue([...path, action.path], 'type-mismatch', `${action.type} 只允许用于 array 状态`));
  }
  if (action.type === 'set' && !isCompatible(found.field, action.value)) {
    errors.push(issue([...path, action.path], 'type-mismatch', `set 的值类型 ${jsonType(action.value)} 与状态类型不匹配`));
  }
  if ((action.type === 'append' || action.type === 'remove') && found.field.type === 'array' && !isCompatible(found.field.items, action.value)) {
    errors.push(issue([...path, action.path], 'type-mismatch', '集合元素类型与 array.items 不匹配'));
  }
}

function validateComponent(
  component: ViewComponent,
  state: Record<string, StateFieldDefinition>,
  path: string[],
  errors: ModuleValidationIssue[],
): void {
  if (component.type === 'divider' || component.type === 'button') return;
  if (component.type === 'section') {
    component.children.forEach((child, index) => validateComponent(child, state, [...path, 'children', String(index)], errors));
    return;
  }
  if (component.type === 'conditional') {
    validateCondition(component.when, state, [...path, 'when'], errors);
    component.children.forEach((child, index) => validateComponent(child, state, [...path, 'children', String(index)], errors));
    return;
  }
  if (!component.path) return;
  const found = validatePath(state, component.path, path, errors);
  if (!found) return;
  const type = fieldType(found.field);
  if ((component.type === 'number' || component.type === 'progress') && type !== 'number') {
    errors.push(issue([...path, component.path], 'type-mismatch', `${component.type} 只允许绑定 number 状态`));
  }
  if (component.type === 'list' && found.field.type !== 'array') {
    errors.push(issue([...path, component.path], 'type-mismatch', 'list 只允许绑定 array 状态'));
  }
}

export function validateCustomGameplayModule(input: unknown): CustomModuleValidationResult {
  const normalized = normalizeCustomGameplayModule(input);
  if (!normalized.ok) {
    return { valid: false, errors: normalized.errors, warnings: normalized.warnings };
  }

  const errors: ModuleValidationIssue[] = [];
  const module = normalized.data;
  const state = module.state;
  const lifecycleNames = ['onGameStart', 'onTurnEnd', 'onTick', 'onChoice'] as const;
  for (const lifecycle of lifecycleNames) {
    module.logic[lifecycle].forEach((rule, ruleIndex) => {
      validateCondition(rule.when, state, ['logic', lifecycle, String(ruleIndex), 'when'], errors);
      rule.actions.forEach((action, actionIndex) => {
        validateAction(action, state, ['logic', lifecycle, String(ruleIndex), 'actions', String(actionIndex)], errors);
      });
    });
  }
  module.view?.components.forEach((component, index) => validateComponent(component, state, ['view', 'components', String(index)], errors));

  return {
    valid: errors.length === 0,
    normalized: errors.length === 0 ? module : undefined,
    errors,
    warnings: normalized.warnings,
  };
}

export function assertValidCustomGameplayModule(input: unknown): CustomGameplayModule {
  const result = validateCustomGameplayModule(input);
  if (!result.valid || !result.normalized) {
    throw new Error(result.errors.map((entry) => `${entry.path.join('.')}: ${entry.message}`).join('; '));
  }
  return result.normalized;
}

