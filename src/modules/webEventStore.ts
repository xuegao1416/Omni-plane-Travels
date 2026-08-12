// ============================================================
// Web 端事件包操作实现（替代 Tauri invoke）
//   存储：IndexedDB（eventDb）    导入/导出：jszip + Blob 下载
//   与 Tauri 端命令一一对应，供 eventApi 在 !isTauri() 时委派。
//   Web 端无 Rust 文件系统，故「安装」即「导入并落 IndexedDB」，不调用原生对话框。
// ============================================================
import JSZip from 'jszip';
import type {
  Manifest,
  EventMeta,
  EventRegistryEntry,
  EventDetail,
  EventRule,
  EventPackType,
  EventIndexEntry,
  EventPackIndex,
  CardWorkflowDefinition,
  RuleFile,
  ValidationResult,
  ValidationIssue,
  RuleSummary,
  CardSummary,
  Condition,
  ActionKind,
  DepIssue,
  ConflictStatus,
  PeriodicRule,
  Collection,
} from './schema';
import { EventPackFormatError, normalizeCardPackFiles, parseCanonicalEventIndex } from './eventPackFormat';
import { ensureEventApiError, EventApiError } from './eventErrors';
import type { EventApiErrorCode } from './eventErrors';
import {
  putWebEvent,
  getWebEvent,
  deleteWebEvent,
  allWebEvents,
  recordToEntry,
  manifestToMeta,
  type WebEventRecord,
  putCollection,
  getCollection,
  deleteCollection,
  allCollections,
} from './eventDb';

const APP_VERSION = '2.7.3';
const ID_RE = /^[a-z0-9][a-z0-9_:-]{2,63}$/;
const VER_RE = /^\d+\.\d+\.\d+$/;
const TEXT_RE = /\.(json|txt|md|csv|yml|yaml)$/i;
const EVENTS_FILE_PATH = 'schema/events.json';
const RULES_FILE_PATH = 'schema/rules.json';
const EVENT_WORKFLOW_FILE_RE = /^schema\/event-[^/]+\.json$/;

/** Web 端结构化错误（eventApi 捕获后转 EventApiError） */
function createWebEventError(
  code: EventApiErrorCode,
  message: string,
  details: { context?: Readonly<Record<string, unknown>>; filePath?: string } = {},
): EventApiError {
  return new EventApiError({ code, message, ...details });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ensureWebImportApiError(error: unknown): EventApiError {
  if (error instanceof EventApiError) return error;
  if (error instanceof EventPackFormatError) {
    return createWebEventError(error.code, error.message, {
      context: error.context,
      filePath: error.filePath,
    });
  }
  return ensureEventApiError(error);
}

/** 本地结构化校验（与 EventImportWizard.localValidate 同源，输出 ValidationResult） */
export function localValidate(m: Manifest): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (!m.id) errors.push({ code: 'MANIFEST_MISSING_FIELD', field: 'id', message: '缺少必需字段 id' });
  else if (!ID_RE.test(m.id)) errors.push({ code: 'MANIFEST_INVALID', field: 'id', message: `id 不符合 ^[a-z0-9][a-z0-9_:-]{2,63}$（${m.id}）` });
  if (!m.version) errors.push({ code: 'MANIFEST_MISSING_FIELD', field: 'version', message: '缺少必需字段 version' });
  else if (!VER_RE.test(m.version)) errors.push({ code: 'MANIFEST_INVALID', field: 'version', message: `version 需为主.次.修（${m.version}）` });
  if (!m.name) errors.push({ code: 'MANIFEST_MISSING_FIELD', field: 'name', message: '缺少必需字段 name' });
  if (!m.type) errors.push({ code: 'MANIFEST_MISSING_FIELD', field: 'type', message: '缺少必需字段 type' });
  if (!m.coverColor) warnings.push({ code: 'WARNING', field: 'coverColor', message: '未设置封面色（建议补充）' });
  else if (/gradient|linear|radial/i.test(m.coverColor)) errors.push({ code: 'MANIFEST_INVALID', field: 'coverColor', message: '封面色禁止为渐变，必须为实色块' });
  if (!m.icon) warnings.push({ code: 'WARNING', field: 'icon', message: '未设置图标' });
  if (m.engine && m.engine !== 'opt-event') errors.push({ code: 'MANIFEST_INVALID', field: 'engine', message: `engine 必须为 opt-event（${m.engine}）` });
  return { ok: errors.length === 0, errors, warnings };
}

/** 解析一个 .opt-event 包，返回 manifest + 内联文件内容（zip-slip 防护）。
 *  入参兼容浏览器 File / Blob / ArrayBuffer / Uint8Array（File 继承 Blob，真实 UI 传 File 即可）。 */
