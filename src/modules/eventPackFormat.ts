import { z } from 'zod';
import type {
  CardNodeType,
  CardWorkflowConnection,
  CardWorkflowDefinition,
  EventPackIndex,
  Manifest,
} from './schema';
import { getCardNodeDefinition, validateCardConnection } from './cardNodeRegistry';

/** Legacy migration fixture shape. Runtime consumers must not depend on it. */
export interface LegacyCardFile {
  version: number;
  puck: {
    root: { props?: Record<string, unknown> };
    components: Record<string, Array<{ id: string; props: Record<string, unknown> }>>;
  };
  cards: Array<{
    id: string;
    componentId: string;
    title: string;
    category?: string;
    kind?: 'add' | 'override';
    overrideTarget?: string;
  }>;
}

export const EVENT_PACK_INDEX_VERSION = 2 as const;

export const canonicalEventIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, {
    message:
      'Event ID must be 1-64 lowercase ASCII letters, digits, underscores, or hyphens',
  });

export type EventPackFormatErrorCode =
  | 'EVENT_ID_INVALID'
  | 'EVENT_NAME_INVALID'
  | 'LEGACY_CARD_FILE_INVALID'
  | 'LEGACY_CARD_FILE_EMPTY'
  | 'LEGACY_COMPONENT_DUPLICATE'
  | 'LEGACY_COMPONENT_INVALID'
  | 'LEGACY_COMPONENT_MISSING'
  | 'LEGACY_COMPONENT_UNINDEXED'
  | 'LEGACY_COMPONENT_UNSUPPORTED'
  | 'LEGACY_MULTIPLE_CHOICES_UNSUPPORTED'
  | 'LEGACY_NODE_ID_INVALID'
  | 'LEGACY_NODE_ID_DUPLICATE'
  | 'JSON_MALFORMED'
  | 'INDEX_INVALID'
  | 'INDEX_MISSING'
  | 'INDEX_VERSION_UNSUPPORTED'
  | 'DUPLICATE_EVENT_ID'
  | 'WORKFLOW_MISSING'
  | 'WORKFLOW_INVALID'
  | 'INDEX_FILE_MISMATCH'
  | 'INPUT_CONFLICT'
  | 'INPUT_LIMIT_EXCEEDED';

export class EventPackFormatError extends Error {
  readonly code: EventPackFormatErrorCode;
  readonly context: Readonly<Record<string, unknown>>;
  readonly filePath?: string;

  constructor(
    code: EventPackFormatErrorCode,
    message: string,
    context: Readonly<Record<string, unknown>> = {},
    filePath?: string,
  ) {
    super(message);
    this.name = 'EventPackFormatError';
    this.code = code;
    this.context = context;
    this.filePath = filePath ?? (typeof context.filePath === 'string' ? context.filePath : undefined);
  }
}

const LEGACY_COMPONENT_TYPE_MAP = new Map<string, CardNodeType>([
  ['title', 'narrative.title'],
  ['narrative', 'narrative.text'],
  ['choice', 'choice.static'],
]);

interface LegacyComponentPayload {
  id: string;
  props: Record<string, unknown>;
}

interface OrderedLegacyComponent extends LegacyComponentPayload {
  componentType: string;
}

