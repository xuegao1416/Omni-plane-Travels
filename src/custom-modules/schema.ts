/**
 * The public TypeScript contract for declarative custom gameplay modules.
 *
 * This contract is intentionally independent from the event/workflow system.
 * A module owns the state below `GameState.customModules[moduleId]` and can
 * only mutate that namespace through the allow-listed action types.
 */

export type CustomGameplayModuleKind = 'custom-gameplay-module';
export type CustomGameplayModuleScope = 'world';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ModuleStatus = 'draft' | 'installed' | 'enabled' | 'disabled';
export type CustomModuleStatus = ModuleStatus;

export interface ModuleValidationIssue {
  path: string[];
  message: string;
  code?: string;
  severity: 'error' | 'warning';
}

export type CustomModuleValidationIssue = ModuleValidationIssue;
export type ValidationIssue = ModuleValidationIssue;

export interface NumberStateField {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  description?: string;
}

export interface StringStateField {
  type: 'string';
  default: string;
  maxLength?: number;
  description?: string;
}

export interface BooleanStateField {
  type: 'boolean';
  default: boolean;
  description?: string;
}

export interface EnumStateField {
  type: 'enum';
  values: string[];
  default: string;
  description?: string;
}

export interface ArrayStateField {
  type: 'array';
  items: StateFieldDefinition;
  default: JsonValue[];
  maxItems: number;
  maxDepth: number;
  maxSize: number;
  description?: string;
}

export interface ObjectStateField {
  type: 'object';
  fields: Record<string, StateFieldDefinition>;
  default: { [key: string]: JsonValue };
  maxProperties: number;
  maxDepth: number;
  maxSize: number;
  description?: string;
}

export type StateFieldDefinition =
  | NumberStateField
  | StringStateField
  | BooleanStateField
  | EnumStateField
  | ArrayStateField
  | ObjectStateField;

export type StateFieldType = StateFieldDefinition['type'];
export type StateDefinition = Record<string, StateFieldDefinition>;

export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
export type CustomModuleValueSource = 'state' | 'input' | 'event';

export interface CustomModuleReference {
  type?: 'ref';
  source: CustomModuleValueSource;
  path: string;
}

export type CustomModuleValue = JsonValue | CustomModuleReference;

export interface CompareCondition {
  type: 'compare';
  path: string;
  operator: ConditionOperator;
  value: JsonValue;
}

export interface AllCondition {
  type: 'all';
  conditions: Condition[];
}

export interface AnyCondition {
  type: 'any';
  conditions: Condition[];
}

export interface NotCondition {
  type: 'not';
  condition: Condition;
}

export type Condition = CompareCondition | AllCondition | AnyCondition | NotCondition;

export interface SetAction {
  type: 'set';
  path: string;
  value: JsonValue;
}

export interface NumericAction {
  type: 'add' | 'subtract';
  path: string;
  value: number;
}

export interface ToggleAction {
  type: 'toggle';
  path: string;
}

export interface CollectionAction {
  type: 'append' | 'remove';
  path: string;
  value: JsonValue;
}

export interface LogAction {
  type: 'log';
  message: string;
  level?: 'debug' | 'info' | 'warn';
}

export interface V2CompareCondition {
  type: 'compare';
  source: CustomModuleValueSource;
  path: string;
  operator: ConditionOperator;
  value: CustomModuleValue;
}

export interface V2ReferenceCompareCondition {
  type: 'compare';
  left: CustomModuleReference;
  operator: ConditionOperator;
  right: CustomModuleValue;
}

export interface V2AllCondition {
  type: 'all';
  conditions: V2Condition[];
}

export interface V2AnyCondition {
  type: 'any';
  conditions: V2Condition[];
}

export interface V2NotCondition {
  type: 'not';
  condition: V2Condition;
}

export type V2Condition = V2CompareCondition | V2ReferenceCompareCondition | V2AllCondition | V2AnyCondition | V2NotCondition;

export interface V2SetAction {
  type: 'set';
  path: string;
  value: CustomModuleValue;
}

export interface V2NumericAction {
  type: 'add' | 'subtract';
  path: string;
  value: number | CustomModuleReference;
}

export interface V2CollectionAction {
  type: 'append' | 'remove';
  path: string;
  value: CustomModuleValue;
}

