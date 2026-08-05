import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
import type {
  CardWorkflowDefinition,
  EventPackIndex,
  Manifest,
} from './schema';
import {
  EVENT_PACK_INDEX_VERSION,
  EventPackFormatError,
  type EventPackFormatErrorCode,
  type LegacyCardFile as CardFile,
  migrateLegacyCardFile,
  normalizeCardPackFiles,
  parseCanonicalEventIndex,
} from './eventPackFormat';
import { getCardNodeDefinition } from './cardNodeRegistry';

type ZodIssueCode = ZodError['issues'][number]['code'];

function getZodError(input: unknown): ZodError {
  try {
    parseCanonicalEventIndex(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
    if (error instanceof ZodError) return error;
    throw error;
  }

  throw new Error('Expected parseCanonicalEventIndex to throw ZodError');
}

function expectZodIssue(
  error: ZodError,
  expectedPath: PropertyKey[],
  expectedCode: ZodIssueCode,
): void {
  const issue = error.issues.find(
    (candidate) =>
      JSON.stringify(candidate.path) === JSON.stringify(expectedPath),
  );

  expect(issue).toBeDefined();
  expect(issue?.code).toBe(expectedCode);
}

function indexWithId(id: string): unknown {
  return {
    version: EVENT_PACK_INDEX_VERSION,
    events: [{ id, name: '事件一' }],
  };
}

describe('parseCanonicalEventIndex', () => {
  test('accepts a version-2 metadata-only event index', () => {
    const parsed = parseCanonicalEventIndex({
      version: EVENT_PACK_INDEX_VERSION,
      name: '测试包',
      events: [{ id: 'evt-one', name: '事件一', description: '说明' }],
    });
    const index: EventPackIndex = parsed;
    const version: 2 = index.version;

    expect(version).toBe(2);
    expect(parsed.events).toEqual([
      { id: 'evt-one', name: '事件一', description: '说明' },
    ]);
    expect('cards' in parsed.events[0]).toBe(false);
  });

  test('rejects unknown event fields with their object path', () => {
    const error = getZodError({
      version: EVENT_PACK_INDEX_VERSION,
      events: [{ id: 'evt-one', name: '事件一', cards: [] }],
    });

    expectZodIssue(error, ['events', 0], 'unrecognized_keys');
  });

  test('rejects duplicate event IDs at the duplicate ID path', () => {
    const error = getZodError({
      version: EVENT_PACK_INDEX_VERSION,
      events: [
        { id: 'evt-one', name: '事件一' },
        { id: 'evt-one', name: '事件二' },
      ],
    });

    expectZodIssue(error, ['events', 1, 'id'], 'custom');
  });

  test('rejects empty event IDs at the ID path', () => {
    const error = getZodError(indexWithId(''));

    expectZodIssue(error, ['events', 0, 'id'], 'invalid_format');
  });

  test('rejects empty event names at the name path', () => {
    const error = getZodError({
      version: EVENT_PACK_INDEX_VERSION,
      events: [{ id: 'evt-one', name: '   ' }],
    });

    expectZodIssue(error, ['events', 0, 'name'], 'custom');
  });

  const invalidEventIdCases: ReadonlyArray<readonly [string, string]> = [
    ['a forward slash', 'evt/one'],
    ['a backslash', 'evt\\one'],
    ['parent-directory syntax', '..'],
    ['a colon', 'evt:one'],
    ['a control character', 'evt\u0000one'],
    ['leading whitespace', ' evt-one'],
    ['trailing whitespace', 'evt-one '],
    ['uppercase ASCII', 'Evt-one'],
    ['more than 64 characters', 'a'.repeat(65)],
  ];

  for (const [caseName, id] of invalidEventIdCases) {
    test(`rejects event IDs containing ${caseName}`, () => {
      const error = getZodError(indexWithId(id));

      expectZodIssue(error, ['events', 0, 'id'], 'invalid_format');
    });
  }
});

const orderedLegacyCardFile: CardFile = {
  version: 1,
  puck: {
    root: { props: {} },
    components: {
      choice: [
        {
          id: 'legacy-choice',
          props: {
            choices: [
              'Advance',
              {
                label: 'Wait',
                effect: { statId: 'attrA', delta: -2 },
                aiNote: 'The player chose to wait',
                customOptionProp: 'option-kept',
              },
            ],
            customLegacyField: 'kept',
          },
        },
      ],
      title: [
        {
          id: 'legacy-title',
          props: {
            title: 'An old title',
            style: 'important',
            customTitleProp: 17,
          },
        },
      ],
      narrative: [
        {
          id: 'legacy-narrative',
          props: {
            text: 'An old narrative',
            tone: 'tense',
          },
        },
      ],
    },
  },
  cards: [
    {
      id: 'legacy-title',
      componentId: 'title',
      title: 'An old title',
      kind: 'add',
    },
    {
      id: 'legacy-narrative',
      componentId: 'narrative',
      title: 'An old narrative',
      kind: 'add',
    },
    {
      id: 'legacy-choice',
      componentId: 'choice',
      title: 'An old choice',
      kind: 'add',
    },
  ],
};

function getFormatError(run: () => unknown): EventPackFormatError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EventPackFormatError);
    if (error instanceof EventPackFormatError) return error;
    throw error;
  }

  throw new Error('Expected operation to throw EventPackFormatError');
}

function singleBlockLegacyCardFile(
  componentType: string,
  props: Record<string, unknown>,
  componentId = `legacy-${componentType}`,
): CardFile {
  return {
    version: 1,
    puck: {
      root: { props: {} },
      components: {
        [componentType]: [{ id: componentId, props }],
      },
    },
    cards: [
      {
        id: componentId,
        componentId: componentType,
        title: componentId,
      },
    ],
  };
}