function legacyComponentKey(componentType: string, componentId: string): string {
  return `${componentType}\u0000${componentId}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }

  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }

  return true;
}

function isPlainEnumerableDataRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;

  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && 'value' in descriptor;
  });
}

function readOwn(
  value: unknown,
  key: string,
): unknown {
  if (typeof value !== 'object' || value === null) return undefined;

  return Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function throwFormatError(
  code: EventPackFormatErrorCode,
  message: string,
  context: Readonly<Record<string, unknown>>,
  filePath?: string,
): never {
  throw new EventPackFormatError(code, message, context, filePath);
}

function requireSupportedComponentType(
  componentType: unknown,
  eventId: string,
  componentId: unknown,
): string {
  if (
    typeof componentType !== 'string' ||
    !LEGACY_COMPONENT_TYPE_MAP.has(componentType)
  ) {
    throwFormatError(
      'LEGACY_COMPONENT_UNSUPPORTED',
      `Unsupported legacy component type: ${String(componentType)}`,
      { eventId, componentId, componentType },
    );
  }
  return componentType;
}

function requireUsableNodeId(
  nodeId: unknown,
  eventId: string,
  componentType: string,
): string {
  if (
    typeof nodeId !== 'string' ||
    nodeId.length === 0 ||
    nodeId.length > 128 ||
    nodeId !== nodeId.trim() ||
    /[\u0000-\u001f\u007f]/.test(nodeId)
  ) {
    throwFormatError(
      'LEGACY_NODE_ID_INVALID',
      `Invalid legacy node ID: ${String(nodeId)}`,
      { eventId, nodeId, componentType },
    );
  }
  return nodeId;
}

function requireComponentPayload(
  value: unknown,
  eventId: string,
  componentType: string,
  expectedId?: string,
): LegacyComponentPayload {
  const record = isPlainRecord(value) ? value : undefined;
  const rawComponentId = readOwn(value, 'id');
  const rawProps = record ? readOwn(record, 'props') : undefined;
  const componentId = rawComponentId ?? expectedId;
  if (
    !record ||
    typeof rawComponentId !== 'string' ||
    !isPlainRecord(rawProps)
  ) {
    throwFormatError(
      'LEGACY_COMPONENT_INVALID',
      `Invalid legacy component payload: ${String(componentId)}`,
      { eventId, componentId, componentType },
    );
  }

  return { id: rawComponentId, props: rawProps };
}

function normalizeLegacyChoices(
  choices: unknown,
  eventId: string,
  componentId: string,
): Array<Record<string, unknown>> {
  if (!isPlainArray(choices) || choices.length === 0) {
    throwFormatError(
      'LEGACY_COMPONENT_INVALID',
      `Legacy choice payload must contain a non-empty array: ${componentId}`,
      { eventId, componentId, componentType: 'choice', field: 'choices' },
    );
  }

  return choices.map((choice, choiceIndex) => {
    if (typeof choice === 'string') {
      if (choice.trim().length === 0) {
        throwFormatError(
          'LEGACY_COMPONENT_INVALID',
          `Legacy string choice must be non-empty: ${componentId}`,
          {
            eventId,
            componentId,
            componentType: 'choice',
            field: `choices[${choiceIndex}]`,
          },
        );
      }
      return { label: choice };
    }
    if (isPlainRecord(choice)) {
      const label = readOwn(choice, 'label');
      if (
        typeof label !== 'string' ||
        label.trim().length === 0
      ) {
        throwFormatError(
          'LEGACY_COMPONENT_INVALID',
          `Legacy object choice must have a non-empty string label: ${componentId}`,
          {
            eventId,
            componentId,
            componentType: 'choice',
            field: `choices[${choiceIndex}].label`,
          },
        );
      }
      return {
        ...choice,
        label,
      };
    }

    return throwFormatError(
      'LEGACY_COMPONENT_INVALID',
      `Invalid legacy choice at index ${choiceIndex}: ${componentId}`,
      {
        eventId,
        componentId,
        componentType: 'choice',
        field: `choices[${choiceIndex}]`,
      },
    );
  });
}

function validateLegacyComponentSemantics(
  payload: LegacyComponentPayload,
  eventId: string,
  componentType: string,
): void {
  if (componentType === 'title') {
    const title = readOwn(payload.props, 'title');
    if (
      typeof title !== 'string' ||
      title.trim().length === 0
    ) {
      throwFormatError(
        'LEGACY_COMPONENT_INVALID',
        `Legacy title must contain a non-empty string title: ${payload.id}`,
        {
          eventId,
          componentId: payload.id,
          componentType,
          field: 'title',
        },
      );
    }
    return;
  }

  if (componentType === 'narrative') {
    const text = readOwn(payload.props, 'text');
    if (
      typeof text !== 'string' ||
      text.trim().length === 0
    ) {
      throwFormatError(
        'LEGACY_COMPONENT_INVALID',
        `Legacy narrative must contain non-empty string text: ${payload.id}`,
        {
          eventId,
          componentId: payload.id,
          componentType,
          field: 'text',
        },
      );
    }
    return;
  }

  if (componentType === 'choice') {
    normalizeLegacyChoices(
      readOwn(payload.props, 'choices'),
      eventId,
      payload.id,
    );
  }
}

function readLegacyComponents(
  legacyCardFile: unknown,
  eventId: string,
): {
  cards: unknown[];
  components: Record<string, unknown>;
} {
  if (!isPlainRecord(legacyCardFile)) {
    throwFormatError(
      'LEGACY_CARD_FILE_INVALID',
      'Legacy card file must be a plain record',
      { eventId, field: 'cardFile' },
    );
  }

  const version = readOwn(legacyCardFile, 'version');
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version <= 0
  ) {
    throwFormatError(
      'LEGACY_CARD_FILE_INVALID',
      'Legacy card file version must be a positive integer',
      { eventId, field: 'version', version },
    );
  }

  const puck = readOwn(legacyCardFile, 'puck');
  if (!isPlainRecord(puck)) {
    throwFormatError(
      'LEGACY_CARD_FILE_INVALID',
      'Legacy card file is missing its Puck payload',
      { eventId, field: 'puck' },
    );
  }

  const root = readOwn(puck, 'root');
  if (!isPlainRecord(root)) {
    throwFormatError(
      'LEGACY_CARD_FILE_INVALID',
      'Legacy card file is missing its Puck root',
      { eventId, field: 'puck.root' },
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(root, 'props') &&
    !isPlainRecord(readOwn(root, 'props'))
  ) {
    throwFormatError(
      'LEGACY_CARD_FILE_INVALID',
      'Legacy Puck root props must be a plain record',
      { eventId, field: 'puck.root.props' },
    );
  }

  const components = readOwn(puck, 'components');
  if (!isPlainEnumerableDataRecord(components)) {
    throwFormatError(
      'LEGACY_CARD_FILE_INVALID',
      'Legacy card file is missing its component map',
      { eventId, field: 'puck.components' },
    );
  }

  const cards = readOwn(legacyCardFile, 'cards');
  if (!isPlainArray(cards)) {
    throwFormatError(
      'LEGACY_CARD_FILE_INVALID',
      'Legacy card file is missing its cards index',
      { eventId, field: 'cards' },
    );
  }

  return {
    cards,
    components,
  };
}

function orderLegacyComponents(
  cards: unknown[],
  components: Record<string, unknown>,
  eventId: string,
): OrderedLegacyComponent[] {
  const inventory: OrderedLegacyComponent[] = [];
  const inventoryByKey = new Map<string, OrderedLegacyComponent>();
  for (const rawComponentType of Object.keys(components)) {
    const group = readOwn(components, rawComponentType);
    if (!isPlainArray(group)) {
      throwFormatError(
        'LEGACY_COMPONENT_INVALID',
        `Invalid legacy component group: ${rawComponentType}`,
        { eventId, componentType: rawComponentType },
      );
    }

    const firstComponentId = isPlainRecord(group[0])
      ? readOwn(group[0], 'id')
      : undefined;
    const componentType = requireSupportedComponentType(
      rawComponentType,
      eventId,
      firstComponentId,
    );
    const seenPayloadIds = new Set<string>();

    for (let componentIndex = 0; componentIndex < group.length; componentIndex++) {
      const rawPayload = group[componentIndex];
      const payload = requireComponentPayload(
        rawPayload,
        eventId,
        componentType,
      );
      requireUsableNodeId(payload.id, eventId, componentType);
      if (seenPayloadIds.has(payload.id)) {
        throwFormatError(
          'LEGACY_COMPONENT_DUPLICATE',
          `Duplicate legacy component payload: ${payload.id}`,
          {
            eventId,
            componentId: payload.id,
            componentType,
            componentIndex,
          },
        );
      }
      seenPayloadIds.add(payload.id);
      validateLegacyComponentSemantics(payload, eventId, componentType);
      const orderedComponent = { ...payload, componentType };
      inventory.push(orderedComponent);
      inventoryByKey.set(legacyComponentKey(componentType, payload.id), orderedComponent);
    }
  }

  if (cards.length === 0) return inventory;

  const selectedPayloads = new Set<string>();
  const ordered = cards.map((card, cardIndex) => {
    if (!isPlainRecord(card)) {
      throwFormatError(
        'LEGACY_COMPONENT_INVALID',
        `Invalid legacy cards entry at index ${cardIndex}`,
        { eventId, componentIndex: cardIndex },
      );
    }

    const componentType = requireSupportedComponentType(
      readOwn(card, 'componentId'),
      eventId,
      readOwn(card, 'id'),
    );
    const nodeId = requireUsableNodeId(
      readOwn(card, 'id'),
      eventId,
      componentType,
    );
    if (!Object.prototype.hasOwnProperty.call(components, componentType)) {
      throwFormatError(
        'LEGACY_COMPONENT_MISSING',
        `Missing own legacy component group: ${componentType}`,
        { eventId, componentId: nodeId, componentType },
      );
    }

    const payload = inventoryByKey.get(legacyComponentKey(componentType, nodeId));
    if (!payload) {
      throwFormatError(
        'LEGACY_COMPONENT_MISSING',
        `Missing legacy component payload: ${nodeId}`,
        { eventId, componentId: nodeId, componentType },
      );
    }

    selectedPayloads.add(legacyComponentKey(componentType, nodeId));
    return payload;
  });

  const unindexed = inventory.find(
    (component) =>
      !selectedPayloads.has(legacyComponentKey(component.componentType, component.id)),
  );
  if (unindexed) {
    throwFormatError(
      'LEGACY_COMPONENT_UNINDEXED',
      `Legacy component payload is not present in cards: ${unindexed.id}`,
      {
        eventId,
        componentId: unindexed.id,
        componentType: unindexed.componentType,
      },
    );
  }

  return ordered;
}

export function migrateLegacyCardFile(
  legacyCardFile: unknown,
  eventId: string,
  eventName: string,
): CardWorkflowDefinition {
  if (!canonicalEventIdSchema.safeParse(eventId).success) {
    throwFormatError(
      'EVENT_ID_INVALID',
      `Invalid canonical event ID: ${eventId}`,
      { eventId },
    );
  }
  if (typeof eventName !== 'string' || eventName.trim().length === 0) {
    throwFormatError(
      'EVENT_NAME_INVALID',
      'Event name must be a non-empty string',
      { eventId, eventName },
    );
  }

  const { cards, components } = readLegacyComponents(legacyCardFile, eventId);
  const ordered = orderLegacyComponents(cards, components, eventId);
  if (ordered.length === 0) {
    throwFormatError(
      'LEGACY_CARD_FILE_EMPTY',
      'Legacy card file contains no components',
      { eventId },
    );
  }

  const choiceComponents = ordered.filter(
    (component) => component.componentType === 'choice',
  );
  if (choiceComponents.length > 1) {
    throwFormatError(
      'LEGACY_MULTIPLE_CHOICES_UNSUPPORTED',
      'Legacy workflows with multiple choice blocks cannot preserve runtime semantics',
      {
        eventId,
        componentId: choiceComponents[1].id,
        componentType: 'choice',
        choiceCount: choiceComponents.length,
      },
    );
  }

  const seenNodeIds = new Set<string>();
  const nodes = ordered.map((component, index) => {
    if (seenNodeIds.has(component.id)) {
      throwFormatError(
        'LEGACY_NODE_ID_DUPLICATE',
        `Duplicate legacy node ID: ${component.id}`,
        {
          eventId,
          nodeId: component.id,
          componentType: component.componentType,
        },
      );
    }
    seenNodeIds.add(component.id);

    const widgetValues: Record<string, unknown> = { ...component.props };
    if (component.componentType === 'choice') {
      widgetValues.options = JSON.stringify(
        normalizeLegacyChoices(
          readOwn(component.props, 'choices'),
          eventId,
          component.id,
        ),
      );
    }

    return {
      id: component.id,
      typeId: LEGACY_COMPONENT_TYPE_MAP.get(component.componentType)!,
      position: { x: 0, y: index * 120 },
      widgetValues,
    };
  });

  const connections = nodes.slice(0, -1).map((node, index) => ({
    id: `legacy-flow-${index}`,
    sourceNodeId: node.id,
    sourceSocketKey: 'flow_out',
    targetNodeId: nodes[index + 1].id,
    targetSocketKey: 'flow_in',
  }));

  return {
    version: 1,
    id: eventId,
    name: eventName,
    nodes,
    connections,
  };
}

const nonEmptyString = z.string().refine((value) => value.trim().length > 0, {
  message: 'Expected a non-empty string',
});

const eventIndexEntrySchema = z
  .object({
    id: canonicalEventIdSchema,
    name: nonEmptyString,
    description: z.string().optional(),
  })
  .strict();

const eventPackIndexSchema = z
  .object({
    version: z.literal(EVENT_PACK_INDEX_VERSION),
    name: z.string().optional(),
    events: z.array(eventIndexEntrySchema),
  })
  .strict()
  .superRefine((index, context) => {
    const seenIds = new Set<string>();

    index.events.forEach((event, eventIndex) => {
      if (seenIds.has(event.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate event ID: ${event.id}`,
          path: ['events', eventIndex, 'id'],
        });
      }
      seenIds.add(event.id);
    });
  });