async function parseWtgmod(file: File | Blob | ArrayBuffer | Uint8Array): Promise<{ manifest: Manifest; files: Record<string, string | Blob> }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (error) {
    if (error instanceof EventApiError || error instanceof EventPackFormatError) throw error;
    throw createWebEventError('ZIP_INVALID', `Invalid ZIP archive: ${errorMessage(error)}`);
  }
  const mFile = zip.file('manifest.json');
  if (!mFile) throw createWebEventError('ZIP_INVALID', '压缩包内缺少 manifest.json');
  let manifestText: string;
  try {
    manifestText = await mFile.async('string');
  } catch (error) {
    if (error instanceof EventApiError || error instanceof EventPackFormatError) throw error;
    throw createWebEventError('ZIP_INVALID', `Unable to read manifest.json: ${errorMessage(error)}`, {
      context: { filePath: 'manifest.json' },
      filePath: 'manifest.json',
    });
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestText) as Manifest;
  } catch (error) {
    if (error instanceof EventApiError || error instanceof EventPackFormatError) throw error;
    throw createWebEventError('MANIFEST_INVALID', `Malformed manifest.json: ${errorMessage(error)}`, {
      context: { filePath: 'manifest.json' },
      filePath: 'manifest.json',
    });
  }
  const files: Record<string, string | Blob> = { 'manifest.json': JSON.stringify(manifest, null, 2) };
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path === 'manifest.json') continue;
    if (!/^(schema|assets)\//.test(path)) continue; // 仅收 schema/ 与 assets/
    if (path.includes('..') || /^(schema|assets)\/\.\./.test(path)) {
      throw createWebEventError('PATH_INVALID', `非法路径：${path}`);
    }
    files[path] = TEXT_RE.test(path) ? await entry.async('string') : await entry.async('blob');
  }
  return { manifest, files };
}

function isWebEventFile(value: unknown): value is string | Blob {
  return typeof value === 'string' || (typeof Blob !== 'undefined' && value instanceof Blob);
}

/** The format layer accepts broader inputs; the web store keeps only its string/Blob contract. */
function toWebEventFiles(files: Record<string, unknown>): Record<string, string | Blob> {
  const result: Record<string, string | Blob> = {};
  for (const [path, content] of Object.entries(files)) {
    if (!isWebEventFile(content)) {
      throw createWebEventError('FILE_INVALID', `导入文件内容类型无效：${path}`);
    }
    result[path] = content;
  }
  return result;
}

function readJsonFile(raw: string | Blob | undefined, filePath: string): unknown {
  if (typeof raw !== 'string') {
    throw createWebEventError('FILE_INVALID', `文件内容不是 JSON 文本：${filePath}`, {
      context: { filePath },
      filePath,
    });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw createWebEventError('JSON_MALFORMED', `JSON 文件损坏：${filePath}`, {
      context: { filePath, cause: errorMessage(error) },
      filePath,
    });
  }
}

function readCanonicalIndex(rec: WebEventRecord): EventPackIndex {
  const raw = rec.files[EVENTS_FILE_PATH];
  if (raw === undefined) {
    throw createWebEventError('INDEX_MISSING', `事件包缺少 ${EVENTS_FILE_PATH}`, {
      context: { filePath: EVENTS_FILE_PATH },
      filePath: EVENTS_FILE_PATH,
    });
  }

  try {
    return parseCanonicalEventIndex(readJsonFile(raw, EVENTS_FILE_PATH));
  } catch (error) {
    if (error instanceof EventApiError) throw error;
    throw createWebEventError('INDEX_INVALID', `事件索引不是 canonical v2：${EVENTS_FILE_PATH}`, {
      context: { filePath: EVENTS_FILE_PATH, cause: errorMessage(error) },
      filePath: EVENTS_FILE_PATH,
    });
  }
}

function validateWorkflow(
  entry: EventIndexEntry,
  raw: unknown,
  filePath: string,
): CardWorkflowDefinition {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw createWebEventError('WORKFLOW_INVALID', `工作流文件不是对象：${filePath}`, {
      context: { filePath, eventId: entry.id },
      filePath,
    });
  }
  const workflow = raw as Partial<CardWorkflowDefinition>;
  if (
    typeof workflow.version !== 'number' ||
    !Number.isInteger(workflow.version) ||
    workflow.version <= 0 ||
    typeof workflow.id !== 'string' ||
    typeof workflow.name !== 'string' ||
    !Array.isArray(workflow.nodes) ||
    !Array.isArray(workflow.connections)
  ) {
    throw createWebEventError('WORKFLOW_INVALID', `工作流文件字段无效：${filePath}`, {
      context: { filePath, eventId: entry.id },
      filePath,
    });
  }
  if (workflow.id !== entry.id || workflow.name !== entry.name) {
    throw createWebEventError('INDEX_FILE_MISMATCH', `工作流与事件索引不一致：${filePath}`, {
      context: {
        filePath,
        expectedId: entry.id,
        actualId: workflow.id,
        expectedName: entry.name,
        actualName: workflow.name,
      },
      filePath,
    });
  }
  return workflow as CardWorkflowDefinition;
}

