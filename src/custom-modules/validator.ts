import { normalizeCustomGameplayModule } from './normalize';
import type {
  Condition,
  CustomGameplayModule,
  CustomGameplayModuleDefinition,
  CustomGameplayModuleV2,
  CustomModuleAction,
  CustomModuleReference,
  CustomModuleValue,
  JsonValue,
  ModuleValidationIssue,
  StateFieldDefinition,
  ViewComponent,
  V2Action,
  V2Condition,
} from './schema';
import {
  getCustomModuleSafeEventType,
  getCustomModuleSafeInputType,
  type CustomModuleValueType,
} from './capabilities';

export interface CustomModuleValidationResult {
  valid: boolean;
  normalized?: CustomGameplayModuleDefinition;
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

function isReference(value: unknown): value is CustomModuleReference {
  return Boolean(value && typeof value === 'object' && (value as CustomModuleReference).source && (value as CustomModuleReference).path);
}

function inputPath(module: CustomGameplayModuleV2, alias: string): string | undefined {
  const binding = module.inputs[alias];
  return typeof binding === 'string' ? binding : binding?.path;
}

interface ReferenceTypeProof {
  type: CustomModuleValueType;
  field?: StateFieldDefinition;
}

function referenceCompatibleWithField(target: StateFieldDefinition, proof: ReferenceTypeProof): boolean {
  if (target.type === 'enum') {
    return proof.field?.type === 'enum'
      && proof.field.values.every((value) => target.values.includes(value));
  }
  if (target.type === 'array' || target.type === 'object') {
    return proof.field?.type === target.type
      && JSON.stringify(proof.field) === JSON.stringify(target);
  }
  return proof.type === target.type;
}

function validateReference(
  module: CustomGameplayModuleV2,
  reference: CustomModuleReference,
  path: string[],
  errors: ModuleValidationIssue[],
): ReferenceTypeProof | undefined {
  const normalized = pathParts(reference.path).join('.');
  if (!normalized) {
    errors.push(issue(path, 'invalid-reference', '引用路径不能为空'));
    return undefined;
  }
  if (reference.source === 'state') {
    const found = validatePath(module.state, normalized, path, errors);
    return found ? { type: fieldType(found.field) as CustomModuleValueType, field: found.field } : undefined;
  }
  if (reference.source === 'input') {
    const hostPath = inputPath(module, normalized);
    if (!hostPath) {
      errors.push(issue([...path, reference.path], 'undeclared-input-alias', 'input 引用必须使用已声明的输入别名'));
      return undefined;
    }
    const type = getCustomModuleSafeInputType(hostPath);
    return type ? { type } : undefined;
  }
  const type = getCustomModuleSafeEventType(normalized);
  if (!type) {
    errors.push(issue([...path, reference.path], 'unknown-event-path', 'event 引用不在安全事件快照目录中'));
    return undefined;
  }
  return { type };
}

function validateValueReference(
  module: CustomGameplayModuleV2,
  value: CustomModuleValue,
  path: string[],
  errors: ModuleValidationIssue[],
): ReferenceTypeProof | undefined {
  return isReference(value) ? validateReference(module, value, path, errors) : undefined;
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

function validateV2Condition(
  condition: V2Condition | undefined,
  module: CustomGameplayModuleV2,
  path: string[],
  errors: ModuleValidationIssue[],
): void {
  if (!condition) return;
  if (condition.type === 'compare') {
    const left: CustomModuleReference = 'left' in condition
      ? condition.left
      : { source: condition.source, path: condition.path };
    const value = 'right' in condition ? condition.right : condition.value;
    const leftProof = validateReference(module, left, [...path, 'left'], errors);
    const rightProof = validateValueReference(module, value, [...path, 'value'], errors);
    const rightType = rightProof?.type ?? (!isReference(value) ? jsonType(value) : undefined);
    if (['gt', 'gte', 'lt', 'lte'].includes(condition.operator)
      && (leftProof?.type !== 'number' || rightType !== 'number')) {
      errors.push(issue(path, 'type-mismatch', `${condition.operator} 两侧必须都是 number`));
    }
    if (['eq', 'neq'].includes(condition.operator) && leftProof && rightType && leftProof.type !== rightType) {
      errors.push(issue(path, 'type-mismatch', '比较两侧的引用类型不兼容'));
    }
    if (condition.operator === 'contains' && leftProof && !['string', 'array'].includes(leftProof.type)) {
      errors.push(issue(path, 'type-mismatch', 'contains 左侧必须是 string 或 array'));
    }
    if (condition.operator === 'in' && !Array.isArray(value) && !isReference(value)) {
      errors.push(issue([...path, 'value'], 'type-mismatch', 'in 的 value 必须是数组或数组引用'));
    }
    if (condition.operator === 'in' && rightProof && rightProof.type !== 'array') {
      errors.push(issue([...path, 'value'], 'type-mismatch', 'in 的引用值必须是 array'));
    }
    return;
  }
  if (condition.type === 'not') {
    validateV2Condition(condition.condition, module, [...path, 'condition'], errors);
    return;
  }
  condition.conditions.forEach((nested, index) => validateV2Condition(nested, module, [...path, 'conditions', String(index)], errors));
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

function validateV2Action(
  action: V2Action,
  module: CustomGameplayModuleV2,
  path: string[],
  errors: ModuleValidationIssue[],
): void {
  if (action.type === 'log') return;
  const found = validatePath(module.state, action.path, path, errors);
  if (!found) return;
  const type = fieldType(found.field);
  if ((action.type === 'add' || action.type === 'subtract') && type !== 'number') {
    errors.push(issue([...path, action.path], 'type-mismatch', `${action.type} 只允许用于 number 状态`));
  }
  if (action.type === 'toggle' && type !== 'boolean') errors.push(issue([...path, action.path], 'type-mismatch', 'toggle 只允许用于 boolean 状态'));
  if ((action.type === 'append' || action.type === 'remove') && found.field.type !== 'array') {
    errors.push(issue([...path, action.path], 'type-mismatch', `${action.type} 只允许用于 array 状态`));
  }
  if ('value' in action) {
    const referenceProof = validateValueReference(module, action.value, [...path, 'value'], errors);
    if (isReference(action.value) && referenceProof) {
      const targetField = action.type === 'append' || action.type === 'remove'
        ? (found.field.type === 'array' ? found.field.items : undefined)
        : found.field;
      if (!targetField || !referenceCompatibleWithField(targetField, referenceProof)) {
        errors.push(issue([...path, action.path], 'type-mismatch', '引用值类型无法证明与目标状态兼容'));
      }
    }
    if (!isReference(action.value) && action.type === 'set' && !isCompatible(found.field, action.value)) {
      errors.push(issue([...path, action.path], 'type-mismatch', `set 的值类型 ${jsonType(action.value)} 与状态类型不匹配`));
    }
    if (!isReference(action.value) && (action.type === 'append' || action.type === 'remove') && found.field.type === 'array' && !isCompatible(found.field.items, action.value)) {
      errors.push(issue([...path, action.path], 'type-mismatch', '集合元素类型与 array.items 不匹配'));
    }
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
  if (component.type === 'card') {
    component.children?.forEach((child, index) => validateComponent(child, state, [...path, 'children', String(index)], errors));
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
  const lifecycleNames = module.schemaVersion === 2
    ? ['onGameStart', 'onTurnEnd', 'onTick', 'onChoice', 'onButton'] as const
    : ['onGameStart', 'onTurnEnd', 'onTick', 'onChoice'] as const;
  for (const lifecycle of lifecycleNames) {
    const rules = module.schemaVersion === 2
      ? (module as CustomGameplayModuleV2).logic[lifecycle]
      : (module as CustomGameplayModule).logic[lifecycle as 'onGameStart' | 'onTurnEnd' | 'onTick' | 'onChoice'];
    rules.forEach((rawRule, ruleIndex) => {
      if (module.schemaVersion === 2) {
        const rule = rawRule as CustomGameplayModuleV2['logic']['onGameStart'][number];
        validateV2Condition(rule.when, module as CustomGameplayModuleV2, ['logic', lifecycle, String(ruleIndex), 'when'], errors);
        rule.actions.forEach((action, actionIndex) => validateV2Action(action, module as CustomGameplayModuleV2, ['logic', lifecycle, String(ruleIndex), 'actions', String(actionIndex)], errors));
      } else {
        const rule = rawRule as CustomGameplayModule['logic']['onGameStart'][number];
        validateCondition(rule.when, state, ['logic', lifecycle, String(ruleIndex), 'when'], errors);
        rule.actions.forEach((action, actionIndex) => validateAction(action, state, ['logic', lifecycle, String(ruleIndex), 'actions', String(actionIndex)], errors));
      }
    });
  }
  module.view?.components.forEach((component, index) => validateComponent(component, state, ['view', 'components', String(index)], errors));

  if (module.schemaVersion === 2) {
    for (const [alias, binding] of Object.entries(module.inputs)) {
      const hostPath = typeof binding === 'string' ? binding : binding.path;
      if (!getCustomModuleSafeInputType(hostPath)) {
        errors.push(issue(['inputs', alias], 'unknown-host-input', `宿主输入路径不在安全能力目录中：${hostPath}`));
      }
      if (!module.permissions.read.includes(hostPath)) {
        errors.push(issue(['inputs', alias], 'undeclared-read-permission', `inputs 使用的宿主路径必须在 permissions.read 中精确声明：${hostPath}`));
      }
    }
    if (module.permissions.read.some((path) => !getCustomModuleSafeInputType(path))) {
      module.permissions.read.forEach((path, index) => {
        if (!getCustomModuleSafeInputType(path)) errors.push(issue(['permissions', 'read', String(index)], 'unknown-host-input', `读取路径不在安全能力目录中：${path}`));
      });
    }
  }

  return {
    valid: errors.length === 0,
    normalized: errors.length === 0 ? module : undefined,
    errors,
    warnings: normalized.warnings,
  };
}

export function assertValidCustomGameplayModule(input: unknown): CustomGameplayModuleDefinition {
  const result = validateCustomGameplayModule(input);
  if (!result.valid || !result.normalized) {
    throw new Error(result.errors.map((entry) => `${entry.path.join('.')}: ${entry.message}`).join('; '));
  }
  return result.normalized;
}

