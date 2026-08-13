import { z } from 'zod';
import type {
  Condition,
  CustomGameplayModule,
  CustomGameplayModuleDefinition,
  JsonValue,
  StateFieldDefinition,
} from './schema';

const ID_RE = /^[a-z0-9][a-z0-9_:-]{2,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

const boundedPathSchema = z.string().min(1).max(160);
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string().max(4096),
    z.number().refine(Number.isFinite, '必须是有限数字'),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema).max(128),
    z.record(z.string().max(64), jsonValueSchema).refine((value) => Object.keys(value).length <= 64, {
      message: '对象最多包含 64 个字段',
    }),
  ]),
);

const descriptionSchema = z.string().max(500).optional();
const stateFieldNameSchema = z.string().regex(NAME_RE, '字段名必须是安全的 ASCII 标识符');

const numberStateFieldSchema = z
  .object({
    type: z.literal('number'),
    default: z.number().refine(Number.isFinite, '必须是有限数字'),
    min: z.number().refine(Number.isFinite, '必须是有限数字').optional(),
    max: z.number().refine(Number.isFinite, '必须是有限数字').optional(),
    description: descriptionSchema,
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      ctx.addIssue({ code: 'custom', path: ['min'], message: 'min 不能大于 max' });
    }
    if (field.min !== undefined && field.default < field.min) {
      ctx.addIssue({ code: 'custom', path: ['default'], message: 'default 不能小于 min' });
    }
    if (field.max !== undefined && field.default > field.max) {
      ctx.addIssue({ code: 'custom', path: ['default'], message: 'default 不能大于 max' });
    }
  });

const stringStateFieldSchema = z
  .object({
    type: z.literal('string'),
    default: z.string().max(4096),
    maxLength: z.number().int().min(1).max(4096).optional(),
    description: descriptionSchema,
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.maxLength !== undefined && field.default.length > field.maxLength) {
      ctx.addIssue({ code: 'custom', path: ['default'], message: 'default 超过 maxLength' });
    }
  });

const booleanStateFieldSchema = z
  .object({
    type: z.literal('boolean'),
    default: z.boolean(),
    description: descriptionSchema,
  })
  .strict();

const enumStateFieldSchema = z
  .object({
    type: z.literal('enum'),
    values: z.array(z.string().min(1).max(80)).min(1).max(64),
    default: z.string().min(1).max(80),
    description: descriptionSchema,
  })
  .strict()
  .superRefine((field, ctx) => {
    if (new Set(field.values).size !== field.values.length) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'values 不能包含重复项' });
    }
    if (!field.values.includes(field.default)) {
      ctx.addIssue({ code: 'custom', path: ['default'], message: 'default 必须存在于 values 中' });
    }
  });

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal('compare'),
        path: boundedPathSchema,
        operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
        value: jsonValueSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('all'),
        conditions: z.array(conditionSchema).min(1).max(16),
      })
      .strict(),
    z
      .object({
        type: z.literal('any'),
        conditions: z.array(conditionSchema).min(1).max(16),
      })
      .strict(),
    z
      .object({
        type: z.literal('not'),
        condition: conditionSchema,
      })
      .strict(),
  ]),
);

const stateFieldSchema: z.ZodType<StateFieldDefinition> = z.lazy(() =>
  z.union([
    numberStateFieldSchema,
    stringStateFieldSchema,
    booleanStateFieldSchema,
    enumStateFieldSchema,
    arrayStateFieldSchema,
    objectStateFieldSchema,
  ]),
);

const arrayStateFieldSchema = z
  .object({
    type: z.literal('array'),
    items: stateFieldSchema,
    default: z.array(jsonValueSchema).max(128),
    maxItems: z.number().int().min(1).max(128),
    maxDepth: z.number().int().min(1).max(8),
    maxSize: z.number().int().min(1).max(65536),
    description: descriptionSchema,
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.default.length > field.maxItems) {
      ctx.addIssue({ code: 'custom', path: ['default'], message: 'default 数组超过 maxItems' });
    }
  });

const objectStateFieldSchema = z
  .object({
    type: z.literal('object'),
    fields: z.record(stateFieldNameSchema, stateFieldSchema).refine((value) => Object.keys(value).length <= 32, {
      message: '对象最多定义 32 个字段',
    }),
    default: z.record(z.string().max(64), jsonValueSchema).refine((value) => Object.keys(value).length <= 32, {
      message: 'default 对象最多包含 32 个字段',
    }),
    maxProperties: z.number().int().min(1).max(32),
    maxDepth: z.number().int().min(1).max(8),
    maxSize: z.number().int().min(1).max(65536),
    description: descriptionSchema,
  })
  .strict()
  .superRefine((field, ctx) => {
    if (Object.keys(field.default).length > field.maxProperties) {
      ctx.addIssue({ code: 'custom', path: ['default'], message: 'default 对象超过 maxProperties' });
    }
  });