describe('migrateLegacyCardFile', () => {
  test('rejects a legacy CardFile envelope with a custom prototype', () => {
    const legacy = Object.assign(
      Object.create({ inheritedEnvelopeField: true }),
      orderedLegacyCardFile,
    );

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-inherited-envelope', 'Inherited envelope'),
    );

    expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-inherited-envelope',
      field: 'cardFile',
    });
  });

  test('rejects a Puck object with a custom prototype', () => {
    const puck = Object.assign(
      Object.create({ inheritedRoot: { props: {} } }),
      orderedLegacyCardFile.puck,
    );
    const legacy = { ...orderedLegacyCardFile, puck };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-inherited-puck', 'Inherited Puck'),
    );

    expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-inherited-puck',
      field: 'puck',
    });
  });

  test('rejects a cards entry with a custom prototype', () => {
    const card = Object.assign(
      Object.create({ componentId: 'title' }),
      {
        id: 'legacy-title',
        title: 'Inherited component ID',
      },
    );
    const legacy = {
      ...orderedLegacyCardFile,
      cards: [card],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-inherited-card', 'Inherited card'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-inherited-card',
      componentIndex: 0,
    });
  });

  test('rejects a cards array with a custom prototype', () => {
    const base = singleBlockLegacyCardFile(
      'title',
      { title: 'Custom cards array' },
      'custom-cards-array',
    );
    const cards = [...base.cards];
    Object.setPrototypeOf(cards, Object.create(Array.prototype));
    const legacy = { ...base, cards };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-custom-cards-array', 'Custom cards array'),
    );

    expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-custom-cards-array',
      field: 'cards',
    });
  });

  test('rejects a cards array with an inherited index', () => {
    const base = singleBlockLegacyCardFile(
      'title',
      { title: 'Inherited cards index' },
      'inherited-cards-index',
    );
    const cards = new Array<CardFile['cards'][number]>(1);
    const cardsPrototype = Object.create(Array.prototype, {
      0: {
        value: base.cards[0],
        enumerable: true,
        configurable: true,
      },
    });
    Object.setPrototypeOf(cards, cardsPrototype);
    const legacy = { ...base, cards };

    const error = getFormatError(() =>
      migrateLegacyCardFile(
        legacy,
        'evt-inherited-cards-index',
        'Inherited cards index',
      ),
    );

    expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-inherited-cards-index',
      field: 'cards',
    });
  });

  test('rejects a component group array with a custom prototype', () => {
    const base = singleBlockLegacyCardFile(
      'title',
      { title: 'Custom component group' },
      'custom-component-group',
    );
    const group = [...base.puck.components.title];
    Object.setPrototypeOf(group, Object.create(Array.prototype));
    const legacy = {
      ...base,
      puck: {
        ...base.puck,
        components: { ...base.puck.components, title: group },
      },
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(
        legacy,
        'evt-custom-component-group',
        'Custom component group',
      ),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-custom-component-group',
      componentType: 'title',
    });
  });

  test('rejects a component group array with an inherited index', () => {
    const base = singleBlockLegacyCardFile(
      'title',
      { title: 'Inherited component index' },
      'inherited-component-index',
    );
    const group = new Array<(typeof base.puck.components.title)[number]>(1);
    const groupPrototype = Object.create(Array.prototype, {
      0: {
        value: base.puck.components.title[0],
        enumerable: true,
        configurable: true,
      },
    });
    Object.setPrototypeOf(group, groupPrototype);
    const legacy = {
      ...base,
      puck: {
        ...base.puck,
        components: { ...base.puck.components, title: group },
      },
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(
        legacy,
        'evt-inherited-component-index',
        'Inherited component index',
      ),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-inherited-component-index',
      componentType: 'title',
    });
  });

  test('rejects an own non-enumerable component group', () => {
    const base = singleBlockLegacyCardFile(
      'title',
      { title: 'Non-enumerable component group' },
      'non-enumerable-component-group',
    );
    const components = Object.defineProperty({}, 'title', {
      value: base.puck.components.title,
      enumerable: false,
      configurable: true,
    }) as CardFile['puck']['components'];
    const legacy = {
      ...base,
      puck: { ...base.puck, components },
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(
        legacy,
        'evt-non-enumerable-component-group',
        'Non-enumerable component group',
      ),
    );

    expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-non-enumerable-component-group',
      field: 'puck.components',
    });
  });

  test('rejects a component map with an inherited enumerable component group', () => {
    const inheritedComponents = Object.create({
      title: [{ id: 'inherited-title', props: { title: 'Inherited' } }],
    });
    const legacy = {
      ...orderedLegacyCardFile,
      puck: {
        ...orderedLegacyCardFile.puck,
        components: inheritedComponents,
      },
      cards: [],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(
        legacy,
        'evt-inherited-group',
        'Inherited component group',
      ),
    );

    expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-inherited-group',
      field: 'puck.components',
    });
  });

  test('rejects a component payload with a custom prototype', () => {
    const payload = Object.assign(
      Object.create({ inheritedPayloadField: 'must not migrate' }),
      {
        id: 'custom-payload',
        props: { title: 'Own title' },
      },
    );
    const legacy = {
      ...orderedLegacyCardFile,
      puck: {
        ...orderedLegacyCardFile.puck,
        components: { title: [payload] },
      },
      cards: [],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-custom-payload', 'Custom payload'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-custom-payload',
      componentId: 'custom-payload',
      componentType: 'title',
    });
  });

  test('rejects component props with inherited semantic and extra fields', () => {
    const inheritedProps = Object.create({
      title: 'Inherited title',
      customLegacyField: 'must not migrate',
    });
    const legacy = {
      ...orderedLegacyCardFile,
      puck: {
        ...orderedLegacyCardFile.puck,
        components: {
          title: [{ id: 'inherited-props', props: inheritedProps }],
        },
      },
      cards: [],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-inherited-props', 'Inherited props'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-inherited-props',
      componentId: 'inherited-props',
      componentType: 'title',
    });
  });

  test('rejects object choices with inherited semantic and extra fields', () => {
    const inheritedChoice = Object.create({
      label: 'Inherited choice',
      aiNote: 'must not migrate',
    });
    const legacy = singleBlockLegacyCardFile('choice', {
      choices: [inheritedChoice],
    });

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-inherited-choice', 'Inherited choice'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-inherited-choice',
      componentId: 'legacy-choice',
      componentType: 'choice',
      field: 'choices[0]',
    });
  });

  const invalidLegacyVersionCases: ReadonlyArray<readonly [string, unknown]> = [
    ['missing', undefined],
    ['invalid type', '1'],
    ['non-integer', 1.5],
    ['zero', 0],
    ['negative', -1],
  ];

  for (const [caseName, version] of invalidLegacyVersionCases) {
    test(`rejects a ${caseName} legacy CardFile version`, () => {
      const legacy =
        caseName === 'missing'
          ? {
              puck: orderedLegacyCardFile.puck,
              cards: orderedLegacyCardFile.cards,
            }
          : { ...orderedLegacyCardFile, version };

      const error = getFormatError(() =>
        migrateLegacyCardFile(legacy, 'evt-version', 'Invalid version'),
      );

      expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
      expect(error.context).toMatchObject({
        eventId: 'evt-version',
        field: 'version',
      });
    });
  }

  test('rejects a legacy CardFile with a missing Puck root', () => {
    const legacy = {
      version: 1,
      puck: {
        components: orderedLegacyCardFile.puck.components,
      },
      cards: orderedLegacyCardFile.cards,
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-missing-root', 'Missing root'),
    );

    expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-missing-root',
      field: 'puck.root',
    });
  });

  const invalidLegacyRootCases: ReadonlyArray<readonly [string, unknown]> = [
    ['an array', []],
    ['a custom-prototype object', Object.create({ props: {} })],
  ];

  for (const [caseName, root] of invalidLegacyRootCases) {
    test(`rejects ${caseName} as the legacy Puck root`, () => {
      const legacy = {
        ...orderedLegacyCardFile,
        puck: { ...orderedLegacyCardFile.puck, root },
      };

      const error = getFormatError(() =>
        migrateLegacyCardFile(legacy, 'evt-invalid-root', 'Invalid root'),
      );

      expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
      expect(error.context).toMatchObject({
        eventId: 'evt-invalid-root',
        field: 'puck.root',
      });
    });
  }

  const invalidLegacyRootPropsCases: ReadonlyArray<readonly [string, unknown]> = [
    ['an array', []],
    ['a custom-prototype object', Object.create({ inherited: true })],
  ];

  for (const [caseName, props] of invalidLegacyRootPropsCases) {
    test(`rejects ${caseName} as optional legacy Puck root props`, () => {
      const legacy = {
        ...orderedLegacyCardFile,
        puck: {
          ...orderedLegacyCardFile.puck,
          root: { props },
        },
      };

      const error = getFormatError(() =>
        migrateLegacyCardFile(legacy, 'evt-invalid-root-props', 'Invalid root props'),
      );

      expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
      expect(error.context).toMatchObject({
        eventId: 'evt-invalid-root-props',
        field: 'puck.root.props',
      });
    });
  }

  test('uses cards order over a different Puck component insertion order', () => {
    const workflow = migrateLegacyCardFile(
      orderedLegacyCardFile,
      'evt-one',
      'Legacy event',
    );

    expect(workflow).toMatchObject({
      version: 1,
      id: 'evt-one',
      name: 'Legacy event',
    });
    expect(workflow.nodes.map(({ id, typeId, position }) => ({
      id,
      typeId,
      position,
    }))).toEqual([
      {
        id: 'legacy-title',
        typeId: 'narrative.title',
        position: { x: 0, y: 0 },
      },
      {
        id: 'legacy-narrative',
        typeId: 'narrative.text',
        position: { x: 0, y: 120 },
      },
      {
        id: 'legacy-choice',
        typeId: 'choice.static',
        position: { x: 0, y: 240 },
      },
    ]);
  });

  test('preserves all legacy block props in widgetValues', () => {
    const workflow = migrateLegacyCardFile(
      orderedLegacyCardFile,
      'evt-one',
      'Legacy event',
    );

    expect(workflow.nodes[0].widgetValues).toEqual({
      title: 'An old title',
      style: 'important',
      customTitleProp: 17,
    });
    expect(workflow.nodes[1].widgetValues).toEqual({
      text: 'An old narrative',
      tone: 'tense',
    });
    expect(workflow.nodes[2].widgetValues).toMatchObject({
      choices: orderedLegacyCardFile.puck.components.choice[0].props.choices,
      customLegacyField: 'kept',
    });
  });

  test('normalizes string and object choices without losing effects, AI notes, or extra props', () => {
    const workflow = migrateLegacyCardFile(
      orderedLegacyCardFile,
      'evt-one',
      'Legacy event',
    );

    expect(JSON.parse(String(workflow.nodes[2].widgetValues?.options))).toEqual([
      { label: 'Advance' },
      {
        label: 'Wait',
        effect: { statId: 'attrA', delta: -2 },
        aiNote: 'The player chose to wait',
        customOptionProp: 'option-kept',
      },
    ]);
  });

  test('connects adjacent nodes deterministically through flow sockets', () => {
    const first = migrateLegacyCardFile(
      orderedLegacyCardFile,
      'evt-one',
      'Legacy event',
    );
    const second = migrateLegacyCardFile(
      orderedLegacyCardFile,
      'evt-one',
      'Legacy event',
    );

    expect(first.connections).toEqual([
      {
        id: 'legacy-flow-0',
        sourceNodeId: 'legacy-title',
        sourceSocketKey: 'flow_out',
        targetNodeId: 'legacy-narrative',
        targetSocketKey: 'flow_in',
      },
      {
        id: 'legacy-flow-1',
        sourceNodeId: 'legacy-narrative',
        sourceSocketKey: 'flow_out',
        targetNodeId: 'legacy-choice',
        targetSocketKey: 'flow_in',
      },
    ]);
    expect(second.connections).toEqual(first.connections);
  });

  test('emits connections whose source and target ports exist in the node definitions', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          title: [
            { id: 'legacy-title-one', props: { title: 'First title' } },
            { id: 'legacy-title-two', props: { title: 'Second title' } },
          ],
        },
      },
      cards: [
        { id: 'legacy-title-one', componentId: 'title', title: 'First title' },
        { id: 'legacy-title-two', componentId: 'title', title: 'Second title' },
      ],
    };

    const workflow = migrateLegacyCardFile(legacy, 'evt-title-ports', 'Title ports');
    const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));

    for (const connection of workflow.connections) {
      const sourceNode = nodesById.get(connection.sourceNodeId);
      const targetNode = nodesById.get(connection.targetNodeId);
      const sourceDef = sourceNode && getCardNodeDefinition(sourceNode.typeId);
      const targetDef = targetNode && getCardNodeDefinition(targetNode.typeId);

      expect(sourceDef).toBeDefined();
      expect(targetDef).toBeDefined();
      expect(sourceDef?.outputs.some((socket) => socket.key === connection.sourceSocketKey)).toBe(true);
      expect(targetDef?.inputs.some((socket) => socket.key === connection.targetSocketKey)).toBe(true);
    }
  });

  test('falls back to Puck component insertion order when cards is empty', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          narrative: [
            { id: 'narrative-first', props: { text: 'First' } },
            { id: 'narrative-second', props: { text: 'Second' } },
          ],
          title: [{ id: 'title-last', props: { title: 'Last' } }],
        },
      },
      cards: [],
    };

    const workflow = migrateLegacyCardFile(
      legacy,
      'evt-fallback',
      'Fallback event',
    );

    expect(workflow.nodes.map((node) => node.id)).toEqual([
      'narrative-first',
      'narrative-second',
      'title-last',
    ]);
  });

  test('rejects unsupported components with stable event and component context', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          video: [{ id: 'legacy-video', props: { src: 'video.mp4' } }],
        },
      },
      cards: [
        {
          id: 'legacy-video',
          componentId: 'video',
          title: 'Video',
        },
      ],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-video', 'Video event'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_UNSUPPORTED');
    expect(error.context).toMatchObject({
      eventId: 'evt-video',
      componentId: 'legacy-video',
      componentType: 'video',
    });
  });

  test('rejects prototype-key component types referenced by the cards index', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          toString: [{ id: 'legacy-prototype', props: {} }],
        },
      },
      cards: [
        {
          id: 'legacy-prototype',
          componentId: 'toString',
          title: 'Prototype',
        },
      ],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-prototype', 'Prototype event'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_UNSUPPORTED');
    expect(error.context).toMatchObject({
      eventId: 'evt-prototype',
      componentId: 'legacy-prototype',
      componentType: 'toString',
    });
  });

  test('rejects prototype-key component types in empty-cards fallback', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          constructor: [{ id: 'legacy-constructor', props: {} }],
        },
      },
      cards: [],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-constructor', 'Constructor event'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_UNSUPPORTED');
    expect(error.context).toMatchObject({
      eventId: 'evt-constructor',
      componentId: 'legacy-constructor',
      componentType: 'constructor',
    });
  });

  test('rejects an unindexed unknown component group when cards is non-empty', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          title: [{ id: 'indexed-title', props: { title: 'Indexed' } }],
          video: [{ id: 'unindexed-video', props: { src: 'video.mp4' } }],
        },
      },
      cards: [
        { id: 'indexed-title', componentId: 'title', title: 'Indexed' },
      ],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-unindexed-unknown', 'Unknown data'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_UNSUPPORTED');
    expect(error.context).toMatchObject({
      eventId: 'evt-unindexed-unknown',
      componentId: 'unindexed-video',
      componentType: 'video',
    });
  });

  test('rejects an unindexed supported payload when cards is non-empty', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          title: [{ id: 'indexed-title', props: { title: 'Indexed' } }],
          narrative: [
            { id: 'unindexed-text', props: { text: 'Would be dropped' } },
          ],
        },
      },
      cards: [
        { id: 'indexed-title', componentId: 'title', title: 'Indexed' },
      ],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-unindexed', 'Unindexed data'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_UNINDEXED');
    expect(error.context).toMatchObject({
      eventId: 'evt-unindexed',
      componentId: 'unindexed-text',
      componentType: 'narrative',
    });
  });

  test('rejects duplicate Puck payload IDs before cards selection', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          title: [
            { id: 'duplicate-payload', props: { title: 'First' } },
            { id: 'duplicate-payload', props: { title: 'Second' } },
          ],
        },
      },
      cards: [
        {
          id: 'duplicate-payload',
          componentId: 'title',
          title: 'Duplicate',
        },
      ],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-payload-duplicate', 'Duplicate data'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_DUPLICATE');
    expect(error.context).toMatchObject({
      eventId: 'evt-payload-duplicate',
      componentId: 'duplicate-payload',
      componentType: 'title',
    });
  });

  test('rejects cards entries that reference inherited component groups', () => {
    const inheritedComponents = Object.create({
      title: [{ id: 'inherited-title', props: { title: 'Inherited' } }],
    }) as CardFile['puck']['components'];
    const legacy: CardFile = {
      version: 1,
      puck: { root: { props: {} }, components: inheritedComponents },
      cards: [
        { id: 'inherited-title', componentId: 'title', title: 'Inherited' },
      ],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-inherited', 'Inherited data'),
    );

    expect(error.code).toBe('LEGACY_CARD_FILE_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-inherited',
      field: 'puck.components',
    });
  });

  test('rejects a cards entry whose exact Puck payload is missing', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          title: [{ id: 'different-title', props: { title: 'Wrong' } }],
        },
      },
      cards: [
        { id: 'missing-title', componentId: 'title', title: 'Missing' },
      ],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-missing', 'Missing event'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_MISSING');
    expect(error.context).toMatchObject({
      eventId: 'evt-missing',
      componentId: 'missing-title',
      componentType: 'title',
    });
  });

  test('rejects duplicate legacy node IDs instead of renaming them', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          title: [{ id: 'duplicate-node', props: { title: 'One' } }],
          narrative: [
            { id: 'duplicate-node', props: { text: 'Two' } },
          ],
        },
      },
      cards: [],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-duplicate', 'Duplicate event'),
    );

    expect(error.code).toBe('LEGACY_NODE_ID_DUPLICATE');
    expect(error.context).toMatchObject({
      eventId: 'evt-duplicate',
      nodeId: 'duplicate-node',
    });
  });

  test('rejects unusable legacy node IDs instead of replacing them', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          title: [{ id: ' broken-title ', props: { title: 'Broken' } }],
        },
      },
      cards: [],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-invalid-node', 'Invalid node'),
    );

    expect(error.code).toBe('LEGACY_NODE_ID_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-invalid-node',
      nodeId: ' broken-title ',
      componentType: 'title',
    });
  });

  test('rejects malformed component payloads explicitly', () => {
    const legacy = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          title: [{ id: 'broken-title', props: null }],
        },
      },
      cards: [],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-broken', 'Broken event'),
    );

    expect(error.code).toBe('LEGACY_COMPONENT_INVALID');
    expect(error.context).toMatchObject({
      eventId: 'evt-broken',
      componentId: 'broken-title',
      componentType: 'title',
    });
  });

  test('rejects multiple legacy choice blocks instead of losing a choice group at runtime', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          choice: [
            { id: 'choice-one', props: { choices: ['First'] } },
            { id: 'choice-two', props: { choices: ['Second'] } },
          ],
        },
      },
      cards: [
        { id: 'choice-one', componentId: 'choice', title: 'First' },
        { id: 'choice-two', componentId: 'choice', title: 'Second' },
      ],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-two-choices', 'Two choices'),
    );

    expect(error.code).toBe('LEGACY_MULTIPLE_CHOICES_UNSUPPORTED');
    expect(error.context).toMatchObject({
      eventId: 'evt-two-choices',
      componentId: 'choice-two',
      componentType: 'choice',
      choiceCount: 2,
    });
  });

  const invalidSemanticCases: ReadonlyArray<{
    name: string;
    componentType: string;
    props: Record<string, unknown>;
    field: string;
  }> = [
    {
      name: 'a blank title',
      componentType: 'title',
      props: { title: '   ' },
      field: 'title',
    },
    {
      name: 'a non-string title',
      componentType: 'title',
      props: { title: 42 },
      field: 'title',
    },
    {
      name: 'blank narrative text',
      componentType: 'narrative',
      props: { text: '   ' },
      field: 'text',
    },
    {
      name: 'non-string narrative text',
      componentType: 'narrative',
      props: { text: false },
      field: 'text',
    },
    {
      name: 'an empty choices array',
      componentType: 'choice',
      props: { choices: [] },
      field: 'choices',
    },
    {
      name: 'a blank string choice',
      componentType: 'choice',
      props: { choices: ['   '] },
      field: 'choices[0]',
    },
    {
      name: 'an object choice with no label',
      componentType: 'choice',
      props: { choices: [{ aiNote: 'missing label' }] },
      field: 'choices[0].label',
    },
    {
      name: 'an object choice with a non-string label',
      componentType: 'choice',
      props: { choices: [{ label: 42 }] },
      field: 'choices[0].label',
    },
    {
      name: 'an object choice with a blank label',
      componentType: 'choice',
      props: { choices: [{ label: '   ' }] },
      field: 'choices[0].label',
    },
  ];

  for (const semanticCase of invalidSemanticCases) {
    test(`rejects ${semanticCase.name}`, () => {
      const legacy = singleBlockLegacyCardFile(
        semanticCase.componentType,
        semanticCase.props,
      );

      const error = getFormatError(() =>
        migrateLegacyCardFile(legacy, 'evt-semantic', 'Semantic event'),
      );

      expect(error.code).toBe('LEGACY_COMPONENT_INVALID');
      expect(error.context).toMatchObject({
        eventId: 'evt-semantic',
        componentId: `legacy-${semanticCase.componentType}`,
        componentType: semanticCase.componentType,
        field: semanticCase.field,
      });
    });
  }

  test('validates event IDs with the canonical event ID rules', () => {
    const error = getFormatError(() =>
      migrateLegacyCardFile(orderedLegacyCardFile, 'evt/unsafe', 'Unsafe'),
    );

    expect(error.code).toBe('EVENT_ID_INVALID');
    expect(error.context).toEqual({ eventId: 'evt/unsafe' });
  });

  test('rejects a blank event name', () => {
    const error = getFormatError(() =>
      migrateLegacyCardFile(orderedLegacyCardFile, 'evt-blank-name', '   '),
    );

    expect(error.code).toBe('EVENT_NAME_INVALID');
    expect(error.context).toEqual({
      eventId: 'evt-blank-name',
      eventName: '   ',
    });
  });

  test('rejects a non-string event name with a structured error', () => {
    const error = getFormatError(() =>
      migrateLegacyCardFile(
        orderedLegacyCardFile,
        'evt-non-string-name',
        42 as unknown as string,
      ),
    );

    expect(error.code).toBe('EVENT_NAME_INVALID');
    expect(error.context).toEqual({
      eventId: 'evt-non-string-name',
      eventName: 42,
    });
  });

  test('rejects an empty legacy card file instead of returning an empty workflow', () => {
    const legacy: CardFile = {
      version: 1,
      puck: { root: { props: {} }, components: {} },
      cards: [],
    };

    const error = getFormatError(() =>
      migrateLegacyCardFile(legacy, 'evt-empty', 'Empty event'),
    );

    expect(error.code).toBe('LEGACY_CARD_FILE_EMPTY');
    expect(error.context).toEqual({ eventId: 'evt-empty' });
  });

  test('keeps a large cards index ordered and complete without quadratic lookup behavior', () => {
    const componentCount = 4_000;
    const components: CardFile['puck']['components'] = {
      title: [],
      narrative: [],
    };
    const cards: CardFile['cards'] = [];

    for (let index = 0; index < componentCount; index++) {
      const componentType = index % 2 === 0 ? 'title' : 'narrative';
      const id = `large-${index}`;
      components[componentType].push({
        id,
        props: componentType === 'title'
          ? { title: `Title ${index}` }
          : { text: `Narrative ${index}` },
      });
      cards.unshift({ id, componentId: componentType, title: id });
    }

    const workflow = migrateLegacyCardFile(
      {
        version: 1,
        puck: { root: { props: {} }, components },
        cards,
      },
      'evt-large-cards',
      'Large cards',
    );

    expect(workflow.nodes).toHaveLength(componentCount);
    expect(workflow.nodes.map((node) => node.id)).toEqual(
      cards.map((card) => card.id),
    );
  });
});