function readCanonicalWorkflows(
  rec: WebEventRecord,
  index: EventPackIndex,
): Map<string, CardWorkflowDefinition> {
  const workflows = new Map<string, CardWorkflowDefinition>();
  for (const entry of index.events) {
    const filePath = `schema/event-${entry.id}.json`;
    const raw = rec.files[filePath];
    if (raw === undefined) {
      throw createWebEventError('WORKFLOW_MISSING', `缺少工作流文件：${filePath}`, {
        context: { filePath, eventId: entry.id },
        filePath,
      });
    }
    workflows.set(entry.id, validateWorkflow(entry, readJsonFile(raw, filePath), filePath));
  }
  return workflows;
}

function canonicalIndex(
  name: string | undefined,
  events: EventIndexEntry[],
): EventPackIndex {
  try {
    return parseCanonicalEventIndex({
      version: 2,
      ...(name === undefined ? {} : { name }),
      events,
    });
  } catch (error) {
    throw createWebEventError('INDEX_INVALID', '事件索引不是有效的 canonical v2', {
      context: { filePath: EVENTS_FILE_PATH, cause: errorMessage(error) },
      filePath: EVENTS_FILE_PATH,
    });
  }
}

export interface CanonicalCardPackEvent {
  entry: EventIndexEntry;
  workflow: CardWorkflowDefinition;
}

/** Build the complete canonical schema file set for a card pack. */
export function buildCanonicalCardPackFiles(
  name: string | undefined,
  events: CanonicalCardPackEvent[],
): Record<string, string> {
  const index = canonicalIndex(name, events.map(({ entry }) => entry));
  const files: Record<string, string> = {
    [EVENTS_FILE_PATH]: JSON.stringify(index, null, 2),
  };

  for (const { entry, workflow } of events) {
    const filePath = `schema/event-${entry.id}.json`;
    files[filePath] = JSON.stringify(validateWorkflow(entry, workflow, filePath), null, 2);
  }

  return files;
}

function removeLegacyAndStaleEventFiles(
  rec: WebEventRecord,
  index: EventPackIndex,
): void {
  const expected = new Set(index.events.map((entry) => `schema/event-${entry.id}.json`));
  for (const filePath of Object.keys(rec.files)) {
    if (EVENT_WORKFLOW_FILE_RE.test(filePath) && !expected.has(filePath)) {
      delete rec.files[filePath];
    }
  }
}

function writePeriodicRulesToRecord(rec: WebEventRecord, periodicRules: PeriodicRule[]): void {
  let rules: EventRule[] = [];
  const existing = rec.files[RULES_FILE_PATH];
  if (typeof existing === 'string') {
    try {
      const parsed = JSON.parse(existing) as Partial<RuleFile>;
      if (Array.isArray(parsed.rules)) rules = parsed.rules as EventRule[];
    } catch {
      // 损坏的规则图不会阻止周期规则写入；以空规则图重建 rules.json。
    }
  }
  const file: RuleFile = { version: 1, rules, periodicRules };
  rec.files[RULES_FILE_PATH] = JSON.stringify(file, null, 2);
}

// ─── 10 个操作（Web 实现） ───

export async function webDiscoverPacks(): Promise<EventMeta[]> {
  const recs = await allWebEvents();
  return recs.map((r) => manifestToMeta(r.manifest));
}

export async function webListPacks(): Promise<EventRegistryEntry[]> {
  const recs = await allWebEvents();
  return recs.map(recordToEntry);
}

export async function webValidatePack(manifest: Manifest): Promise<ValidationResult> {
  return localValidate(manifest);
}

/** 从浏览器选择的 .opt-event 文件导入并落 IndexedDB（Web 端的「安装」） */
async function webImportFromFileImpl(file: File | Blob | ArrayBuffer | Uint8Array): Promise<EventMeta> {
  const { manifest, files } = await parseWtgmod(file);
  const v = localValidate(manifest);
  if (!v.ok) {
    throw createWebEventError('MANIFEST_INVALID', `校验未通过：${v.errors.map((e) => e.message).join('；')}`);
  }

  let storedFiles = files;
  if (manifest.type === 'card') {
    storedFiles = toWebEventFiles(normalizeCardPackFiles(manifest, files).files);
  }

  const existing = await getWebEvent(manifest.id);
  const enabled = existing?.enabled ?? (manifest.enabledByDefault ?? false);
  const rec: WebEventRecord = {
    id: manifest.id,
    manifest,
    enabled,
    status: enabled ? 'enabled' : 'installed',
    installedAt: existing?.installedAt ?? new Date().toISOString(),
    files: storedFiles,
  };
  await putWebEvent(rec);
  return manifestToMeta(manifest);
}

export async function webImportFromFile(file: File | Blob | ArrayBuffer | Uint8Array): Promise<EventMeta> {
  try {
    return await webImportFromFileImpl(file);
  } catch (error) {
    throw ensureWebImportApiError(error);
  }
}

