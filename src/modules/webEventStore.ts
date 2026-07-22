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
  RuleFile,
  ValidationResult,
  ValidationIssue,
  RuleSummary,
  CardSummary,
  Condition,
  ActionKind,
  DepIssue,
  ConflictStatus,
  EventDef,
  PeriodicRule,
  EventPackFile,
  PuckData,
  CardFile,
  Collection,
} from './schema';
import { flattenEventPack, eventDefToCardFile, cardFileToEventPack } from './schema';
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

const APP_VERSION = '2.6.6';
const ID_RE = /^[a-z0-9][a-z0-9_:-]{2,63}$/;
const VER_RE = /^\d+\.\d+\.\d+$/;
const TEXT_RE = /\.(json|txt|md|csv|yml|yaml)$/i;

/** Web 端结构化错误（eventApi 捕获后转 EventApiError） */
class WebEventError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WebEventError';
    this.code = code;
  }
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
  const zip = await JSZip.loadAsync(file);
  const mFile = zip.file('manifest.json');
  if (!mFile) throw new WebEventError('ZIP_INVALID', '压缩包内缺少 manifest.json');
  const manifest = JSON.parse(await mFile.async('string')) as Manifest;
  const files: Record<string, string | Blob> = { 'manifest.json': JSON.stringify(manifest, null, 2) };
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path === 'manifest.json') continue;
    if (!/^(schema|assets)\//.test(path)) continue; // 仅收 schema/ 与 assets/
    if (path.includes('..') || /^(schema|assets)\/\.\./.test(path)) {
      throw new WebEventError('PATH_INVALID', `非法路径：${path}`);
    }
    files[path] = TEXT_RE.test(path) ? await entry.async('string') : await entry.async('blob');
  }
  return { manifest, files };
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
export async function webImportFromFile(file: File | Blob | ArrayBuffer | Uint8Array): Promise<EventMeta> {
  const { manifest, files } = await parseWtgmod(file);
  const v = localValidate(manifest);
  if (!v.ok) {
    throw new WebEventError('MANIFEST_INVALID', `校验未通过：${v.errors.map((e) => e.message).join('；')}`);
  }
  const existing = await getWebEvent(manifest.id);
  const enabled = existing?.enabled ?? (manifest.enabledByDefault ?? false);
  const rec: WebEventRecord = {
    id: manifest.id,
    manifest,
    enabled,
    status: enabled ? 'enabled' : 'installed',
    installedAt: existing?.installedAt ?? new Date().toISOString(),
    files,
  };
  // 修正后模型兼容桥：若以 schema/events.json（EventPackFile）导入且缺 schema/card.json，
  // 经 flattenEventPack 派生 schema/card.json，使仍直接读旧拆分文件的消费端（CardOverlay 等）可工作。
  const evRaw = rec.files['schema/events.json'];
  if (typeof evRaw === 'string' && !rec.files['schema/card.json']) {
    try {
      const file = JSON.parse(evRaw) as EventPackFile;
      const flat = flattenEventPack(file);
      rec.files['schema/card.json'] = JSON.stringify(
        { version: file.version, puck: { root: { props: {} }, components: {} }, cards: flat.cards } as CardFile,
        null, 2,
      );
    } catch (e) {
      // 损坏数据可见化（P0-3）：兼容桥失败不阻断导入，但不再完全静默
      console.error('[webEventStore] 派生 schema/card.json 失败（已跳过）：', e);
    }
  }
  await putWebEvent(rec);
  return manifestToMeta(manifest);
}

export async function webUninstallPack(id: string): Promise<void> {
  await deleteWebEvent(id);
}

export async function webEnablePack(id: string): Promise<void> {
  const rec = await getWebEvent(id);
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', `未找到事件：${id}`);
  rec.enabled = true;
  rec.status = 'enabled';
  await putWebEvent(rec);
}

export async function webDisablePack(id: string): Promise<void> {
  const rec = await getWebEvent(id);
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', `未找到事件：${id}`);
  rec.enabled = false;
  rec.status = 'disabled';
  await putWebEvent(rec);
}