export function parseCanonicalEventIndex(input: unknown): EventPackIndex {
  return eventPackIndexSchema.parse(input);
}

export interface CardPackNormalizationResult {
  files: Record<string, unknown>;
  index: EventPackIndex;
  workflows: CardWorkflowDefinition[];
  migrated: boolean;
}

const EVENTS_FILE_PATH = 'schema/events.json';
const CARD_FILE_PATH = 'schema/card.json';
const EVENT_FILE_RE = /^schema\/event-([a-z0-9][a-z0-9_-]{0,63})\.json$/;
const MAX_JSON_FILE_BYTES = 4 * 1024 * 1024;
const MAX_JSON_FILE_CHARACTERS = 4 * 1024 * 1024;
const MAX_JSON_TRAVERSAL_NODES = 100_000;
const MAX_STABLE_JSON_DEPTH = 64;

function throwFileError(
  code: EventPackFormatErrorCode,
  message: string,
  filePath: string,
  context: Readonly<Record<string, unknown>> = {},
): never {
  throwFormatError(code, message, { ...context, filePath }, filePath);
}

function throwInputLimitExceeded(
  message: string,
  filePath: string,
  context: Readonly<Record<string, unknown>>,
): never {
  return throwFileError('INPUT_LIMIT_EXCEEDED', message, filePath, context);
}

function isCanonicalEventFilePath(filePath: string): boolean {
  const match = EVENT_FILE_RE.exec(filePath);
  return match !== null && canonicalEventIdSchema.safeParse(match[1]).success;
}