export async function webUninstallPack(id: string): Promise<void> {
  await deleteWebEvent(id);
}

export async function webEnablePack(id: string): Promise<void> {
  const rec = await getWebEvent(id);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件：${id}`);
  rec.enabled = true;
  rec.status = 'enabled';
  await putWebEvent(rec);
}

export async function webDisablePack(id: string): Promise<void> {
  const rec = await getWebEvent(id);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件：${id}`);
  rec.enabled = false;
  rec.status = 'disabled';
  await putWebEvent(rec);
}

/** 重建 .opt-event 并触发浏览器下载（Web 端无原生保存对话框，走 Blob） */
export async function webExportPack(id: string): Promise<void> {
  const rec = await getWebEvent(id);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件：${id}`);
  const zip = new JSZip();
  for (const [path, content] of Object.entries(rec.files)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.opt-event`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function webGetEventDetail(id: string): Promise<EventDetail> {
  const rec = await getWebEvent(id);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件：${id}`);
  const entry = recordToEntry(rec);
  // 规则汇总以 events.json 中的周期规则为真值（authoring 路径从不写 manifest.rules，故直接读 events.json；P0-5 Web 修复）
  let rulesSummary: RuleSummary[] = [];
  const rulesRaw = rec.files[RULES_FILE_PATH];
  if (typeof rulesRaw === 'string') {
    try {
      const file = JSON.parse(rulesRaw) as RuleFile;
      rulesSummary = (file.periodicRules ?? []).map((p) => ({
        id: p.id,
        file: RULES_FILE_PATH,
        priority: 0,
        once: false,
        cooldownTicks: p.intervalTicks ?? 0,
        when: {} as Condition,
        actionKinds: [] as ActionKind[],
        actionCount: 0,
      }));
    } catch {
      /* 索引解析失败：回退空 */
    }
  }
  if (rulesSummary.length === 0) {
    // 旧包（仅 manifest.rules）回退
    rulesSummary = (rec.manifest.rules ?? []).map((f, i) => ({
      id: `${id}-rule-${i}`,
      file: f,
      priority: 0,
      once: false,
      cooldownTicks: 0,
      when: {} as Condition,
      actionKinds: [] as ActionKind[],
      actionCount: 0,
    }));
  }
  const cardsSummary: CardSummary[] = (rec.manifest.cards ?? []).map((f, i) => ({
    id: `${id}-card-${i}`,
    title: '',
    file: f,
    kind: 'add',
  }));
  const dependencyStatus: DepIssue[] = (rec.manifest.dependencies ?? []).map((d) => ({
    id: d,
    satisfied: false,
  }));
  const conflictStatus: ConflictStatus[] = (rec.manifest.conflicts ?? []).map((c) => ({
    id: c,
    active: false,
  }));
  return {
    meta: entry,
    manifest: rec.manifest,
    rulesSummary,
    cardsSummary,
    dependencyStatus,
    conflictStatus,
  };
}

// ─── canonical v2 pack 内事件读写辅助 ───

/** 写入 canonical v2 事件元数据、对应工作流，以及可选的包级周期规则。 */

/** Return the text files needed by the game runtime for one event pack. */
export async function webGetRuntimePack(id: string): Promise<{
  id: string;
  manifest: Manifest;
  files: Record<string, string>;
}> {
  const rec = await getWebEvent(id);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件包：${id}`);

  const files: Record<string, string> = {};
  for (const [path, value] of Object.entries(rec.files)) {
    if (typeof value === 'string') files[path] = value;
  }

  return { id: rec.id, manifest: rec.manifest, files };
}