const normalizationManifest = {
  id: 'pack-legacy',
  name: 'Legacy Pack',
} as Manifest;

function nestedObject(depth: number): Record<string, unknown> {
  let value: unknown = null;
  for (let index = 0; index < depth; index++) {
    value = { level: value };
  }
  return value as Record<string, unknown>;
}

function parseNormalizedJson(
  files: Record<string, unknown>,
  filePath: string,
): Record<string, unknown> {
  const value = files[filePath];
  expect(typeof value).toBe('string');
  return JSON.parse(value as string) as Record<string, unknown>;
}

function expectPackageFormatError(
  run: () => unknown,
  code: EventPackFormatErrorCode,
  filePath: string,
): void {
  const error = getFormatError(run);
  expect(error.code).toBe(code);
  expect(error.filePath).toBe(filePath);
  expect(error.context).toMatchObject({ filePath });
}

describe('normalizeCardPackFiles', () => {
  test('reports stable JSON depth overflow as a structured file error', () => {
    const error = getFormatError(() => normalizeCardPackFiles(normalizationManifest, {
      'schema/card.json': JSON.stringify({
        ...orderedLegacyCardFile,
        deeplyNested: nestedObject(80),
      }),
    }));

    expect(error.code).toBe('INPUT_LIMIT_EXCEEDED');
    expect(error.filePath).toBe('schema/card.json');
    expect(error.context).toMatchObject({
      filePath: 'schema/card.json',
      limit: expect.any(Number),
      depth: expect.any(Number),
    });
    expect(error).not.toBeInstanceOf(RangeError);
  });

  test('reports oversized JSON text at the file input boundary', () => {
    const error = getFormatError(() => normalizeCardPackFiles(normalizationManifest, {
      'schema/card.json': JSON.stringify({
        ...orderedLegacyCardFile,
        oversized: 'x'.repeat(4_200_000),
      }),
    }));

    expect(error.code).toBe('INPUT_LIMIT_EXCEEDED');
    expect(error.filePath).toBe('schema/card.json');
    expect(error.context).toMatchObject({
      filePath: 'schema/card.json',
      limit: expect.any(Number),
      observed: expect.any(Number),
    });
  });

  test('normalizes a single card file with a stable event ID and preserves binary assets', () => {
    const asset = new Uint8Array([0, 1, 255]);
    const files: Record<string, string | Uint8Array> = {
      'manifest.json': JSON.stringify(normalizationManifest),
      'schema/card.json': new TextEncoder().encode(JSON.stringify(orderedLegacyCardFile)),
      'assets/opaque.bin': asset,
    };
    const originalFiles = { ...files };

    const result = normalizeCardPackFiles(normalizationManifest, files);
    const index = parseNormalizedJson(result.files, 'schema/events.json');
    const entry = (index.events as Array<Record<string, unknown>>)[0];

    expect(result.migrated).toBe(true);
    expect(result.files).not.toBe(files);
    expect(files).toEqual(originalFiles);
    expect(result.files['schema/card.json']).toBeUndefined();
    expect(entry.id).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
    expect(parseNormalizedJson(result.files, `schema/event-${String(entry.id)}.json`)).toMatchObject({
      id: entry.id,
      name: 'Legacy Pack',
    });
    expect(result.files['assets/opaque.bin']).toBe(asset);
    const normalizedAgain = normalizeCardPackFiles(normalizationManifest, result.files);
    expect(normalizedAgain.files).toEqual(result.files);
    expect(normalizedAgain.index).toEqual(result.index);
    expect(normalizedAgain.workflows).toEqual(result.workflows);
    expect(normalizedAgain.migrated).toBe(false);

    const secondInput = {
      ...files,
      'schema/card.json': new TextEncoder().encode(JSON.stringify(orderedLegacyCardFile)),
    };
    const legacyAgain = normalizeCardPackFiles(normalizationManifest, secondInput);
    expect((parseNormalizedJson(legacyAgain.files, 'schema/events.json').events as Array<Record<string, unknown>>)[0].id)
      .toBe(entry.id);
  });

  test('normalizes version-1 embedded cards and emits metadata-only version-2 index', () => {
    const files: Record<string, string> = {
      'schema/events.json': JSON.stringify({
        version: 1,
        name: 'Legacy Pack',
        events: [{
          id: 'evt-one',
          name: 'First Event',
          cards: orderedLegacyCardFile.cards,
          puck: orderedLegacyCardFile.puck,
        }],
      }),
    };

    const result = normalizeCardPackFiles(normalizationManifest, files);
    const index = parseNormalizedJson(result.files, 'schema/events.json');

    expect(result.migrated).toBe(true);
    expect(index).toEqual({
      version: 2,
      name: 'Legacy Pack',
      events: [{ id: 'evt-one', name: 'First Event' }],
    });
    expect(parseNormalizedJson(result.files, 'schema/event-evt-one.json')).toMatchObject({
      id: 'evt-one',
      name: 'First Event',
    });
    expect(parseNormalizedJson(result.files, 'schema/event-evt-one.json').nodes).toBeArray();
    expect(parseNormalizedJson(result.files, 'schema/event-evt-one.json')).not.toHaveProperty('cards');
  });

  test('normalizes version-1 event index with per-event legacy CardFile and removes stale event files', () => {
    const files: Record<string, string> = {
      'schema/events.json': JSON.stringify({
        version: 1,
        events: [{ id: 'evt-one', name: 'First Event' }],
      }),
      'schema/event-evt-one.json': JSON.stringify(orderedLegacyCardFile),
      'schema/event-stale.json': JSON.stringify(orderedLegacyCardFile),
      'assets/readme.txt': 'leave byte-for-byte unchanged',
    };

    const result = normalizeCardPackFiles(normalizationManifest, files);

    expect(result.migrated).toBe(true);
    expect(result.files['schema/event-stale.json']).toBeUndefined();
    expect(result.files['assets/readme.txt']).toBe('leave byte-for-byte unchanged');
    expect(parseNormalizedJson(result.files, 'schema/event-evt-one.json')).toMatchObject({
      id: 'evt-one',
      name: 'First Event',
    });
    const second = normalizeCardPackFiles(normalizationManifest, result.files);
    expect(second.files).toEqual(result.files);
    expect(second.index).toEqual(result.index);
    expect(second.workflows).toEqual(result.workflows);
    expect(second.migrated).toBe(false);
  });

  test('preserves non-canonical event-like paths as unrelated assets', () => {
    const unrelatedPath = 'schema/event-foo/bar.json';
    const unrelatedAsset = 'keep this event-like asset';
    const files: Record<string, string> = {
      'schema/events.json': JSON.stringify({
        version: 1,
        events: [{ id: 'evt-one', name: 'First Event' }],
      }),
      'schema/event-evt-one.json': JSON.stringify(orderedLegacyCardFile),
      [unrelatedPath]: unrelatedAsset,
    };

    const result = normalizeCardPackFiles(normalizationManifest, files);

    expect(result.files[unrelatedPath]).toBe(unrelatedAsset);
  });

  test('validates and preserves an already canonical version-2 package', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'evt-one',
      name: 'First Event',
      nodes: [{
        id: 'title-one',
        typeId: 'narrative.title',
        position: { x: 0, y: 0 },
        widgetValues: { title: 'Hello' },
      }],
      connections: [],
    };
    const files: Record<string, string> = {
      'schema/events.json': JSON.stringify({
        version: 2,
        events: [{ id: 'evt-one', name: 'First Event' }],
      }),
      'schema/event-evt-one.json': JSON.stringify(workflow),
      'assets/opaque.bin': 'do not rewrite',
    };

    const result = normalizeCardPackFiles(normalizationManifest, files);

    expect(result.migrated).toBe(false);
    expect(result.index).toEqual({
      version: 2,
      events: [{ id: 'evt-one', name: 'First Event' }],
    });
    expect(result.workflows).toEqual([workflow]);
    expect(result.files['assets/opaque.bin']).toBe('do not rewrite');
    const second = normalizeCardPackFiles(normalizationManifest, result.files);
    expect(second.files).toEqual(result.files);
    expect(second.index).toEqual(result.index);
    expect(second.workflows).toEqual(result.workflows);
    expect(second.migrated).toBe(false);
  });

  test('rejects a canonical version-2 package with an extra legacy card file', () => {
    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 2,
          events: [{ id: 'evt-one', name: 'First Event' }],
        }),
        'schema/event-evt-one.json': JSON.stringify({
          version: 1,
          id: 'evt-one',
          name: 'First Event',
          nodes: [{
            id: 'title-one',
            typeId: 'narrative.title',
            position: { x: 0, y: 0 },
            widgetValues: { title: 'Hello' },
          }],
          connections: [],
        }),
        'schema/card.json': JSON.stringify(orderedLegacyCardFile),
      }),
      'INPUT_CONFLICT',
      'schema/card.json',
    );
  });

  test('uses an unambiguous single card file when a v1 index omits its workflow data', () => {
    const result = normalizeCardPackFiles(normalizationManifest, {
      'schema/events.json': JSON.stringify({
        version: 1,
        events: [{ id: 'evt-one', name: 'First Event' }],
      }),
      'schema/card.json': JSON.stringify(orderedLegacyCardFile),
    });

    expect(result.migrated).toBe(true);
    expect(result.index.events).toEqual([{ id: 'evt-one', name: 'First Event' }]);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0]?.id).toBe('evt-one');
    expect(result.files['schema/card.json']).toBeUndefined();
  });

  test('rejects a v1 embedded workflow with an extra legacy card file', () => {
    const conflicting = JSON.parse(JSON.stringify(orderedLegacyCardFile)) as CardFile;
    const title = conflicting.puck.components.title?.[0];
    expect(title).toBeDefined();
    if (title) title.props.title = 'Different title';

    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 1,
          events: [{
            id: 'evt-one',
            name: 'First Event',
            cards: orderedLegacyCardFile.cards,
            puck: orderedLegacyCardFile.puck,
          }],
        }),
        'schema/card.json': JSON.stringify(conflicting),
      }),
      'INPUT_CONFLICT',
      'schema/card.json',
    );
  });

  test('rejects multiple v1 per-event workflows with an extra legacy card file', () => {
    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 1,
          events: [
            { id: 'evt-one', name: 'First Event' },
            { id: 'evt-two', name: 'Second Event' },
          ],
        }),
        'schema/event-evt-one.json': JSON.stringify(orderedLegacyCardFile),
        'schema/event-evt-two.json': JSON.stringify(orderedLegacyCardFile),
        'schema/card.json': JSON.stringify(orderedLegacyCardFile),
      }),
      'INPUT_CONFLICT',
      'schema/card.json',
    );
  });

  test('rejects conflicting embedded and per-event legacy card files', () => {
    const conflicting = JSON.parse(JSON.stringify(orderedLegacyCardFile)) as CardFile;
    const title = conflicting.puck.components.title?.[0];
    expect(title).toBeDefined();
    if (title) title.props.title = 'Different title';

    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 1,
          events: [{
            id: 'evt-one',
            name: 'First Event',
            cards: orderedLegacyCardFile.cards,
            puck: orderedLegacyCardFile.puck,
          }],
        }),
        'schema/event-evt-one.json': JSON.stringify(conflicting),
      }),
      'INPUT_CONFLICT',
      'schema/event-evt-one.json',
    );
  });

  test('rejects canonical workflows with unknown node fields', () => {
    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 2,
          events: [{ id: 'evt-one', name: 'First Event' }],
        }),
        'schema/event-evt-one.json': JSON.stringify({
          version: 1,
          id: 'evt-one',
          name: 'First Event',
          nodes: [{
            id: 'title-one',
            typeId: 'narrative.title',
            position: { x: 0, y: 0 },
            unexpected: true,
          }],
          connections: [],
        }),
      }),
      'WORKFLOW_INVALID',
      'schema/event-evt-one.json',
    );
  });

  test('rejects canonical connections whose ports are not defined by the node registry', () => {
    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 2,
          events: [{ id: 'evt-one', name: 'First Event' }],
        }),
        'schema/event-evt-one.json': JSON.stringify({
          version: 1,
          id: 'evt-one',
          name: 'First Event',
          nodes: [
            {
              id: 'title-one',
              typeId: 'narrative.title',
              position: { x: 0, y: 0 },
            },
            {
              id: 'text-one',
              typeId: 'narrative.text',
              position: { x: 0, y: 120 },
            },
          ],
          connections: [{
            id: 'flow-one',
            sourceNodeId: 'title-one',
            sourceSocketKey: 'missing_output',
            targetNodeId: 'text-one',
            targetSocketKey: 'flow_in',
          }],
        }),
      }),
      'WORKFLOW_INVALID',
      'schema/event-evt-one.json',
    );
  });

  test('reports malformed JSON with a stable code and file path', () => {
    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': '{malformed',
      }),
      'JSON_MALFORMED',
      'schema/events.json',
    );
  });

  test('reports duplicate event IDs with a stable code and index file path', () => {
    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 1,
          events: [
            { id: 'evt-one', name: 'First' },
            { id: 'evt-one', name: 'Duplicate' },
          ],
        }),
      }),
      'DUPLICATE_EVENT_ID',
      'schema/events.json',
    );
  });

  test('reports an absent workflow instead of generating an empty workflow', () => {
    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 1,
          events: [{ id: 'evt-one', name: 'First Event' }],
        }),
      }),
      'WORKFLOW_MISSING',
      'schema/event-evt-one.json',
    );
  });

  test('reports an index and workflow ID mismatch with the workflow file path', () => {
    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 2,
          events: [{ id: 'evt-one', name: 'First Event' }],
        }),
        'schema/event-evt-one.json': JSON.stringify({
          version: 1,
          id: 'evt-two',
          name: 'First Event',
          nodes: [],
          connections: [],
        }),
      }),
      'INDEX_FILE_MISMATCH',
      'schema/event-evt-one.json',
    );
  });

  test('reports unsupported legacy components with the legacy file path', () => {
    const unsupported = singleBlockLegacyCardFile(
      'video',
      { src: 'video.mp4' },
      'legacy-video',
    );

    expectPackageFormatError(
      () => normalizeCardPackFiles(normalizationManifest, {
        'schema/events.json': JSON.stringify({
          version: 1,
          events: [{ id: 'evt-one', name: 'Video Event' }],
        }),
        'schema/event-evt-one.json': JSON.stringify(unsupported),
      }),
      'LEGACY_COMPONENT_UNSUPPORTED',
      'schema/event-evt-one.json',
    );
  });
});