function withFilePath(error: unknown, filePath: string): never {
  if (error instanceof EventPackFormatError) {
    throw new EventPackFormatError(
      error.code,
      error.message,
      { ...error.context, filePath },
      filePath,
    );
  }
  throw error;
}

function enforceJsonTraversalLimit(value: unknown, filePath: string): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let traversed = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > MAX_STABLE_JSON_DEPTH) {
      throwInputLimitExceeded(
        `JSON nesting depth exceeds the supported limit: ${filePath}`,
        filePath,
        {
          kind: 'json-depth',
          depth: current.depth,
          limit: MAX_STABLE_JSON_DEPTH,
        },
      );
    }

    traversed += 1;
    if (traversed > MAX_JSON_TRAVERSAL_NODES) {
      throwInputLimitExceeded(
        `JSON traversal exceeds the supported node limit: ${filePath}`,
        filePath,
        {
          kind: 'json-traversal',
          observed: traversed,
          limit: MAX_JSON_TRAVERSAL_NODES,
        },
      );
    }

    if (Array.isArray(current.value)) {
      const observed = traversed + pending.length + current.value.length;
      if (observed > MAX_JSON_TRAVERSAL_NODES) {
        throwInputLimitExceeded(
          `JSON traversal exceeds the supported node limit: ${filePath}`,
          filePath,
          {
            kind: 'json-traversal',
            observed,
            limit: MAX_JSON_TRAVERSAL_NODES,
          },
        );
      }
      for (let index = current.value.length - 1; index >= 0; index--) {
        pending.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }

    if (isPlainRecord(current.value)) {
      const keys = Object.keys(current.value);
      const observed = traversed + pending.length + keys.length;
      if (observed > MAX_JSON_TRAVERSAL_NODES) {
        throwInputLimitExceeded(
          `JSON traversal exceeds the supported node limit: ${filePath}`,
          filePath,
          {
            kind: 'json-traversal',
            observed,
            limit: MAX_JSON_TRAVERSAL_NODES,
          },
        );
      }
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]!;
        pending.push({ value: current.value[key], depth: current.depth + 1 });
      }
    }
  }
}

function enforceJsonTextLimits(
  filePath: string,
  text: string,
  byteLength: number,
): void {
  if (byteLength > MAX_JSON_FILE_BYTES) {
    throwInputLimitExceeded(
      `JSON file exceeds the byte limit: ${filePath}`,
      filePath,
      {
        kind: 'json-bytes',
        observed: byteLength,
        limit: MAX_JSON_FILE_BYTES,
      },
    );
  }
  if (text.length > MAX_JSON_FILE_CHARACTERS) {
    throwInputLimitExceeded(
      `JSON file exceeds the character limit: ${filePath}`,
      filePath,
      {
        kind: 'json-characters',
        observed: text.length,
        limit: MAX_JSON_FILE_CHARACTERS,
      },
    );
  }
}

function parseJsonFile(files: Readonly<Record<string, unknown>>, filePath: string): unknown {
  const value = files[filePath];
  let text: string | undefined;
  let byteLength: number | undefined;
  if (typeof value === 'string') {
    if (value.length > MAX_JSON_FILE_CHARACTERS) {
      throwInputLimitExceeded(
        `JSON file exceeds the character limit: ${filePath}`,
        filePath,
        {
          kind: 'json-characters',
          observed: value.length,
          limit: MAX_JSON_FILE_CHARACTERS,
        },
      );
    }
    text = value;
    byteLength = new TextEncoder().encode(value).byteLength;
  } else if (value instanceof Uint8Array) {
    if (value.byteLength > MAX_JSON_FILE_BYTES) {
      throwInputLimitExceeded(
        `JSON file exceeds the byte limit: ${filePath}`,
        filePath,
        {
          kind: 'json-bytes',
          observed: value.byteLength,
          limit: MAX_JSON_FILE_BYTES,
        },
      );
    }
    byteLength = value.byteLength;
    text = new TextDecoder().decode(value);
  } else if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    if (value.byteLength > MAX_JSON_FILE_BYTES) {
      throwInputLimitExceeded(
        `JSON file exceeds the byte limit: ${filePath}`,
        filePath,
        {
          kind: 'json-bytes',
          observed: value.byteLength,
          limit: MAX_JSON_FILE_BYTES,
        },
      );
    }
    byteLength = value.byteLength;
    text = new TextDecoder().decode(new Uint8Array(value));
  }

  if (text === undefined) {
    throwFileError(
      'JSON_MALFORMED',
      `JSON file is not readable as text: ${filePath}`,
      filePath,
      { valueType: value === null ? 'null' : typeof value },
    );
  }

  enforceJsonTextLimits(filePath, text, byteLength!);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (error instanceof RangeError) {
      throwInputLimitExceeded(
        `JSON parser exceeded the supported input depth: ${filePath}`,
        filePath,
        {
          kind: 'json-parse',
          limit: MAX_STABLE_JSON_DEPTH,
        },
      );
    }
    throwFileError(
      'JSON_MALFORMED',
      `Malformed JSON: ${filePath}`,
      filePath,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  enforceJsonTraversalLimit(parsed, filePath);
  return parsed;
}

function stableJson(
  value: unknown,
  filePath: string,
  context: Readonly<Record<string, unknown>> = {},
): string {
  let traversed = 0;

  const serialize = (current: unknown, depth: number): string => {
    if (depth > MAX_STABLE_JSON_DEPTH) {
      throwInputLimitExceeded(
        `Stable JSON nesting depth exceeds the supported limit: ${filePath}`,
        filePath,
        {
          ...context,
          kind: 'stable-json-depth',
          depth,
          limit: MAX_STABLE_JSON_DEPTH,
        },
      );
    }

    traversed += 1;
    if (traversed > MAX_JSON_TRAVERSAL_NODES) {
      throwInputLimitExceeded(
        `Stable JSON traversal exceeds the supported node limit: ${filePath}`,
        filePath,
        {
          ...context,
          kind: 'stable-json-traversal',
          observed: traversed,
          limit: MAX_JSON_TRAVERSAL_NODES,
        },
      );
    }

    if (Array.isArray(current)) {
      const observed = traversed + current.length;
      if (observed > MAX_JSON_TRAVERSAL_NODES) {
        throwInputLimitExceeded(
          `Stable JSON traversal exceeds the supported node limit: ${filePath}`,
          filePath,
          {
            ...context,
            kind: 'stable-json-traversal',
            observed,
            limit: MAX_JSON_TRAVERSAL_NODES,
          },
        );
      }
      const items = new Array<string>(current.length);
      for (let index = 0; index < current.length; index++) {
        items[index] = serialize(current[index], depth + 1);
      }
      return `[${items.join(',')}]`;
    }

    if (isPlainRecord(current)) {
      const keys = Object.keys(current).sort();
      const observed = traversed + keys.length;
      if (observed > MAX_JSON_TRAVERSAL_NODES) {
        throwInputLimitExceeded(
          `Stable JSON traversal exceeds the supported node limit: ${filePath}`,
          filePath,
          {
            ...context,
            kind: 'stable-json-traversal',
            observed,
            limit: MAX_JSON_TRAVERSAL_NODES,
          },
        );
      }
      const entries = new Array<string>(keys.length);
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!;
        entries[index] = `${JSON.stringify(key)}:${serialize(current[key], depth + 1)}`;
      }
      return `{${entries.join(',')}}`;
    }

    return JSON.stringify(current) ?? String(current);
  };

  return serialize(value, 0);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safeEventIdPart(value: unknown): string {
  const source = typeof value === 'string' ? value.toLowerCase() : 'event';
  const safe = source.replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  return safe || 'event';
}