/** 重建 .opt-event 并触发浏览器下载（Web 端无原生保存对话框，走 Blob） */
export async function webExportPack(id: string): Promise<void> {
  const rec = await getWebEvent(id);
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', `未找到事件：${id}`);
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
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', `未找到事件：${id}`);
  const entry = recordToEntry(rec);
  // 规则汇总以 events.json 中的周期规则为真值（authoring 路径从不写 manifest.rules，故直接读 events.json；P0-5 Web 修复）
  let rulesSummary: RuleSummary[] = [];
  const evRaw = rec.files['schema/events.json'];
  if (typeof evRaw === 'string') {
    try {
      const file = JSON.parse(evRaw) as EventPackFile;
      rulesSummary = (file.periodicRules ?? []).map((p) => ({
        id: p.id,
        file: 'schema/events.json',
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

// ─── 3 个 pack 内事件读写辅助（side-card 格式，schema/card.json 保持派生/同步） ───

/**
 * 向指定事件包写入（新建或覆盖）一个事件，并同步维护 side-card 物理布局：
 *   - schema/events.json          EventPackFile 索引（upsert by event.id）
 *   - schema/event-<id>.json     该事件的 CardFile 画布
 *   - schema/card.json           旧消费端兼容派生（flattenEventPack(file).cards 包成 CardFile）
 * 旧 pack 若仅有 schema/card.json（无 events.json），自动经 cardFileToEventPack 回退派生索引。
 */
export async function saveEventToPack(
  packId: string,
  event: EventDef,
  opts?: { cardFile?: CardFile; periodicRules?: PeriodicRule[] },
): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', `未找到事件包：${packId}`);

  // 解析已有索引；优先 events.json，否则回退旧 card.json 派生，再否则建空索引
  let file: EventPackFile = rec.files['schema/events.json']
    ? (JSON.parse(rec.files['schema/events.json'] as string) as EventPackFile)
    : { version: 1, name: rec.manifest.name, events: [] };
  if (!rec.files['schema/events.json'] && rec.files['schema/card.json']) {
    file = cardFileToEventPack(JSON.parse(rec.files['schema/card.json'] as string) as CardFile, rec.manifest);
  }

  // upsert：相同 id 覆盖，否则追加
  const idx = file.events.findIndex((e) => e.id === event.id);
  if (idx >= 0) file.events[idx] = event;
  else file.events.push(event);

  // 写入 per-event 画布
  rec.files[`schema/event-${event.id}.json`] = JSON.stringify(
    opts?.cardFile ?? eventDefToCardFile(event),
    null,
    2,
  );

  // 仅当显式传入时才覆盖周期规则（undefined 表示保持原值）
  if (opts?.periodicRules !== undefined) {
    file.periodicRules = opts.periodicRules;
  }

  // 写回索引
  rec.files['schema/events.json'] = JSON.stringify(file, null, 2);

  rec.manifest = { ...rec.manifest };
  await putWebEvent(rec);
}

/**
 * 从事件包内删除一个事件（按 eventId）。
 *
 * 职责：
 *   - 从 EventPackFile 索引（schema/events.json，旧包回退 schema/card.json）中移除指定 eventId 的事件。
 *   - 删除该事件对应的画布文件 schema/event-<id>.json。
 *   - 同步重建派生 card.json（与 saveEventToPack 派生写法一致：version + 首事件 puck + flattenEventPack(file).cards；删光后 cards=[]）。
 *
 * 边界：
 *   - 包不存在 → 抛 WebEventError('MOD_NOT_FOUND')。
 *   - 新格式包（有 events.json）：按 id 过滤，即便 events 为空也写回空数组；同时更新派生 card.json。
 *   - 旧格式包（仅 card.json，无稳定事件 id）：其唯一事件即删除目标，删除即清空；card.json 清空为空白 CardFile(cards:[])，且不生成 events.json（保留旧格式）。
 *   - 既无 events.json 也无 card.json：视为空包，仅尝试删除残留画布文件后落盘。
 *   - 不修改 rec.manifest（保持 type 等字段）。
 *
 * 与 saveEventToPack 的关系：
 *   saveEventToPack 负责 upsert + 写画布 + 派生 card.json；本函数是其逆操作（删除 + 同步派生）。
 *   二者共用同一套「events.json 为索引、event-<id>.json 为画布、card.json 为派生」的存储约定，
 *   因此 delete 后仍需像 save 一样重建 card.json，确保 CardOverlay / EventConfigPanel / CardRenderer 读到一致数据。
 */
export async function deleteEventFromPack(packId: string, eventId: string): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', '未找到事件包：' + packId);

  const hasEventsJson = !!rec.files['schema/events.json'];
  let file: EventPackFile;

  if (hasEventsJson) {
    // 新格式：events.json 即索引
    file = JSON.parse(rec.files['schema/events.json'] as string) as EventPackFile;
  } else if (rec.files['schema/card.json']) {
    // 旧格式回退：经 cardFileToEventPack 派生 EventPackFile（仅含一个事件，id 为随机 UUID）。
    // 旧包无稳定事件 id，其唯一事件即删除目标 → 清空。
    file = cardFileToEventPack(JSON.parse(rec.files['schema/card.json'] as string) as CardFile, rec.manifest);
    file.events = [];
  } else {
    // 既无 events.json 也无 card.json：视为空包，仅删除可能的残留画布文件后落盘
    delete rec.files['schema/event-' + eventId + '.json'];
    await putWebEvent(rec);
    return;
  }

  // 新格式按 id 过滤掉目标事件（旧格式已在上面清空）
  if (hasEventsJson) {
    file.events = file.events.filter((e) => e.id !== eventId);
  }

  // 删除该事件对应的画布文件（值可能是 string 或 Blob，直接 delete 即可）
  delete rec.files['schema/event-' + eventId + '.json'];

  if (hasEventsJson) {
    // 新格式：即便 events 为空也写回空数组，保持索引存在
    rec.files['schema/events.json'] = JSON.stringify(file, null, 2);
  }

  // rec.manifest 保持不变（不修改 type）
  await putWebEvent(rec);
}

/**
 * 重命名事件包内的一个事件（按 eventId）。
 *
 * 职责：
 *   - 更新 EventPackFile 索引（schema/events.json）中该事件的 name。
 *   - 若该事件的画布文件 schema/event-<id>.json 存在，解析后更新其 name 并写回（保留其它字段）；不存在则跳过画布文件更新。
 *
 * 边界：
 *   - 包不存在 → 抛 WebEventError('MOD_NOT_FOUND')。
 *   - newName 去除首尾空白后为空 → 直接 return，不做任何更新（不抛错）。
 *   - 旧格式包（无 events.json，仅有 card.json）：无稳定事件 id，无法按 id 定位，直接 return 跳过。
 *   - 画布文件损坏（解析失败）→ 跳过其 name 更新，不阻断整体重命名。
 *
 * 与 saveEventToPack 的关系：
 *   saveEventToPack 在 upsert 事件时已把 name 写入 events.json（画布 CardFile 本身不含 name 字段）。
 *   本函数仅就地修改既有存储中的 name，不重建 card.json（card.json 不含 name 字段，无需同步）。
 */
export async function renameEventInPack(packId: string, eventId: string, newName: string): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', '未找到事件包：' + packId);

  const trimmed = (newName ?? '').trim();
  if (trimmed === '') return; // 空名不更新，直接返回

  // 旧格式包（仅 card.json，无 events.json）：无稳定事件 id，无法按 id 定位，跳过
  if (!rec.files['schema/events.json']) return;

  const file = JSON.parse(rec.files['schema/events.json'] as string) as EventPackFile;
  const ev = file.events.find((e) => e.id === eventId);
  if (ev) ev.name = trimmed;

  // 若该事件画布文件存在，解析后更新其 name 并写回（保留其它字段）；不存在则跳过
  const canvasKey = 'schema/event-' + eventId + '.json';
  const canvasRaw = rec.files[canvasKey];
  if (canvasRaw && typeof canvasRaw === 'string') {
    try {
      const cf = JSON.parse(canvasRaw) as CardFile & { name?: string };
      cf.name = trimmed; // 画布 CardFile 本身不含 name，这里兼容写入（保留其它字段）
      rec.files[canvasKey] = JSON.stringify(cf, null, 2);
    } catch {
      /* 画布文件损坏：跳过其 name 更新，不阻断整体重命名 */
    }
  }

  // 写回索引（name 仅存于 events.json，无需重建 card.json）
  rec.files['schema/events.json'] = JSON.stringify(file, null, 2);
  await putWebEvent(rec);
}

/**
 * 落盘事件包元信息（名称/描述/作者/版本/封面/图标）。
 * 注意：saveEventToPack 只更新 manifest.cards，不写 manifest.name，
 * 因此事件包改名必须显式调用本函数才会持久化。
 */
export async function savePackMeta(
  packId: string,
  meta: Partial<Pick<Manifest, 'name' | 'description' | 'author' | 'version' | 'coverColor' | 'icon'>>,
): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', `未找到事件包：${packId}`);
  rec.manifest = { ...rec.manifest, ...meta };
  // 同步 EventPackFile.name（events.json 顶层），保持索引与 manifest 一致
  const evRaw = rec.files['schema/events.json'];
  if (typeof evRaw === 'string') {
    try {
      const file = JSON.parse(evRaw) as EventPackFile;
      file.name = rec.manifest.name;
      rec.files['schema/events.json'] = JSON.stringify(file, null, 2);
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
 * 不存在该 pack 时抛 WebEventError（调用方应保证 eventPackId 来自已安装包）。
 */
export async function saveRulesToPack(packId: string, rules: EventRule[], periodicRules?: PeriodicRule[]): Promise<void> {
  const rec = await getWebEvent(packId);
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', `未找到事件包：${packId}`);
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
  if (!rec) throw new WebEventError('PACK_NOT_FOUND', `未找到事件包：${packId}`);
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
 * 新建一条空白规则（manifest type='rule' + 空 schema/rules.json）。
 * 返回新建包 id，供事件中心「新建规则」后直接打开 RuleEditor。
 */
export async function createRule(): Promise<string> {
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
    cards: [],
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
export async function createEmptyPack(defaultName = '我的卡片事件包'): Promise<string> {
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
    cards: [],
  };
  const file: EventPackFile = { version: 1, name: defaultName, events: [] };
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

/**
 * 列出事件包内的所有事件（EventDef[]）。
 * 旧 pack（仅 schema/card.json）回退：经 cardFileToEventPack 包装成单一事件返回。
 * 包不存在或两种存储均缺时返回空数组。
 */
export async function listEventsInPack(packId: string): Promise<EventDef[]> {
  const rec = await getWebEvent(packId);
  if (!rec) return [];
  if (rec.files['schema/events.json']) {
    return (JSON.parse(rec.files['schema/events.json'] as string) as EventPackFile).events;
  } else if (rec.files['schema/card.json']) {
    return [cardFileToEventPack(JSON.parse(rec.files['schema/card.json'] as string) as CardFile, rec.manifest).events[0]];
  }
  return [];
}

/**
 * 以单个事件新建一个完整事件包（含 manifest / events.json / per-event 画布 / 派生 card.json），落 IndexedDB。
 * 返回新建的包 id（= meta.id）。manifest 缺省字段补默认值；author/schemaVersion/minAppVersion 为 Manifest 必填项，补空/默认。
 */
export async function createPackWithEvent(
  event: EventDef,
  meta: { id: string; name: string; version?: string; coverColor?: string; icon?: string; type: EventPackType; periodicRules?: PeriodicRule[] },
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
  };
  const file: EventPackFile = {
    version: 1,
    name: meta.name,
    events: [event],
    periodicRules: meta.periodicRules,
  };
  const rec: WebEventRecord = {
    id: meta.id,
    manifest,
    enabled: false,
    status: 'installed',
    installedAt: new Date().toISOString(),
    files: {
      'manifest.json': JSON.stringify(manifest, null, 2),
      'schema/events.json': JSON.stringify(file, null, 2),
      ['schema/event-' + event.id + '.json']: JSON.stringify(eventDefToCardFile(event), null, 2),
      'schema/card.json': JSON.stringify(
        { version: file.version, puck: eventDefToCardFile(event).puck, cards: flattenEventPack(file).cards },
        null,
        2,
      ),
    },
  };
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
      // 规则包也需要 events.json（空的，供索引用）
      files['schema/events.json'] = JSON.stringify({ version: 1, events: [] } as EventPackFile, null, 2);
    } else if (packType === 'card') {
      // 事件包：写 events.json + 每个事件的画布文件
      const events = pack.events ?? [];
      const eventPackFile: EventPackFile = {
        version: 1,
        name: pack.name,
        events: events.map(e => ({
          id: e.id,
          name: e.name,
          cards: e.cards.map(c => ({ id: c.id, componentId: c.componentId, title: c.title })),
          puck: e.puck,
        })),
      };
      files['schema/events.json'] = JSON.stringify(eventPackFile, null, 2);
      // 每个事件单独写画布文件（CardOverlay 按 event-{id}.json 查找）
      for (const evt of events) {
        const cardFile = {
          version: 1,
          puck: evt.puck ?? { root: { props: {} }, components: {} },
          cards: evt.cards.map(c => ({ id: c.id, componentId: c.componentId, title: c.title })),
        };
        files[`schema/event-${evt.id}.json`] = JSON.stringify(cardFile, null, 2);
      }
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

// ─── 兼容别名（旧名 → 新名） ───

/** @deprecated 请使用 webDiscoverPacks */
export const webDiscoverMods = webDiscoverPacks;
/** @deprecated 请使用 webListPacks */
export const webListMods = webListPacks;
/** @deprecated 请使用 webValidatePack */
export const webValidateMod = webValidatePack;
/** @deprecated 请使用 webUninstallPack */
export const webUninstallMod = webUninstallPack;
/** @deprecated 请使用 webEnablePack */
export const webEnableMod = webEnablePack;
/** @deprecated 请使用 webDisablePack */
export const webDisableMod = webDisablePack;
/** @deprecated 请使用 webExportPack */
export const webExportMod = webExportPack;
/** @deprecated 请使用 createRule */
export const createRulePack = createRule;

export type { EventPackType, EventPackType as EventType };

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