const setActionSchema = z
  .object({ type: z.literal('set'), path: boundedPathSchema, value: jsonValueSchema })
  .strict();

const numericActionSchema = z
  .object({
    type: z.enum(['add', 'subtract']),
    path: boundedPathSchema,
    value: z.number().refine(Number.isFinite, '必须是有限数字'),
  })
  .strict();

const toggleActionSchema = z.object({ type: z.literal('toggle'), path: boundedPathSchema }).strict();

const collectionActionSchema = z
  .object({
    type: z.enum(['append', 'remove']),
    path: boundedPathSchema,
    value: jsonValueSchema,
  })
  .strict();

const logActionSchema = z
  .object({
    type: z.literal('log'),
    message: z.string().min(1).max(500),
    level: z.enum(['debug', 'info', 'warn']).optional(),
  })
  .strict();

export const customModuleActionSchema = z.union([
  setActionSchema,
  numericActionSchema,
  toggleActionSchema,
  collectionActionSchema,
  logActionSchema,
]);

const lifecycleRuleSchema = z
  .object({
    when: conditionSchema.optional(),
    actions: z.array(customModuleActionSchema).min(1).max(32),
  })
  .strict();

const logicSchema = z
  .object({
    onGameStart: z.array(lifecycleRuleSchema).max(64).default([]),
    onTurnEnd: z.array(lifecycleRuleSchema).max(64).default([]),
    onTick: z.array(lifecycleRuleSchema).max(64).default([]),
    onChoice: z.array(lifecycleRuleSchema).max(64).default([]),
  })
  .strict()
  .default({
    onGameStart: [],
    onTurnEnd: [],
    onTick: [],
    onChoice: [],
  });

const sectionViewComponentSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      type: z.literal('section'),
      title: z.string().min(1).max(120).optional(),
      children: z.array(viewComponentSchema).max(32),
    })
    .strict(),
);

const conditionalViewComponentSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      type: z.literal('conditional'),
      when: conditionSchema,
      children: z.array(viewComponentSchema).max(32),
    })
    .strict(),
);

const viewComponentSchema = z.lazy(() =>
  z.union([
    sectionViewComponentSchema,
    z
      .object({
        type: z.literal('text'),
        text: z.string().max(4096).optional(),
        label: z.string().max(120).optional(),
        path: boundedPathSchema.optional(),
      })
      .strict()
      .refine((component) => component.text !== undefined || component.path !== undefined, {
        message: 'text 组件必须提供 text 或 path',
      }),
    z
      .object({
        type: z.literal('number'),
        label: z.string().max(120).optional(),
        path: boundedPathSchema,
        format: z.enum(['integer', 'decimal']).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('progress'),
        label: z.string().max(120).optional(),
        path: boundedPathSchema,
        min: z.number().optional(),
        max: z.number().optional(),
        color: z.enum(['neutral', 'success', 'warning', 'danger', 'accent']).optional(),
      })
      .strict()
      .refine((component) => component.min === undefined || component.max === undefined || component.min <= component.max, {
        message: 'progress 的 min 不能大于 max',
      }),
    z
      .object({
        type: z.literal('badge'),
        label: z.string().max(120).optional(),
        path: boundedPathSchema,
        tone: z.enum(['neutral', 'success', 'warning', 'danger', 'accent']).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('list'),
        label: z.string().max(120).optional(),
        path: boundedPathSchema,
        emptyText: z.string().max(200).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('table'),
        label: z.string().max(120).optional(),
        path: boundedPathSchema,
        columns: z
          .array(z.object({ key: z.string().min(1).max(64), label: z.string().min(1).max(120) }).strict())
          .min(1)
          .max(32),
      })
      .strict(),
    z.object({ type: z.literal('divider') }).strict(),
    conditionalViewComponentSchema,
    z
      .object({
        type: z.literal('button'),
        label: z.string().min(1).max(120),
        event: z.string().regex(NAME_RE, 'button event 必须是安全的事件名'),
      })
      .strict(),
  ]),
);

const viewSchema = z
  .object({
    slot: z.enum(['left-panel', 'right-panel']).default('right-panel'),
    title: z.string().min(1).max(120).optional(),
    components: z.array(viewComponentSchema).max(64).default([]),
  })
  .strict();

const permissionsSchema = z
  .object({
    read: z.array(z.string().min(1).max(160)).max(32).default([]),
    write: z.literal('own-state-only').default('own-state-only'),
  })
  .strict()
  .default({ read: [], write: 'own-state-only' });

