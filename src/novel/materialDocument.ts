import type { NovelDataset, NovelMaterialDocument, NovelMaterialEdit, NovelMaterialField, NovelStaticMaterial } from './types';

const textFields = new Set(['summary', 'powerSystem']);
const listFields = new Set(['settings', 'rules', 'relations', 'culture', 'highlights']);
const archiveFields = new Set(['factions', 'characters', 'locations', 'items']);
const allFields = new Set<string>([...textFields, ...listFields, ...archiveFields, 'economy', 'events']);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const stringList = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');

function validField(field: string, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (textFields.has(field)) return typeof value === 'string';
  if (listFields.has(field)) return stringList(value);
  if (field === 'economy') return isRecord(value) && Object.values(value).every(item => item === undefined || typeof item === 'string');
  if (archiveFields.has(field)) return Array.isArray(value) && value.every(item => isRecord(item) && typeof item.name === 'string'
    && (item.description === undefined || typeof item.description === 'string') && (item.aliases === undefined || stringList(item.aliases))
    && (item.details === undefined || stringList(item.details)));
  if (field === 'events') return Array.isArray(value) && value.every(item => isRecord(item) && typeof item.name === 'string' && typeof item.description === 'string');
  return false;
}

/** Storage and import boundary: a corrupt overlay must fail loudly instead of projecting garbage. */
export function readNovelMaterialDocument(value: unknown): NovelMaterialDocument | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.generated) || !Array.isArray(value.edits)
    || !Object.entries(value.generated).every(([field, item]) => validField(field, item))) throw new Error('资料编辑记录格式无效');
  const fields = new Set<string>();
  for (const edit of value.edits) {
    if (!isRecord(edit) || typeof edit.field !== 'string' || fields.has(edit.field) || !allFields.has(edit.field)
      || typeof edit.remove !== 'boolean' || !validField(edit.field, edit.baseline)
      || (!edit.remove && (!Object.hasOwn(edit, 'value') || edit.value === undefined || !validField(edit.field, edit.value)))) {
      throw new Error('资料编辑记录字段无效或重复');
    }
    fields.add(edit.field);
  }
  return structuredClone(value) as unknown as NovelMaterialDocument;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const clone = <T>(value: T): T => structuredClone(value);

export function projectNovelMaterial(document: NovelMaterialDocument): NovelStaticMaterial {
  const result = clone(document.generated);
  for (const edit of document.edits) {
    if (edit.remove) delete result[edit.field];
    else (result as Record<string, unknown>)[edit.field] = clone(edit.value);
  }
  return result;
}

/** Only fields that still differ from the generated baseline survive as overrides. */
function buildEdits(generated: NovelStaticMaterial, material: NovelStaticMaterial, previous: NovelMaterialEdit[]): NovelMaterialEdit[] {
  const before = new Map(previous.map(edit => [edit.field, edit]));
  const fields = [...new Set([...Object.keys(generated), ...Object.keys(material)])] as NovelMaterialField[];
  return fields.filter(field => !same(generated[field], material[field])).map(field => ({
    field,
    baseline: clone(before.get(field)?.baseline ?? generated[field]),
    value: clone(material[field]),
    remove: material[field] === undefined,
  }));
}

function documentOf(dataset: NovelDataset): NovelMaterialDocument {
  return dataset.materialDocument ?? { version: 1, generated: dataset.staticMaterial, edits: [] };
}

/** The model-side baseline the current material was generated from. */
export function novelGeneratedMaterial(dataset: NovelDataset): NovelStaticMaterial {
  return documentOf(dataset).generated;
}

export function editNovelMaterial(dataset: NovelDataset, material: NovelStaticMaterial): NovelDataset {
  const base = documentOf(dataset);
  const document: NovelMaterialDocument = { version: 1, generated: base.generated, edits: buildEdits(base.generated, material, base.edits) };
  return { ...dataset, materialDocument: document, staticMaterial: projectNovelMaterial(document) };
}

/** Fold new model output under the authored overrides and keep the conflict evidence for review. */
export function applyGeneratedMaterial(dataset: NovelDataset, generated: NovelStaticMaterial): NovelDataset {
  const base = documentOf(dataset);
  const document: NovelMaterialDocument = {
    version: 1,
    generated: clone(generated),
    edits: base.edits.filter(edit => !same(edit.remove ? undefined : edit.value, generated[edit.field])),
  };
  return { ...dataset, materialDocument: document, staticMaterial: projectNovelMaterial(document) };
}

/** Fields the model changed after the player wrote over them. */
export function novelMaterialConflicts(dataset: NovelDataset): NovelMaterialEdit[] {
  const document = dataset.materialDocument;
  if (!document) return [];
  return document.edits
    .filter(edit => !same(edit.baseline, document.generated[edit.field]) && !same(edit.remove ? undefined : edit.value, document.generated[edit.field]))
    .map(edit => clone(edit));
}

export function resolveNovelMaterialConflict(dataset: NovelDataset, field: NovelMaterialField, choice: 'author' | 'generated'): NovelDataset {
  const document = dataset.materialDocument;
  if (!document) return dataset;
  const next: NovelMaterialDocument = {
    version: 1,
    generated: document.generated,
    edits: choice === 'generated' ? document.edits.filter(edit => edit.field !== field)
      : document.edits.map(edit => edit.field === field ? { ...edit, baseline: clone(document.generated[field]) } : edit),
  };
  return { ...dataset, materialDocument: next, staticMaterial: projectNovelMaterial(next) };
}

export function novelMaterialFieldLabel(field: NovelMaterialField): string {
  return ({ summary: '世界概述', settings: '背景设定', rules: '世界规则', powerSystem: '力量体系', factions: '势力档案', characters: '人物档案',
    locations: '地点档案', items: '物品档案', relations: '关系网', culture: '文化习俗', highlights: '亮点', economy: '经济与时间', events: '事件资料' } as Record<string, string>)[field] ?? field;
}