export async function saveEventToPack(
  packId: string,
  entry: EventIndexEntry,
  workflow: CardWorkflowDefinition,
  periodicRules?: PeriodicRule[],
): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件包：${packId}`);

  const filePath = `schema/event-${entry.id}.json`;
  const validWorkflow = validateWorkflow(entry, workflow, filePath);
  const current = readCanonicalIndex(rec);
  const events = [...current.events];
  const index = events.findIndex((event) => event.id === entry.id);
  if (index >= 0) events[index] = entry;
  else events.push(entry);

  const next = canonicalIndex(current.name ?? rec.manifest.name, events);
  rec.files[EVENTS_FILE_PATH] = JSON.stringify(next, null, 2);
  rec.files[filePath] = JSON.stringify(validWorkflow, null, 2);
  if (periodicRules !== undefined) writePeriodicRulesToRecord(rec, periodicRules);
  removeLegacyAndStaleEventFiles(rec, next);
  await putWebEvent(rec);
}

/** 从 canonical v2 索引删除事件，并清理所有不再被索引引用的工作流文件。 */
export async function deleteEventFromPack(packId: string, eventId: string): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', '未找到事件包：' + packId);

  const current = readCanonicalIndex(rec);
  const next = canonicalIndex(
    current.name ?? rec.manifest.name,
    current.events.filter((event) => event.id !== eventId),
  );
  rec.files[EVENTS_FILE_PATH] = JSON.stringify(next, null, 2);
  removeLegacyAndStaleEventFiles(rec, next);
  await putWebEvent(rec);
}

/** 同步重命名 canonical v2 索引条目和对应工作流。 */
export async function renameEventInPack(packId: string, eventId: string, newName: string): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', '未找到事件包：' + packId);

  const trimmed = (newName ?? '').trim();
  if (trimmed === '') return; // 空名不更新，直接返回

  const current = readCanonicalIndex(rec);
  const events = current.events.map((event) => (
    event.id === eventId ? { ...event, name: trimmed } : event
  ));
  if (!events.some((event) => event.id === eventId)) return;

  const workflows = readCanonicalWorkflows(rec, current);
  const workflow = workflows.get(eventId);
  if (!workflow) return;

  const next = canonicalIndex(current.name ?? rec.manifest.name, events);
  rec.files[EVENTS_FILE_PATH] = JSON.stringify(next, null, 2);
  rec.files[`schema/event-${eventId}.json`] = JSON.stringify({ ...workflow, name: trimmed }, null, 2);
  removeLegacyAndStaleEventFiles(rec, next);
  await putWebEvent(rec);
}

/**
 * 落盘事件包元信息（名称/描述/作者/版本/封面/图标）。
 * 同时同步 canonical v2 索引的包级名称。
 */
export async function savePackMeta(
  packId: string,
  meta: Partial<Pick<Manifest, 'name' | 'description' | 'author' | 'version' | 'coverColor' | 'icon'>>,
): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件包：${packId}`);
  rec.manifest = { ...rec.manifest, ...meta };
  rec.files['manifest.json'] = JSON.stringify(rec.manifest, null, 2);
  // 同步 canonical index 顶层名称，保持索引与 manifest 一致
  const evRaw = rec.files['schema/events.json'];
  if (typeof evRaw === 'string') {
    try {
      const file = readCanonicalIndex(rec);
      rec.files[EVENTS_FILE_PATH] = JSON.stringify(
        canonicalIndex(rec.manifest.name, file.events),
        null,
        2,
      );
    } catch {
      /* events.json 损坏：仅更新 manifest，不阻断改名 */
    }
  }
  await putWebEvent(rec);
}

/**
 * 向指定事件包写入规则图产出的 EventRule[]（落 schema/rules.json）。
 * 与 saveEventToPack（写 events.json / 卡片画布）互不干扰；
 * 此处仅替换 rules 字段，保留同一文件中的 periodicRules（周期事件包由 EventConfigPanel 维护）。
 * 不存在该 pack 时抛 EventApiError（调用方应保证 eventPackId 来自已安装包）。
 */
export async function saveRulesToPack(packId: string, rules: EventRule[], periodicRules?: PeriodicRule[]): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件包：${packId}`);
  // 若未显式传入 periodicRules，从已有文件读回（向后兼容旧调用方）
  let effectivePeriodic = periodicRules;
  if (effectivePeriodic === undefined) {
    effectivePeriodic = [];
    const existing = rec.files['schema/rules.json'];
    if (typeof existing === 'string') {
      try {
        const rf = JSON.parse(existing) as RuleFile;
        effectivePeriodic = rf.periodicRules ?? [];
      } catch {
        /* 旧文件损坏：丢弃，以新 rules 重建 */
      }
    }
  }
  const file: RuleFile = { version: 1, rules, periodicRules: effectivePeriodic };
  rec.files['schema/rules.json'] = JSON.stringify(file, null, 2);
  await putWebEvent(rec);
}

/**
 * 向指定事件包写入周期规则 PeriodicRule[]（落 schema/rules.json）。
 * 与 saveRulesToPack 对称：此处仅替换 periodicRules 字段，保留同一文件中的 rules（规则图由 RuleEditor 维护）。
 */
export async function savePeriodicRulesToPack(packId: string, periodicRules: PeriodicRule[]): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件包：${packId}`);
  // 读取已有文件以保留 rules（规则图由另一入口维护，避免互相覆盖）
  let rules: EventRule[] = [];
  const existing = rec.files['schema/rules.json'];
  if (typeof existing === 'string') {
    try {
      const rf = JSON.parse(existing) as RuleFile;
      rules = rf.rules ?? [];
    } catch {
      /* 旧文件损坏：丢弃，以新 periodicRules 重建 */
    }
  }
  const file: RuleFile = { version: 1, rules, periodicRules };
  rec.files['schema/rules.json'] = JSON.stringify(file, null, 2);
  await putWebEvent(rec);
}

/**
 * 保存工作流定义到事件包（落 schema/workflow.json）。
 * 同时自动生成 rules.json 供旧引擎兼容。
 */