export const customGameplayModuleV1Schema = z
  .object({
    kind: z.literal('custom-gameplay-module'),
    schemaVersion: z.literal(1),
    id: z.string().regex(ID_RE, 'id 必须匹配 ^[a-z0-9][a-z0-9_:-]{2,63}$'),
    name: z.string().min(1).max(120),
    version: z.string().regex(SEMVER_RE, 'version 必须是 x.y.z'),
    author: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    scope: z.literal('world'),
    state: z.record(stateFieldNameSchema, stateFieldSchema).refine((value) => Object.keys(value).length <= 64, {
      message: '模块最多定义 64 个状态字段',
    }),
    logic: logicSchema,
    view: viewSchema.optional(),
    permissions: permissionsSchema,
  })
  .strict();

const customModuleReferenceSchema = z
  .object({
    type: z.literal('ref').optional(),
    source: z.enum(['state', 'input', 'event']),
    path: boundedPathSchema,
  })
  .strict();

const customModuleValueSchema = z.union([jsonValueSchema, customModuleReferenceSchema]);

const v2ConditionSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.union([
    z.object({
      type: z.literal('compare'),
      source: z.enum(['state', 'input', 'event']),
      path: boundedPathSchema,
      operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
      value: customModuleValueSchema,
    }).strict(),
    z.object({
      type: z.literal('compare'),
      left: customModuleReferenceSchema,
      operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
      right: customModuleValueSchema,
    }).strict(),
  ]),
  z.object({ type: z.literal('all'), conditions: z.array(v2ConditionSchema).min(1).max(16) }).strict(),
  z.object({ type: z.literal('any'), conditions: z.array(v2ConditionSchema).min(1).max(16) }).strict(),
  z.object({ type: z.literal('not'), condition: v2ConditionSchema }).strict(),
]));

const v2SetActionSchema = z.object({ type: z.literal('set'), path: boundedPathSchema, value: customModuleValueSchema }).strict();
const v2NumericActionSchema = z.object({
  type: z.enum(['add', 'subtract']), path: boundedPathSchema,
  value: z.union([z.number().refine(Number.isFinite, '必须是有限数字'), customModuleReferenceSchema]),
}).strict();
const v2CollectionActionSchema = z.object({ type: z.enum(['append', 'remove']), path: boundedPathSchema, value: customModuleValueSchema }).strict();
const v2ActionSchema = z.union([
  v2SetActionSchema,
  v2NumericActionSchema,
  toggleActionSchema,
  v2CollectionActionSchema,
  logActionSchema,
]);
const v2LifecycleRuleSchema = z.object({
  when: v2ConditionSchema.optional(),
  actions: z.array(v2ActionSchema).min(1).max(32),
}).strict();
const v2LogicSchema = z.object({
  onGameStart: z.array(v2LifecycleRuleSchema).max(64).default([]),
  onTurnEnd: z.array(v2LifecycleRuleSchema).max(64).default([]),
  onTick: z.array(v2LifecycleRuleSchema).max(64).default([]),
  onChoice: z.array(v2LifecycleRuleSchema).max(64).default([]),
  onButton: z.array(v2LifecycleRuleSchema).max(64).default([]),
}).strict().default({ onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [] });

const customGameplayModuleV2Schema = z.object({
  kind: z.literal('custom-gameplay-module'),
  schemaVersion: z.literal(2),
  id: z.string().regex(ID_RE, 'id 必须匹配 ^[a-z0-9][a-z0-9_:-]{2,63}$'),
  name: z.string().min(1).max(120),
  version: z.string().regex(SEMVER_RE, 'version 必须是 x.y.z'),
  author: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  scope: z.literal('world'),
  state: z.record(stateFieldNameSchema, stateFieldSchema).refine((value) => Object.keys(value).length <= 64, {
    message: '模块最多定义 64 个状态字段',
  }),
  inputs: z.record(stateFieldNameSchema, z.union([boundedPathSchema, z.object({ path: boundedPathSchema }).strict()])).refine(
    (value) => Object.keys(value).length <= 32,
    { message: '模块最多定义 32 个输入别名' },
  ),
  logic: v2LogicSchema,
  view: viewSchema.optional(),
  permissions: permissionsSchema,
}).strict();

export const customGameplayModuleSchema = z.union([customGameplayModuleV1Schema, customGameplayModuleV2Schema]);

export type CustomGameplayModuleInput = z.input<typeof customGameplayModuleSchema>;
export type CustomGameplayModuleOutput = z.output<typeof customGameplayModuleSchema>;

export function parseCustomGameplayModule(input: unknown): {
  ok: true;
  data: CustomGameplayModuleDefinition;
  issues: [];
} | {
  ok: false;
  data?: undefined;
  issues: string[];
} {
  const result = customGameplayModuleSchema.safeParse(input);
  if (result.success) {
      return { ok: true, data: result.data as CustomGameplayModuleDefinition, issues: [] };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}

/** Compatibility-friendly names for consumers that treat this file as the manifest schema. */
export const moduleManifestSchema = customGameplayModuleSchema;
export const manifestSchema = customGameplayModuleSchema;
export const stateFieldSchemaExport = stateFieldSchema;
export const viewComponentSchemaExport = viewComponentSchema;