function deriveLegacyEventId(
  manifest: Manifest,
  cardFile: unknown,
  filePath: string,
): string {
  const hash = stableHash(`${String(readOwn(manifest, 'id') ?? '')}\u0000${stableJson(cardFile, filePath)}`);
  const prefix = safeEventIdPart(readOwn(manifest, 'id'));
  return `${prefix.slice(0, 64 - hash.length - 1)}-${hash}`;
}

function requireEventName(value: unknown, filePath: string, eventId?: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throwFileError(
      'EVENT_NAME_INVALID',
      'Event name must be a non-empty string',
      filePath,
      { eventId, eventName: value },
    );
  }
  return value;
}

function requireEventId(value: unknown, filePath: string, index: number): string {
  if (typeof value !== 'string' || !canonicalEventIdSchema.safeParse(value).success) {
    throwFileError(
      'EVENT_ID_INVALID',
      `Invalid canonical event ID: ${String(value)}`,
      filePath,
      { eventId: value, index },
    );
  }
  return value;
}

interface LegacyIndexEntry {
  id: string;
  name: string;
  description?: string;
  raw: Record<string, unknown>;
}

function readLegacyIndex(raw: unknown, filePath: string): { name?: string; events: LegacyIndexEntry[] } {
  if (!isPlainRecord(raw)) {
    throwFileError('INDEX_INVALID', 'Event index must be an object', filePath);
  }
  if (readOwn(raw, 'version') !== 1) {
    throwFileError(
      'INDEX_VERSION_UNSUPPORTED',
      `Unsupported event index version: ${String(readOwn(raw, 'version'))}`,
      filePath,
    );
  }
  const rawEvents = readOwn(raw, 'events');
  if (!isPlainArray(rawEvents)) {
    throwFileError('INDEX_INVALID', 'Legacy event index must contain an events array', filePath);
  }
  const seen = new Set<string>();
  const events: LegacyIndexEntry[] = [];
  for (let index = 0; index < rawEvents.length; index++) {
    const event = rawEvents[index];
    if (!isPlainRecord(event)) {
      throwFileError('INDEX_INVALID', `Invalid event index entry at ${index}`, filePath, { index });
    }
    const id = requireEventId(readOwn(event, 'id'), filePath, index);
    if (seen.has(id)) {
      throwFileError('DUPLICATE_EVENT_ID', `Duplicate event ID: ${id}`, filePath, { eventId: id, index });
    }
    seen.add(id);
    const name = requireEventName(readOwn(event, 'name'), filePath, id);
    const description = readOwn(event, 'description');
    if (description !== undefined && typeof description !== 'string') {
      throwFileError('INDEX_INVALID', `Invalid event description: ${id}`, filePath, { eventId: id, index });
    }
    events.push({ id, name, ...(description === undefined ? {} : { description }), raw: event });
  }
  const name = readOwn(raw, 'name');
  if (name !== undefined && typeof name !== 'string') {
    throwFileError('INDEX_INVALID', 'Event index name must be a string', filePath);
  }
  return { name: name as string | undefined, events };
}

function readCanonicalIndex(raw: unknown, filePath: string): EventPackIndex {
  if (isPlainRecord(raw) && isPlainArray(readOwn(raw, 'events'))) {
    const seen = new Set<string>();
    for (const rawEvent of readOwn(raw, 'events') as unknown[]) {
      if (!isPlainRecord(rawEvent)) continue;
      const id = readOwn(rawEvent, 'id');
      if (typeof id === 'string') {
        if (seen.has(id)) {
          throwFileError('DUPLICATE_EVENT_ID', `Duplicate event ID: ${id}`, filePath, { eventId: id });
        }
        seen.add(id);
      }
    }
  }
  try {
    return parseCanonicalEventIndex(raw);
  } catch (error) {
    throwFileError(
      'INDEX_INVALID',
      `Invalid canonical event index: ${filePath}`,
      filePath,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

function migrateLegacyAtPath(
  cardFile: unknown,
  eventId: string,
  eventName: string,
  filePath: string,
): CardWorkflowDefinition {
  try {
    return migrateLegacyCardFile(cardFile, eventId, eventName);
  } catch (error) {
    withFilePath(error, filePath);
  }
}

const WORKFLOW_FIELDS = [
  'version', 'id', 'name', 'description', 'nodes', 'connections', 'metadata',
] as const;
const WORKFLOW_NODE_FIELDS = [
  'id', 'typeId', 'label', 'position', 'widgetValues', 'runtimeState',
] as const;
const WORKFLOW_POSITION_FIELDS = ['x', 'y'] as const;
const WORKFLOW_RUNTIME_FIELDS = ['executed', 'outputs', 'error'] as const;
const WORKFLOW_METADATA_FIELDS = [
  'author', 'createdAt', 'updatedAt', 'tags',
] as const;
const WORKFLOW_CONNECTION_FIELDS = [
  'id', 'sourceNodeId', 'sourceSocketKey', 'targetNodeId', 'targetSocketKey',
] as const;

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function requireWorkflowIdentifier(
  value: unknown,
  filePath: string,
  field: string,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throwFileError('WORKFLOW_INVALID', `Invalid workflow ${field}: ${String(value)}`, filePath, { field });
  }
  return value;
}

function requireWorkflowName(value: unknown, filePath: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throwFileError('WORKFLOW_INVALID', `Invalid workflow ${field}`, filePath, { field });
  }
  return value;
}

function validateWorkflowMetadata(value: unknown, filePath: string): void {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, WORKFLOW_METADATA_FIELDS)) {
    throwFileError('WORKFLOW_INVALID', `Invalid workflow metadata: ${filePath}`, filePath, { field: 'metadata' });
  }
  for (const field of ['author', 'createdAt', 'updatedAt'] as const) {
    const fieldValue = readOwn(value, field);
    if (fieldValue !== undefined && typeof fieldValue !== 'string') {
      throwFileError('WORKFLOW_INVALID', `Invalid workflow metadata field: ${field}`, filePath, { field: `metadata.${field}` });
    }
  }
  const tags = readOwn(value, 'tags');
  if (
    tags !== undefined &&
    (!isPlainArray(tags) || tags.some((tag) => typeof tag !== 'string'))
  ) {
    throwFileError('WORKFLOW_INVALID', 'Invalid workflow metadata tags', filePath, { field: 'metadata.tags' });
  }
}