export async function saveWorkflowToPack(packId: string, workflow: import('./workflowSchema').WorkflowDefinition): Promise<void> {
  const { workflowToRuleFile } = await import('./workflowConverters');
  const rec = await getWebEvent(packId);
  if (!rec) throw createWebEventError('PACK_NOT_FOUND', `未找到事件包：${packId}`);
  // 保存工作流原始格式
  rec.files['schema/workflow.json'] = JSON.stringify(workflow, null, 2);
  // 同时生成 rules.json 兼容旧引擎
  const rf = workflowToRuleFile(workflow);
  rec.files['schema/rules.json'] = JSON.stringify(rf, null, 2);
  await putWebEvent(rec);
}

/**
 * 从事件包加载工作流定义。
 * 优先读 schema/workflow.json，不存在则从 schema/rules.json 转换。
 */
export async function loadWorkflowFromPack(packId: string): Promise<import('./workflowSchema').WorkflowDefinition | null> {
  const { ruleFileToWorkflow } = await import('./workflowConverters');
  const rec = await getWebEvent(packId);
  if (!rec) return null;
  // 优先读工作流格式
  const wfRaw = rec.files['schema/workflow.json'];
  if (typeof wfRaw === 'string') {
    try { return JSON.parse(wfRaw) as import('./workflowSchema').WorkflowDefinition; } catch { /* 损坏 */ }
  }
  // 回退：从 rules.json 转换
  const rfRaw = rec.files['schema/rules.json'];
  if (typeof rfRaw === 'string') {
    try {
      const rf = JSON.parse(rfRaw) as import('./schema').RuleFile;
      return ruleFileToWorkflow(rf, packId);
    } catch { /* 损坏 */ }
  }
  return null;
}

/**
 * 新建一条空白规则（manifest type='rule' + 空 schema/rules.json）。
 * 返回新建包 id，供事件中心「新建规则」后直接打开 RuleEditor。
 */
export async function createRule(worldId?: string): Promise<string> {
  const id = `rule-${Date.now()}`;
  const manifest: Manifest = {
    id,
    name: '我的规则',
    version: '1.0.0',
    author: '匿名',
    description: '由事件中心创建的规则。',
    engine: 'opt-event',
    schemaVersion: 1,
    minAppVersion: '2.6.1',
    type: 'rule',
    coverColor: '#3b82f6',
    icon: 'Zap',
    enabledByDefault: false,
    loadOrder: 100,
    permissions: [],
    ...(worldId ? { worldId } : {}),
  };
  const rec: WebEventRecord = {
    id,
    manifest,
    enabled: false,
    status: 'installed',
    installedAt: new Date().toISOString(),
    files: {
      'manifest.json': JSON.stringify(manifest, null, 2),
      'schema/rules.json': JSON.stringify({ version: 1, rules: [], periodicRules: [] } as RuleFile, null, 2),
    },
  };
  await putWebEvent(rec);
  return id;
}

/**
 * 在事件库新建一个「空白事件包」并立即落盘（manifest type='card' + 空 schema/events.json）。
 * 类比「创建游戏存档」：点击即生成一个空的、已持久化的包，随后在编辑器里往里加事件。
 * 返回新建包 id，供事件中心「新建事件包」后直接打开编辑器。
 */
export async function createEmptyPack(defaultName = '我的卡片事件包', worldId?: string): Promise<string> {
  const id = `pack-${Date.now()}`;
  const manifest: Manifest = {
    id,
    name: defaultName,
    version: '1.0.0',
    author: '匿名',
    description: '由事件中心创建的事件包。',
    engine: 'opt-event',
    schemaVersion: 1,
    minAppVersion: '2.6.1',
    type: 'card',
    coverColor: '#3b82f6',
    icon: 'FileText',
    enabledByDefault: false,
    loadOrder: 100,
    permissions: ['add_card'],
    ...(worldId ? { worldId } : {}),
  };
  const file = canonicalIndex(defaultName, []);
  const rec: WebEventRecord = {
    id,
    manifest,
    enabled: false,
    status: 'installed',
    installedAt: new Date().toISOString(),
    files: {
      'manifest.json': JSON.stringify(manifest, null, 2),
      'schema/events.json': JSON.stringify(file, null, 2),
    },
  };
  await putWebEvent(rec);
  return id;
}

/** 列出 canonical v2 索引中的事件元数据；包不存在时返回空数组。 */
export async function listEventsInPack(packId: string): Promise<EventIndexEntry[]> {
  const rec = await getWebEvent(packId);
  if (!rec) return [];
  return readCanonicalIndex(rec).events;
}