export type V2Action = V2SetAction | V2NumericAction | ToggleAction | V2CollectionAction | LogAction;

export type CustomModuleAction =
  | SetAction
  | NumericAction
  | ToggleAction
  | CollectionAction
  | LogAction;
export type Action = CustomModuleAction;

export interface LifecycleRule {
  when?: Condition;
  actions: CustomModuleAction[];
}

export interface ModuleLogic {
  onGameStart: LifecycleRule[];
  onTurnEnd: LifecycleRule[];
  onTick: LifecycleRule[];
  onChoice: LifecycleRule[];
}

export interface ModuleLogicV2 extends Omit<ModuleLogic, 'onGameStart' | 'onTurnEnd' | 'onTick' | 'onChoice'> {
  onGameStart: LifecycleRuleV2[];
  onTurnEnd: LifecycleRuleV2[];
  onTick: LifecycleRuleV2[];
  onChoice: LifecycleRuleV2[];
  onButton: LifecycleRuleV2[];
}

export interface LifecycleRuleV2 {
  when?: V2Condition;
  actions: V2Action[];
}

export interface CustomModuleInputBinding {
  path: string;
}

export type ViewSlot = 'left-panel' | 'right-panel';

export interface SectionViewComponent {
  type: 'section';
  title?: string;
  children: ViewComponent[];
}

export interface CardViewComponent {
  type: 'card';
  title?: string;
  body?: string;
  children?: ViewComponent[];
  actions?: ButtonViewComponent[];
}

export interface TextViewComponent {
  type: 'text';
  text?: string;
  label?: string;
  path?: string;
}

export interface NumberViewComponent {
  type: 'number';
  label?: string;
  path: string;
  format?: 'integer' | 'decimal';
}

export interface ProgressViewComponent {
  type: 'progress';
  label?: string;
  path: string;
  min?: number;
  max?: number;
  color?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}

export interface BadgeViewComponent {
  type: 'badge';
  label?: string;
  path: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}

export interface ListViewComponent {
  type: 'list';
  label?: string;
  path: string;
  emptyText?: string;
}

export interface TableColumn {
  key: string;
  label: string;
}

export interface TableViewComponent {
  type: 'table';
  label?: string;
  path: string;
  columns: TableColumn[];
}

export interface DividerViewComponent {
  type: 'divider';
}

export interface ConditionalViewComponent {
  type: 'conditional';
  when: Condition;
  children: ViewComponent[];
}

export interface ButtonViewComponent {
  type: 'button';
  label: string;
  event: string;
}

export type ViewComponent =
  | SectionViewComponent
  | CardViewComponent
  | TextViewComponent
  | NumberViewComponent
  | ProgressViewComponent
  | BadgeViewComponent
  | ListViewComponent
  | TableViewComponent
  | DividerViewComponent
  | ConditionalViewComponent
  | ButtonViewComponent;

export interface ModuleView {
  slot: ViewSlot;
  title?: string;
  components: ViewComponent[];
}

export interface ModulePermissions {
  read: string[];
  write: 'own-state-only';
}

/** Optional distribution metadata used by the workshop installer. */
export interface CustomModuleDependency {
  id: string;
  version?: string;
  optional?: boolean;
}

export interface CustomGameplayModule {
  kind: CustomGameplayModuleKind;
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  dependencies?: CustomModuleDependency[];
  scope: CustomGameplayModuleScope;
  state: StateDefinition;
  logic: ModuleLogic;
  view?: ModuleView;
  permissions: ModulePermissions;
}

export interface CustomGameplayModuleV2 extends Omit<CustomGameplayModule, 'schemaVersion' | 'logic' | 'permissions'> {
  schemaVersion: 2;
  inputs: Record<string, string | CustomModuleInputBinding>;
  logic: ModuleLogicV2;
  permissions: ModulePermissions;
}

export type CustomGameplayModuleDefinition = CustomGameplayModule | CustomGameplayModuleV2;

export type CustomGameplayModuleInput = (Omit<CustomGameplayModule, 'logic' | 'permissions'> & {
  logic?: Partial<ModuleLogic>;
  permissions?: Partial<ModulePermissions>;
}) | (Omit<CustomGameplayModuleV2, 'logic' | 'permissions'> & {
  logic?: Partial<ModuleLogicV2>;
  permissions?: Partial<ModulePermissions>;
});