function validateWorkflowRuntimeState(value: unknown, filePath: string): void {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, WORKFLOW_RUNTIME_FIELDS)) {
    throwFileError('WORKFLOW_INVALID', `Invalid workflow runtime state: ${filePath}`, filePath, { field: 'runtimeState' });
  }
  const executed = readOwn(value, 'executed');
  if (executed !== undefined && typeof executed !== 'boolean') {
    throwFileError('WORKFLOW_INVALID', 'Invalid workflow runtime executed flag', filePath, { field: 'runtimeState.executed' });
  }
  const outputs = readOwn(value, 'outputs');
  if (outputs !== undefined && !isPlainRecord(outputs)) {
    throwFileError('WORKFLOW_INVALID', 'Invalid workflow runtime outputs', filePath, { field: 'runtimeState.outputs' });
  }
  const error = readOwn(value, 'error');
  if (error !== undefined && typeof error !== 'string') {
    throwFileError('WORKFLOW_INVALID', 'Invalid workflow runtime error', filePath, { field: 'runtimeState.error' });
  }
}

function readCanonicalWorkflow(
  raw: unknown,
  entry: EventPackIndex['events'][number],
  filePath: string,
): CardWorkflowDefinition {
  if (!isPlainRecord(raw) || !hasOnlyKeys(raw, WORKFLOW_FIELDS)) {
    throwFileError('WORKFLOW_INVALID', `Invalid workflow object: ${filePath}`, filePath);
  }

  const version = readOwn(raw, 'version');
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    throwFileError('WORKFLOW_INVALID', `Invalid workflow version: ${filePath}`, filePath, { field: 'version' });
  }

  const id = requireWorkflowIdentifier(readOwn(raw, 'id'), filePath, 'id');
  const name = requireWorkflowName(readOwn(raw, 'name'), filePath, 'name');
  if (id !== entry.id || name !== entry.name) {
    throwFileError(
      'INDEX_FILE_MISMATCH',
      `Workflow does not match index entry: ${filePath}`,
      filePath,
      { expectedId: entry.id, actualId: id, expectedName: entry.name, actualName: name },
    );
  }

  const description = readOwn(raw, 'description');
  if (description !== undefined && typeof description !== 'string') {
    throwFileError('WORKFLOW_INVALID', 'Invalid workflow description', filePath, { field: 'description' });
  }
  const metadata = readOwn(raw, 'metadata');
  if (metadata !== undefined) validateWorkflowMetadata(metadata, filePath);

  const rawNodes = readOwn(raw, 'nodes');
  const rawConnections = readOwn(raw, 'connections');
  if (!isPlainArray(rawNodes) || !isPlainArray(rawConnections)) {
    throwFileError('WORKFLOW_INVALID', `Invalid workflow arrays: ${filePath}`, filePath);
  }

  const nodeMap = new Map<string, { definition: NonNullable<ReturnType<typeof getCardNodeDefinition>> }>();
  for (let index = 0; index < rawNodes.length; index++) {
    const rawNode = rawNodes[index];
    if (!isPlainRecord(rawNode) || !hasOnlyKeys(rawNode, WORKFLOW_NODE_FIELDS)) {
      throwFileError('WORKFLOW_INVALID', `Invalid workflow node at ${index}`, filePath, { field: `nodes[${index}]` });
    }
    const nodeId = requireWorkflowIdentifier(readOwn(rawNode, 'id'), filePath, `nodes[${index}].id`);
    if (nodeMap.has(nodeId)) {
      throwFileError('WORKFLOW_INVALID', `Duplicate workflow node ID: ${nodeId}`, filePath, { field: `nodes[${index}].id` });
    }

    const typeId = readOwn(rawNode, 'typeId');
    if (typeof typeId !== 'string') {
      throwFileError('WORKFLOW_INVALID', `Invalid workflow node type: ${String(typeId)}`, filePath, { field: `nodes[${index}].typeId` });
    }
    const definition = getCardNodeDefinition(typeId as CardNodeType);
    if (!definition) {
      throwFileError('WORKFLOW_INVALID', `Unknown workflow node type: ${typeId}`, filePath, { field: `nodes[${index}].typeId` });
    }

    const position = readOwn(rawNode, 'position');
    if (
      !isPlainRecord(position) ||
      !hasOnlyKeys(position, WORKFLOW_POSITION_FIELDS) ||
      typeof readOwn(position, 'x') !== 'number' ||
      !Number.isFinite(readOwn(position, 'x') as number) ||
      typeof readOwn(position, 'y') !== 'number' ||
      !Number.isFinite(readOwn(position, 'y') as number)
    ) {
      throwFileError('WORKFLOW_INVALID', `Invalid workflow node position at ${index}`, filePath, { field: `nodes[${index}].position` });
    }

    const label = readOwn(rawNode, 'label');
    if (label !== undefined && typeof label !== 'string') {
      throwFileError('WORKFLOW_INVALID', `Invalid workflow node label at ${index}`, filePath, { field: `nodes[${index}].label` });
    }
    const widgetValues = readOwn(rawNode, 'widgetValues');
    if (widgetValues !== undefined && !isPlainRecord(widgetValues)) {
      throwFileError('WORKFLOW_INVALID', `Invalid workflow widget values at ${index}`, filePath, { field: `nodes[${index}].widgetValues` });
    }
    const runtimeState = readOwn(rawNode, 'runtimeState');
    if (runtimeState !== undefined) validateWorkflowRuntimeState(runtimeState, filePath);

    nodeMap.set(nodeId, { definition });
  }

  const validatedConnections: CardWorkflowConnection[] = [];
  const seenConnectionIds = new Set<string>();
  const seenConnectionShapes = new Set<string>();
  for (let index = 0; index < rawConnections.length; index++) {
    const rawConnection = rawConnections[index];
    if (!isPlainRecord(rawConnection) || !hasOnlyKeys(rawConnection, WORKFLOW_CONNECTION_FIELDS)) {
      throwFileError('WORKFLOW_INVALID', `Invalid workflow connection at ${index}`, filePath, { field: `connections[${index}]` });
    }
    const connectionId = requireWorkflowIdentifier(readOwn(rawConnection, 'id'), filePath, `connections[${index}].id`);
    if (seenConnectionIds.has(connectionId)) {
      throwFileError('WORKFLOW_INVALID', `Duplicate workflow connection ID: ${connectionId}`, filePath, { field: `connections[${index}].id` });
    }
    seenConnectionIds.add(connectionId);

    const sourceNodeId = requireWorkflowIdentifier(readOwn(rawConnection, 'sourceNodeId'), filePath, `connections[${index}].sourceNodeId`);
    const sourceSocketKey = requireWorkflowIdentifier(readOwn(rawConnection, 'sourceSocketKey'), filePath, `connections[${index}].sourceSocketKey`);
    const targetNodeId = requireWorkflowIdentifier(readOwn(rawConnection, 'targetNodeId'), filePath, `connections[${index}].targetNodeId`);
    const targetSocketKey = requireWorkflowIdentifier(readOwn(rawConnection, 'targetSocketKey'), filePath, `connections[${index}].targetSocketKey`);
    const source = nodeMap.get(sourceNodeId);
    const target = nodeMap.get(targetNodeId);
    if (!source || !target) {
      throwFileError('WORKFLOW_INVALID', `Workflow connection references an unknown node at ${index}`, filePath, { field: `connections[${index}]` });
    }

    const shape = `${sourceNodeId}\u0000${sourceSocketKey}\u0000${targetNodeId}\u0000${targetSocketKey}`;
    if (seenConnectionShapes.has(shape)) {
      throwFileError('WORKFLOW_INVALID', `Duplicate workflow connection at ${index}`, filePath, { field: `connections[${index}]` });
    }
    seenConnectionShapes.add(shape);

    const connectionError = validateCardConnection(
      source.definition,
      sourceSocketKey,
      target.definition,
      targetSocketKey,
      validatedConnections,
      targetNodeId,
    );
    if (connectionError) {
      throwFileError('WORKFLOW_INVALID', connectionError, filePath, { field: `connections[${index}]` });
    }
    validatedConnections.push({
      id: connectionId,
      sourceNodeId,
      sourceSocketKey,
      targetNodeId,
      targetSocketKey,
    });
  }

  return raw as unknown as CardWorkflowDefinition;
}