/** 以单个事件和工作流新建 canonical v2 事件包。 */
export async function createPackWithEvent(
  entry: EventIndexEntry,
  workflow: CardWorkflowDefinition,
  meta: { id: string; name: string; version?: string; coverColor?: string; icon?: string; type: EventPackType; periodicRules?: PeriodicRule[]; worldId?: string },
): Promise<string> {
  const manifest: Manifest = {
    id: meta.id,
    name: meta.name,
    version: meta.version ?? '2.6.1',
    author: '',
    schemaVersion: 1,
    minAppVersion: meta.version ?? '2.6.1',
    type: meta.type,
    engine: 'opt-event',
    coverColor: meta.coverColor ?? '#3b82f6',
    icon: meta.icon ?? 'Package',
    enabledByDefault: false,
    ...(meta.worldId ? { worldId: meta.worldId } : {}),
  };
  const file = canonicalIndex(meta.name, [entry]);
  const workflowPath = `schema/event-${entry.id}.json`;
  const validWorkflow = validateWorkflow(entry, workflow, workflowPath);
  const rec: WebEventRecord = {
    id: meta.id,
    manifest,
    enabled: false,
    status: 'installed',
    installedAt: new Date().toISOString(),
    files: {
      'manifest.json': JSON.stringify(manifest, null, 2),
      'schema/events.json': JSON.stringify(file, null, 2),
      [workflowPath]: JSON.stringify(validWorkflow, null, 2),
    },
  };
  if (meta.periodicRules !== undefined) writePeriodicRulesToRecord(rec, meta.periodicRules);
  await putWebEvent(rec);
  return meta.id;
}

/** 返回库内当前「已启用」(rec.enabled === true) 的事件包 id 列表，供新建存档时并入默认启用集 */
export async function getWebEnabledEventIds(): Promise<string[]> {
  const recs = await allWebEvents();
  return recs.filter((r) => r.enabled).map((r) => r.id);
}

// ─────────────────────────────────────────────────────────────
//  世界树关联事件包 → IndexedDB 自动安装
// ─────────────────────────────────────────────────────────────

import type { WorldDef } from '../data/worlds-schema';

/**
 * 把世界定义中的 eventPacks 自动安装进 IndexedDB（幂等）。
 * 已存在的包（同 ID）跳过，不覆盖用户可能的修改。
 * 安装的包标记 builtin=true，不可在事件中心删除。
 */
export async function installWorldEventPacks(world: WorldDef): Promise<void> {
  const packs = world.eventPacks;
  if (!packs || packs.length === 0) return;

  for (const pack of packs) {
    const existing = await getWebEvent(pack.id);
    if (existing) {
      // 已存在：强制覆盖更新（内置包内容随版本变化，必须同步）
      // 保留用户的 enabled 状态和 installedAt，其余全部覆盖
    }

    const packType = pack.type ?? 'rule';

    // 构造 manifest
    const manifest: Manifest = {
      id: pack.id,
      name: pack.name ?? (packType === 'card' ? `${world.name ?? world.id} 事件` : `${world.name ?? world.id} 规则`),
      version: '1.0.0',
      author: '内置',
      description: packType === 'card'
        ? `${world.name ?? world.id} 的内置事件包`
        : `${world.name ?? world.id} 的内置规则`,
      engine: 'opt-event',
      schemaVersion: 1,
      minAppVersion: '2.6.1',
      type: packType,
      coverColor: packType === 'card' ? '#10b981' : '#6366f1',
      icon: packType === 'card' ? 'Swords' : 'Zap',
      enabledByDefault: true,
      loadOrder: 0,
      permissions: pack.permissions ?? (packType === 'card' ? ['add_card'] : ['modify_world_state']),
    };

    const files: Record<string, string> = {
      'manifest.json': JSON.stringify(manifest, null, 2),
    };

    if (packType === 'rule') {
      // 规则包：写 rules.json
      const ruleFile: RuleFile = {
        version: 1,
        rules: pack.rules ?? [],
        periodicRules: pack.periodicRules ?? [],
      };
      files['schema/rules.json'] = JSON.stringify(ruleFile, null, 2);
      // 同时生成 workflow.json（新工作流格式）
      try {
        const { WORLD_WORKFLOWS } = await import('./worldWorkflows');
        const workflowFn = WORLD_WORKFLOWS[world.id];
        if (workflowFn) {
          const workflow = workflowFn();
          files['schema/workflow.json'] = JSON.stringify(workflow, null, 2);
        }
      } catch { /* 世界工作流生成失败不影响旧规则 */ }
      // 规则包也使用 canonical v2 空索引。
      Object.assign(files, buildCanonicalCardPackFiles(manifest.name, []));
    } else if (packType === 'card') {
      const events: CanonicalCardPackEvent[] = (pack.events ?? []).map((event) => {
        if (!event.workflow) {
          throw new Error(`Card event ${event.id} is missing workflow`);
        }
        const entry: EventIndexEntry = { id: event.id, name: event.name };
        return {
          entry,
          workflow: { ...event.workflow, id: entry.id, name: entry.name },
        };
      });
      Object.assign(files, buildCanonicalCardPackFiles(manifest.name, events));
    }

    const rec: WebEventRecord = {
      id: pack.id,
      manifest,
      enabled: existing?.enabled ?? true,
      status: existing?.enabled === false ? 'disabled' : 'enabled',
      installedAt: existing?.installedAt ?? new Date().toISOString(),
      builtin: true,
      worldId: world.id,
      files,
    };

    await putWebEvent(rec);
  }
}