export interface CanonicalEventPackView {
  index: EventPackIndex;
  workflows: CardWorkflowDefinition[];
  workflowByEventId: ReadonlyMap<string, CardWorkflowDefinition>;
  eventIds: string[];
  eventCount: number;
  workflowNodeCount: number;
}

/** Strict runtime reader. Legacy shapes are accepted only by normalizeCardPackFiles. */
export function readCanonicalEventPack(
  files: Readonly<Record<string, unknown>>,
): CanonicalEventPackView {
  if (Object.prototype.hasOwnProperty.call(files, CARD_FILE_PATH)) {
    throwFileError(
      'INPUT_CONFLICT',
      `Legacy card file is not valid at runtime: ${CARD_FILE_PATH}`,
      CARD_FILE_PATH,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(files, EVENTS_FILE_PATH)) {
    throwFileError('INDEX_MISSING', `Missing canonical event index: ${EVENTS_FILE_PATH}`, EVENTS_FILE_PATH);
  }

  const index = readCanonicalIndex(parseJsonFile(files, EVENTS_FILE_PATH), EVENTS_FILE_PATH);
  const workflows = index.events.map((entry) => {
    const filePath = `schema/event-${entry.id}.json`;
    if (!Object.prototype.hasOwnProperty.call(files, filePath)) {
      throwFileError('WORKFLOW_MISSING', `Missing workflow: ${filePath}`, filePath, { eventId: entry.id });
    }
    return readCanonicalWorkflow(parseJsonFile(files, filePath), entry, filePath);
  });
  const workflowByEventId = new Map(workflows.map((workflow) => [workflow.id, workflow]));

  return {
    index,
    workflows,
    workflowByEventId,
    eventIds: index.events.map((entry) => entry.id),
    eventCount: index.events.length,
    workflowNodeCount: workflows.reduce((count, workflow) => count + workflow.nodes.length, 0),
  };
}

function writeCanonicalFiles(
  inputFiles: Readonly<Record<string, unknown>>,
  index: EventPackIndex,
  workflows: CardWorkflowDefinition[],
): Record<string, unknown> {
  const files = { ...inputFiles };
  for (const filePath of Object.keys(files)) {
    if (filePath === CARD_FILE_PATH || isCanonicalEventFilePath(filePath)) delete files[filePath];
  }
  files[EVENTS_FILE_PATH] = JSON.stringify(index, null, 2);
  for (const workflow of workflows) {
    files[`schema/event-${workflow.id}.json`] = JSON.stringify(workflow, null, 2);
  }
  return files;
}

function canonicalIndexFromEntries(
  name: string | undefined,
  entries: Array<{ id: string; name: string; description?: string }>,
): EventPackIndex {
  return {
    version: EVENT_PACK_INDEX_VERSION,
    ...(name === undefined ? {} : { name }),
    events: entries.map(({ id, name: eventName, description }) => ({
      id,
      name: eventName,
      ...(description === undefined ? {} : { description }),
    })),
  };
}

/** Detects, migrates, validates, and idempotently writes all supported event-pack variants. */
export function normalizeCardPackFiles(
  manifest: Manifest,
  inputFiles: Readonly<Record<string, unknown>>,
): CardPackNormalizationResult {
  const files = { ...inputFiles };
  const eventFilePaths = Object.keys(files).filter(isCanonicalEventFilePath);
  const hasEventsIndex = Object.prototype.hasOwnProperty.call(files, EVENTS_FILE_PATH);
  const hasCardFile = Object.prototype.hasOwnProperty.call(files, CARD_FILE_PATH);

  if (!hasEventsIndex && !hasCardFile) {
    throwFileError('INDEX_MISSING', 'Event pack has no event index or card file', EVENTS_FILE_PATH);
  }

  let index: EventPackIndex;
  let workflows: CardWorkflowDefinition[];
  let legacy = false;

  if (!hasEventsIndex) {
    legacy = true;
    const cardFile = parseJsonFile(files, CARD_FILE_PATH);
    const eventName = requireEventName(readOwn(manifest, 'name'), 'manifest.json');
    const eventId = deriveLegacyEventId(manifest, cardFile, CARD_FILE_PATH);
    const workflow = migrateLegacyAtPath(cardFile, eventId, eventName, CARD_FILE_PATH);
    index = canonicalIndexFromEntries(undefined, [{ id: eventId, name: eventName }]);
    workflows = [workflow];
  } else {
    const rawIndex = parseJsonFile(files, EVENTS_FILE_PATH);
    if (!isPlainRecord(rawIndex)) {
      throwFileError('INDEX_INVALID', 'Event index must be an object', EVENTS_FILE_PATH);
    }
    const version = readOwn(rawIndex, 'version');
    if (version === EVENT_PACK_INDEX_VERSION) {
      index = readCanonicalIndex(rawIndex, EVENTS_FILE_PATH);
      if (hasCardFile) {
        throwFileError(
          'INPUT_CONFLICT',
          'A legacy card file cannot be combined with a version-2 event index',
          CARD_FILE_PATH,
        );
      }
      workflows = index.events.map((entry) => {
        const filePath = `schema/event-${entry.id}.json`;
        if (!Object.prototype.hasOwnProperty.call(files, filePath)) {
          throwFileError('WORKFLOW_MISSING', `Missing workflow: ${filePath}`, filePath, { eventId: entry.id });
        }
        return readCanonicalWorkflow(parseJsonFile(files, filePath), entry, filePath);
      });
    } else {
      legacy = true;
      const legacyIndex = readLegacyIndex(rawIndex, EVENTS_FILE_PATH);
      if (hasCardFile) {
        if (legacyIndex.events.length !== 1) {
          throwFileError(
            'INPUT_CONFLICT',
            'A legacy card file can only be assigned to one v1 event',
            CARD_FILE_PATH,
          );
        }
        const event = legacyIndex.events[0]!;
        const filePath = `schema/event-${event.id}.json`;
        const hasEmbedded = Object.prototype.hasOwnProperty.call(event.raw, 'cards') ||
          Object.prototype.hasOwnProperty.call(event.raw, 'puck');
        const hasPerEventFile = Object.prototype.hasOwnProperty.call(files, filePath);
        if (hasEmbedded || hasPerEventFile) {
          throwFileError(
            'INPUT_CONFLICT',
            'A legacy card file cannot be combined with another v1 workflow source',
            CARD_FILE_PATH,
            { eventId: event.id },
          );
        }
      }
      let fallbackCardFile: unknown;
      const readFallbackCardFile = (): unknown => {
        if (fallbackCardFile === undefined) {
          fallbackCardFile = parseJsonFile(files, CARD_FILE_PATH);
        }
        return fallbackCardFile;
      };
      if (hasCardFile && legacyIndex.events.length === 0) {
        throwFileError(
          'INPUT_CONFLICT',
          'A legacy card file cannot be reconciled with an empty event index',
          CARD_FILE_PATH,
        );
      }
      const entries = legacyIndex.events.map(({ id, name, description, raw }) => {
        const filePath = `schema/event-${id}.json`;
        const hasEmbedded = Object.prototype.hasOwnProperty.call(raw, 'cards') ||
          Object.prototype.hasOwnProperty.call(raw, 'puck');
        const hasPerEventFile = Object.prototype.hasOwnProperty.call(files, filePath);
        const embeddedWorkflow = hasEmbedded
          ? migrateLegacyAtPath({
            version: 1,
            puck: readOwn(raw, 'puck'),
            cards: readOwn(raw, 'cards'),
          }, id, name, EVENTS_FILE_PATH)
          : undefined;
        const fileWorkflow = hasPerEventFile
          ? migrateLegacyAtPath(parseJsonFile(files, filePath), id, name, filePath)
          : undefined;

        if (embeddedWorkflow && fileWorkflow) {
          if (
            stableJson(embeddedWorkflow, EVENTS_FILE_PATH, { eventId: id }) !==
            stableJson(fileWorkflow, filePath, { eventId: id })
          ) {
            throwFileError(
              'INPUT_CONFLICT',
              `Embedded and per-event legacy workflows disagree: ${id}`,
              filePath,
              { eventId: id },
            );
          }
        }

        const workflow = fileWorkflow ?? embeddedWorkflow;
        if (workflow) {
          return { id, name, description, workflow };
        }
        if (hasCardFile && legacyIndex.events.length === 1) {
          return {
            id,
            name,
            description,
            workflow: migrateLegacyAtPath(readFallbackCardFile(), id, name, CARD_FILE_PATH),
          };
        }
        if (hasCardFile) {
          throwFileError(
            'INPUT_CONFLICT',
            'A single legacy card file cannot be assigned to multiple events',
            CARD_FILE_PATH,
            { eventId: id },
          );
        }
        if (!hasEmbedded && !hasPerEventFile) {
          throwFileError('WORKFLOW_MISSING', `Missing workflow: ${filePath}`, filePath, { eventId: id });
        }
        throwFileError('WORKFLOW_INVALID', `Invalid legacy workflow: ${filePath}`, filePath, { eventId: id });
      });
      index = canonicalIndexFromEntries(legacyIndex.name, entries);
      workflows = entries.map((entry) => entry.workflow);
    }
  }

  const expectedPaths = new Set(workflows.map((workflow) => `schema/event-${workflow.id}.json`));
  const staleEventFiles = eventFilePaths.some((filePath) => !expectedPaths.has(filePath));
  const migrated = legacy || hasCardFile || staleEventFiles;
  return {
    files: writeCanonicalFiles(files, index, workflows),
    index,
    workflows,
    migrated,
  };
}