// ─────────────────────────────────────────────────────────────
//  存档导出辅助：收集事件包完整内容
// ─────────────────────────────────────────────────────────────

/** 导出用：事件包快照（ID + manifest + 文件内容 + 世界绑定） */
export interface EventPackSnapshot {
  id: string;
  manifest: Manifest;
  files: Record<string, string | Blob>;
  /** 来源世界 ID（内置包专用，导入时写回 worldId 防止跨世界污染） */
  worldId?: string;
  /** 内置标记 */
  builtin?: boolean;
}

/**
 * 按 id 列表收集事件包完整内容，供存档导出时打包。
 * 不存在的 id 静默跳过（不阻断导出）。
 */
export async function collectPacksForExport(ids: string[]): Promise<EventPackSnapshot[]> {
  const out: EventPackSnapshot[] = [];
  for (const id of ids) {
    const rec = await getWebEvent(id).catch(() => undefined);
    if (rec) {
      out.push({ id: rec.id, manifest: rec.manifest, files: rec.files, worldId: rec.worldId, builtin: rec.builtin });
    }
  }
  return out;
}

/**
 * 从存档导入的事件包快照写入 IndexedDB（排重）。
 * 已存在的包（同 ID）跳过，不覆盖用户可能的修改。
 * 返回实际新导入的包 id 列表。
 */
export async function importPacksFromSave(snapshots: EventPackSnapshot[]): Promise<string[]> {
  const imported: string[] = [];
  for (const snap of snapshots) {
    const existing = await getWebEvent(snap.id).catch(() => undefined);
    if (existing) {
      // 已存在：补写缺失的 worldId / builtin（修复旧存档缺少世界绑定的问题）
      if (snap.worldId && !existing.worldId) {
        existing.worldId = snap.worldId;
        existing.builtin = snap.builtin ?? existing.builtin;
        await putWebEvent(existing);
      }
      continue;
    }
    const rec: WebEventRecord = {
      id: snap.id,
      manifest: snap.manifest,
      enabled: true,
      status: 'enabled',
      installedAt: new Date().toISOString(),
      files: snap.files,
      worldId: snap.worldId,
      builtin: snap.builtin,
    };
    await putWebEvent(rec);
    imported.push(snap.id);
  }
  return imported;
}

export type { EventPackType };

// ─────────────────────────────────────────────────────────────
//  合集（Collection）Web 端操作
// ─────────────────────────────────────────────────────────────

/** 创建合集 */
export async function webCreateCollection(
  name: string,
  coverColor: string,
  icon: string,
  memberIds: string[],
): Promise<string> {
  const id = `col-${Date.now()}`;
  const now = new Date().toISOString();
  const col: Collection = { id, name, coverColor, icon, memberIds, createdAt: now, updatedAt: now };
  await putCollection(col);
  return id;
}

/** 更新合集（部分字段） */
export async function webUpdateCollection(
  id: string,
  updates: Partial<Pick<Collection, 'name' | 'coverColor' | 'icon' | 'memberIds'>>,
): Promise<void> {
  const existing = await getCollection(id);
  if (!existing) return;
  const updated: Collection = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  await putCollection(updated);
}

/** 删除合集 */
export async function webRemoveCollection(id: string): Promise<void> {
  await deleteCollection(id);
}

/**
 * 列出所有合集（自动过滤失效引用）。
 * 若 memberIds 中引用的事件包已不存在于 IndexedDB，则剔除该引用。
 */
export async function webListCollections(): Promise<Collection[]> {
  const cols = await allCollections();
  const allRecs = await allWebEvents();
  const existingIds = new Set(allRecs.map(r => r.id));
  const result: Collection[] = [];
  for (const col of cols) {
    const validMembers = col.memberIds.filter(mid => existingIds.has(mid));
    if (validMembers.length !== col.memberIds.length) {
      // 自动清理失效引用并回写
      const cleaned: Collection = { ...col, memberIds: validMembers, updatedAt: new Date().toISOString() };
      await putCollection(cleaned);
      result.push(cleaned);
    } else {
      result.push(col);
    }
  }
  return result;
}

/** 获取合集详情（含成员列表） */
export async function webGetCollectionDetail(
  id: string,
): Promise<{ collection: Collection; members: EventRegistryEntry[] } | null> {
  const col = await getCollection(id);
  if (!col) return null;
  const members: EventRegistryEntry[] = [];
  for (const mid of col.memberIds) {
    const rec = await getWebEvent(mid);
    if (rec) members.push(recordToEntry(rec));
  }
  return { collection: col, members };
}
