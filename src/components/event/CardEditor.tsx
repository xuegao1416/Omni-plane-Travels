import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import JSZip from 'jszip';
import {
  ArrowLeft, FileText, ScrollText, ListChecks, Eye, ShieldCheck, Settings, Pencil,
  Download, Save, Braces, Plus, Trash2, ArrowUp, ArrowDown, BookOpen, X, AlertTriangle, Check, Package,
  Layers, Loader2,
} from 'lucide-react';
import type { CardFile, PuckData, CardDef, Manifest, ValidationIssue, EventPackType, ChoiceOption, ChoiceEffect, PeriodicRule, RuleFile, EventDef, EventPackFile } from '../../modules/schema';
import type { GameState } from '../../schema/variables';
import { getAllWorldBookEntries, WorldBookPicker, type WorldBookSelection } from './WorldBookPicker';
import { getWebEvent, putWebEvent } from '../../modules/eventDb';
import { saveEventToPack, createPackWithEvent, listEventsInPack, savePackMeta, deleteEventFromPack, renameEventInPack } from '../../modules/webEventStore';
import StatIdSelect from './StatIdSelect';
import { textOn } from './colorUtils';

/* ⚠️ 环境说明：本环境的 npm `puck` 包实为无关的「洋葱中间件网络库」，
   并非 React Puck 可视化编辑器（其 npm 包未安装，且沙箱禁止改 package.json 安装）。
   因此此处用自研的轻量画布实现「组件库 / 画布 / 属性 / JSON 双向绑定」，
   产出 schema 兼容的 CardFile（puck: PuckData）。若后续接入真正的 React Puck 编辑器，
   仅需替换画布层，下面对外契约（CardFile / 导出 .opt-event）保持不变。 */

const APP_VERSION = '2.6.5';

const BLOCK_TYPES = ['title', 'narrative', 'choice'] as const;
type BlockType = (typeof BLOCK_TYPES)[number];

interface BlockProps {
  title?: string;
  text?: string;
  choices?: ChoiceOption[];
  worldbookRefs?: WorldBookSelection[];
}
interface CardBlock {
  id: string;
  type: BlockType;
  props: BlockProps;
}

const BLOCK_META: Record<BlockType, { label: string; icon: typeof FileText; desc: string }> = {
  title: { label: '标题卡', icon: FileText, desc: '单句强提示，驱动章节/事件标题' },
  narrative: { label: '叙述卡', icon: ScrollText, desc: '段落叙事正文' },
  choice: { label: '选择卡', icon: ListChecks, desc: '多个玩家选项' },
};

interface ManifestDraft {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  coverColor: string;
  icon: string;
}

function newId(): string {
  return `card-${Math.random().toString(36).slice(2, 8)}`;
}

// 事件 id：未落盘的新建事件也使用真实 id（evt- 前缀），保存时直接 upsert，不再用 draft- 占位前缀。
// 从机制上杜绝「切换事件时重 mint id 导致重复/幽灵事件」（架构裁决：废止 draft- 前缀）。
function newEventId(): string {
  return `evt-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultProps(type: BlockType): BlockProps {
  switch (type) {
    case 'title':
      return { title: '在此输入卡片标题' };
    case 'narrative':
      return { text: '在此输入卡片正文，描述此处的剧情与抉择。' };
    case 'choice':
      return { choices: [{ label: '选项一' }, { label: '选项二' }] };
  }
}

function defaultBlock(type: BlockType): CardBlock {
  return { id: newId(), type, props: defaultProps(type) };
}

function blockTitle(b: CardBlock): string {
  if (b.type === 'title') return b.props.title || '(无标题)';
  if (b.type === 'narrative') return (b.props.text || '(无正文)').slice(0, 24);
  if (b.type === 'choice') return `选择卡（${(b.props.choices ?? []).length} 项）`;
  return b.id;
}

// ─── CardFile ⇄ 画布 blocks（schema 兼容的 PuckData） ───
function toCardFile(blocks: CardBlock[]): CardFile {
  const components: Record<string, Array<{ id: string; props: Record<string, unknown> }>> = {};
  for (const t of BLOCK_TYPES) components[t] = [];
  const cards: CardDef[] = [];
  for (const b of blocks) {
    components[b.type].push({ id: b.id, props: b.props as Record<string, unknown> });
    cards.push({
      id: b.id,
      componentId: b.type,
      title: b.props.title ?? blockTitle(b),
      kind: 'add',
    });
  }
  const puck: PuckData = { root: { props: {} }, components };
  return { version: 1, puck, cards };
}

function fromCardFile(file: CardFile): CardBlock[] {
  const out: CardBlock[] = [];
  for (const t of BLOCK_TYPES) {
    for (const c of file.puck.components?.[t] ?? []) {
      out.push({ id: c.id, type: t, props: c.props as BlockProps });
    }
  }
  return out;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const VER_RE = /^\d+\.\d+\.\d+$/;

/** 结构化校验（对应 spec 校验顺序：结构 → 必填 → 内容合法性） */
export function validateCardFile(file: CardFile, manifest: ManifestDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof file.version !== 'number') issues.push({ code: 'SCHEMA', field: 'version', message: 'version 必须为数字' });
  if (!file.puck || typeof file.puck !== 'object') issues.push({ code: 'SCHEMA', field: 'puck', message: 'puck 结构缺失' });
  if (!Array.isArray(file.cards)) issues.push({ code: 'SCHEMA', field: 'cards', message: 'cards 必须为数组' });

  for (let i = 0; i < file.cards.length; i++) {
    const b = fromCardFile(file)[i];
    if (!b) continue;
    if (b.type === 'title' && !(b.props.title ?? '').trim()) {
      issues.push({ code: 'MISSING_FIELD', field: `blocks[${i}].title`, message: '标题卡的标题不能为空' });
    }
    if (b.type === 'narrative' && !(b.props.text ?? '').trim()) {
      issues.push({ code: 'MISSING_FIELD', field: `blocks[${i}].text`, message: '叙述卡的正文不能为空' });
    }
    if (b.type === 'choice') {
      const ch = b.props.choices ?? [];
      if (ch.length === 0) issues.push({ code: 'MISSING_FIELD', field: `blocks[${i}].choices`, message: '选择卡至少需要一个选项' });
      ch.forEach((c, j) => {
        const label = typeof c === 'string' ? c : (c?.label ?? '');
        if (!label.trim()) issues.push({ code: 'MISSING_FIELD', field: `blocks[${i}].choices[${j}]`, message: '选项内容不能为空' });
      });
    }
  }

  if (!ID_RE.test(manifest.id)) issues.push({ code: 'MANIFEST_MISSING_FIELD', field: 'id', message: `id 不符合 ^[a-z0-9][a-z0-9_-]{2,63}$（当前：${manifest.id}；包ID为内部英文标识，输入中文名称将自动生成，仅限小写字母/数字/连字符）` });
  if (!VER_RE.test(manifest.version)) issues.push({ code: 'MANIFEST_INVALID', field: 'version', message: `version 需为 主.次.修 格式（当前：${manifest.version}）` });
  if (!manifest.name.trim()) issues.push({ code: 'MANIFEST_MISSING_FIELD', field: 'name', message: '事件名称不能为空' });
  return issues;
}

/** 包类型按完整内容推导（统一口径）：
 *  - 多事件（events>1）或（含卡片且含周期）→ bundle
 *  - 仅周期 → periodic
 *  - 否则 → card
 *  注意：rule/worldbook 为遗留枚举，本次不处理其创建路径。 */
function computePackType(pack: EventPackFile): EventPackType {
  const events = pack.events ?? [];
  const hasCards = events.some((e) => (e.cards?.length ?? 0) > 0);
  const hasPeriodic = (pack.periodicRules?.length ?? 0) > 0;
  const multiEvent = events.length > 1;
  if (multiEvent || (hasCards && hasPeriodic)) return 'bundle';
  if (hasPeriodic) return 'rule';
  return 'card';
}

function buildManifest(d: ManifestDraft, pack: EventPackFile): Manifest {
  const type = computePackType(pack);
  const hasCards = (pack.events ?? []).some((e) => (e.cards?.length ?? 0) > 0);
  return {
    id: d.id,
    name: d.name,
    version: d.version,
    author: d.author,
    description: d.description,
    engine: 'opt-event',
    schemaVersion: 1,
    minAppVersion: APP_VERSION,
    type,
    coverColor: d.coverColor,
    icon: d.icon,
    enabledByDefault: false,
    loadOrder: 100,
    permissions: ['add_card'],
    cards: hasCards ? ['schema/card.json'] : [],
  };
}

function stableIdFallback(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return 'pack-' + (h >>> 0).toString(36).slice(0, 6);
}

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || stableIdFallback(s);
}

/** 事件列表面板中的单条记录（已保存事件的真实 id；未保存草稿不占列表行） */
interface EventListItem {
  id: string;
  name: string;
  cardsLen: number;
  saved: boolean;
}

/** 事件列表只展示「已保存」的事件（来自磁盘）；未保存的草稿不占列表行，保存后自然出现 */

/** 仅为类型推导占位：用 N 张空卡片代表某事件的卡片数（computePackType 只读取 .length） */
function makePlaceholderCards(n: number): CardDef[] {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, componentId: 'title', title: '', kind: 'add' as const }));
}

export interface CardEditorProps {
  eventPackId: string | null;
  onBack: () => void;
  /** 当前存档(用于下拉规范键显示该世界实际属性;事件中心编辑时可为空) */
  gameState?: GameState;
  /** 保存成功后回调（用于事件库刷新） */
  onSaved?: () => void;
}

type Mode = 'visual' | 'json';

export default function CardEditor({ eventPackId, onBack, gameState, onSaved }: CardEditorProps) {
  const [blocks, setBlocks] = useState<CardBlock[]>([defaultBlock('title'), defaultBlock('narrative')]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('visual');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [wbOpen, setWbOpen] = useState(false);
  const [wbTarget, setWbTarget] = useState<string | null>(null);
  const dragIdx = useRef<number | null>(null);

  const [manifest, setManifest] = useState<ManifestDraft>({
    id: 'new-card-event',
    name: '我的卡片事件包',
    version: '1.0.0',
    author: '匿名',
    description: '由可视化卡片编辑器创作的卡片流。',
    coverColor: '#3b82f6',
    icon: 'FileText',
  });

  // 当前编辑所属的事件包 id（可由「新建包」动态切换，故用本地 state 而非仅 prop）
  const [currentPackId, setCurrentPackId] = useState<string | null>(eventPackId);
  // 当前正在编辑的事件 id（null = 尚未落盘的新事件）
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  // 事件名（EventDef.name，区别于包名 manifest.name）
  const [eventName, setEventName] = useState('');

  useEffect(() => {
    setCurrentPackId(eventPackId);
  }, [eventPackId]);

  const [periodicRules, setPeriodicRules] = useState<PeriodicRule[]>([]);
  // 事件列表面板状态
  const [eventList, setEventList] = useState<EventListItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);
  const skipDirty = useRef(false);
  // 标记「已为哪个 packId 完成加载回填」，用于保存前竞态守卫（避免加载未完成就用幽灵 id 落盘）
  const editLoadedRef = useRef<string | null>(null);
  const showSaveToast = (m: string) => { setSaveToast(m); setTimeout(() => setSaveToast(null), 2500); };

  // 删除事件确认模态目标（null = 关闭）
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  /** 删除事件：已保存事件走 deleteEventFromPack + 刷新；删的是当前事件则自动切到相邻/首个或空白态 */
  const handleDeleteEvent = async (id: string) => {
    if (!currentPackId) return;
    setDeleteTarget(null);
    try {
      await deleteEventFromPack(currentPackId, id);
      const evs = await listEventsInPack(currentPackId);
      setEventList(evs.map((e) => ({ id: e.id, name: e.name || '未命名事件', cardsLen: e.cards?.length ?? 0, saved: true })));
      if (id === selectedEventId) {
        if (evs.length > 0) {
          await selectEvent(evs[0].id);
        } else {
          const newId = newEventId();
          setSelectedEventId(newId);
          setEditingEventId(newId);
          setEventName('');
          setBlocks([defaultBlock('title'), defaultBlock('narrative')]);
          setSelected(null);
          setSaved(false);
        }
      }
    } catch (e) {
      showSaveToast('删除失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const wbEntries = useMemo(() => getAllWorldBookEntries(), []);

  // 打开「已安装」事件包：从落盘记录回填 manifest + 事件列表 + 首个事件的卡片块 + 周期规则。
  // 抽成可 await 函数，供「保存守卫」在加载未完成时先 await 再落盘，消除竞态（详见 handleSaveEvent）。
  const loadCurrentPack = async (packId: string, isCancelled: () => boolean): Promise<void> => {
    skipDirty.current = true; // 载入回填不触发“未保存”
    try {
      const rec = await getWebEvent(packId);
      if (!rec || isCancelled()) return;
      const mRaw = rec.files['manifest.json'];
      if (typeof mRaw === 'string') {
        const m = JSON.parse(mRaw) as Manifest;
        setManifest({
          id: m.id,
          name: m.name,
          version: m.version,
          author: m.author,
          description: m.description ?? '',
          coverColor: m.coverColor ?? '#3b82f6',
          icon: m.icon ?? 'FileText',
        });
      }
      // 读取事件索引（新模型 EventPackFile）
      const idxRaw = rec.files['schema/events.json'];
      if (typeof idxRaw === 'string') {
        const idx = JSON.parse(idxRaw) as EventPackFile;
        const evs = idx.events ?? [];
        if (Array.isArray(idx.periodicRules)) setPeriodicRules(idx.periodicRules);
        setEventList(evs.map((e) => ({ id: e.id, name: e.name || '未命名事件', cardsLen: e.cards?.length ?? 0, saved: true })));
        const first = evs[0] ?? null;
        if (first) {
          setSelectedEventId(first.id);
          setEditingEventId(first.id);
          setEventName(first.name);
          const dataRaw = rec.files[`schema/event-${first.id}.json`];
          if (typeof dataRaw === 'string') {
            try {
              const next = fromCardFile(JSON.parse(dataRaw) as CardFile);
              if (next.length > 0) setBlocks(next);
            } catch (e) {
              // 损坏数据可见化（P0-3）：暴露给用户而非静默忽略
              showSaveToast('事件画布解析失败，已跳过该事件：' + (e instanceof Error ? e.message : String(e)));
            }
          } else {
            // 兼容旧包：索引存在但无独立画布文件 → 回退 schema/card.json
            const cRaw = rec.files['schema/card.json'];
            if (typeof cRaw === 'string') {
              const next = fromCardFile(JSON.parse(cRaw) as CardFile);
              if (next.length > 0) setBlocks(next);
            }
          }
        } else {
          // 索引存在但无事件
          setSelectedEventId(null);
          setEditingEventId(null);
          setEventName('');
          setBlocks([defaultBlock('title'), defaultBlock('narrative')]);
        }
      } else {
        // 旧包（仅 schema/card.json）：回退为单个 in-progress 事件
        const cRaw = rec.files['schema/card.json'];
        const legacyBlocks = typeof cRaw === 'string' ? fromCardFile(JSON.parse(cRaw) as CardFile) : [];
        if (legacyBlocks.length > 0) setBlocks(legacyBlocks);
        const rRaw = rec.files['schema/rules.json'];
        if (typeof rRaw === 'string') {
          const rf = JSON.parse(rRaw) as RuleFile;
          if (rf.periodicRules) setPeriodicRules(rf.periodicRules);
        }
        setEventList(cRaw ? [{ id: newEventId(), name: '未命名事件', cardsLen: legacyBlocks.length, saved: false }] : []);
        setSelectedEventId(null);
        setEditingEventId(null);
        setEventName('');
      }
      setSaved(true);
    } catch (e) {
      // 损坏数据可见化（P0-3）：暴露给用户而非静默保留空白模板
      showSaveToast('读取事件包失败，已载入空白模板：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  useEffect(() => {
    if (!currentPackId) return;
    let cancelled = false;
    loadCurrentPack(currentPackId, () => cancelled).then(() => {
      if (!cancelled) editLoadedRef.current = currentPackId;
    });
    return () => { cancelled = true; };
  }, [currentPackId]);

  // 新建空包加载完成后，自动创建默认事件（对齐「创建世界即有默认事件」的 UX）
  useEffect(() => {
    if (!currentPackId) return;
    if (editLoadedRef.current !== currentPackId) return; // 加载未完成
    if (eventList.length > 0) return; // 已有事件，无需自动创建
    if (selectedEventId) return; // 已有选中事件
    const newId = newEventId();
    setSelectedEventId(newId);
    setEditingEventId(newId);
    setEventName('未命名事件');
    setBlocks([defaultBlock('title'), defaultBlock('narrative')]);
    setSelected(null);
    setSaved(false);
    showSaveToast('已自动创建默认事件，请编辑后保存');
  }, [currentPackId, eventList, selectedEventId]);

  // 任意编辑 → 标记未保存（载入回填已被 skipDirty 跳过）
  useEffect(() => {
    if (skipDirty.current) { skipDirty.current = false; return; }
    setSaved(false);
  }, [blocks, manifest, periodicRules]);

  // 进入 JSON 视图时，从当前画布同步 JSON 文本（AC-D1：可视化→JSON）
  const enterJson = () => {
    setJsonText(JSON.stringify(toCardFile(blocks), null, 2));
    setJsonError(null);
    setMode('json');
  };

  // 从 JSON 视图切回可视化：解析并应用（AC-D2：非法值不应用，标红）
  const applyJson = (): boolean => {
    try {
      const parsed = JSON.parse(jsonText) as CardFile;
      const next = fromCardFile(parsed);
      const errs = validateCardFile(parsed, manifest).filter((i) => i.code !== 'MANIFEST_MISSING_FIELD' && i.code !== 'MANIFEST_INVALID');
      if (errs.length > 0) {
        setJsonError('结构校验未通过：\n' + errs.map((e) => `· ${e.field ?? ''} ${e.message}`).join('\n'));
        return false;
      }
      if (next.length === 0) {
        setJsonError('卡片内容为空，至少保留一个卡片块。');
        return false;
      }
      setBlocks(next);
      setSelected(null);
      setJsonError(null);
      return true;
    } catch (e) {
      setJsonError('JSON 解析失败：' + (e instanceof Error ? e.message : String(e)));
      return false;
    }
  };

  const backToVisual = () => {
    if (mode === 'json') {
      const ok = applyJson();
      if (!ok) return; // 非法则停留在 JSON 视图，保留标红
    }
    setMode('visual');
  };

  const runValidate = () => {
    const file = toCardFile(blocks);
    const errs = validateCardFile(file, manifest);
    setIssues(errs);
    setMode('visual');
    if (errs.length === 0) showSaveToast('校验通过，当前事件无问题');
  };

  const addBlock = (type: BlockType) => {
    const b = defaultBlock(type);
    setBlocks((prev) => [...prev, b]);
    setSelected(b.id);
  };

  const updateSelected = (patch: Partial<BlockProps>) => {
    if (!selected) return;
    setBlocks((prev) => prev.map((b) => (b.id === selected ? { ...b, props: { ...b.props, ...patch } } : b)));
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (selected === id) setSelected(null);
  };

  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= blocks.length) return;
    setBlocks((prev) => {
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };

  const handleExport = async () => {
    const file = toCardFile(blocks);
    const errs = validateCardFile(file, manifest);
    if (errs.length > 0) {
      setIssues(errs);
      setMode('visual');
      return;
    }
    const m = buildManifest(manifest, buildCurrentPackSnapshot());
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(m, null, 2));
    zip.file('schema/card.json', JSON.stringify(file, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${m.id}.opt-event`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /** 由一个事件的一组 blocks 构建 EventDef（一个事件 = 一组卡片/blocks） */
  const buildEventDef = (src: CardBlock[], name: string, id: string): EventDef => {
    const cf = toCardFile(src);
    // 防御：事件名缺失时优先用首张标题卡文案派生，绝不直接落「未命名事件」幽灵名
    // （保存前已由 handleSaveEvent 的 eventName 闸门拦截空名，此处仅双保险）
    const t = src.find((b) => b.type === 'title')?.props.title?.trim();
    return { id, name: name.trim() || t || '未命名事件', cards: cf.cards };
  };

  // newEventId 已提升到模块级（废止 draft- 前缀，新建即真实 id）

  // ── 事件列表面板辅助 ──
  /** 由当前编辑态构建完整 EventPackFile 快照（仅供类型推导：非当前事件以 cardsLen 占位卡片） */
  const buildCurrentPackSnapshot = (): EventPackFile => {
    const currentRealId = selectedEventId ?? newEventId();
    const events: EventDef[] = eventList.map((entry) => {
      const isCurrent = entry.id === selectedEventId;
      if (isCurrent) {
        return buildEventDef(blocks, eventName, currentRealId);
      }
      return { id: entry.id, name: entry.name, cards: makePlaceholderCards(entry.cardsLen) };
    });
    return { version: 1, name: manifest.name, events, periodicRules };
  };

  /** 读取并刷新事件列表（保存后用于同步卡片数 / 名称） */
  const refreshEventList = async () => {
    // 列表只展示「已保存」的事件（来自磁盘）；未保存草稿不占列表行
    if (!currentPackId) { setEventList([]); return; }
    try {
      const evs = await listEventsInPack(currentPackId);
      setEventList(evs.map((e) => ({ id: e.id, name: e.name || '未命名事件', cardsLen: e.cards?.length ?? 0, saved: true })));
    } catch (e) {
      // 损坏数据可见化（P0-3）：保留当前列表但提示
      showSaveToast('事件列表刷新失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  /** 回写 manifest.type（saveEventToPack 本身不更新 type，故此处每次保存补正） */
  const persistPackType = async (packId: string, type: EventPackType) => {
    try {
      const rec = await getWebEvent(packId);
      if (!rec || rec.manifest.type === type) return;
      rec.manifest = { ...rec.manifest, type };
      await putWebEvent(rec);
    } catch (e) {
      // 非阻断：类型回写失败不影响已保存内容，但不再完全静默（P0-3）
      console.error('[CardEditor] persistPackType 失败（不阻断保存）：', e);
    }
  };

  /** 选择事件：仅当当前「已命名」事件有未保存内容才先存盘；未命名草稿直接丢弃不落盘（根治幽灵/未命名事件）。
   *  切到已保存事件从磁盘载入；点已选中行幂等；加载中忽略并发点击。 */
  const selectEvent = async (id: string) => {
    if (id === selectedEventId) return;
    if (eventsLoading) return;
    // 仅在「加载已完成」时自动预存当前草稿（理由同 handleNewEvent：避免加载未完成时编辑态无合法 id
    // 被竞态守卫误写成幽灵事件）。加载未完成时未保存草稿直接丢弃，随后的加载会回填真实事件。
    if (!saved && eventName.trim().length > 0 && currentPackId && editLoadedRef.current === currentPackId) {
      const ok = await handleSaveEvent();
      if (!ok) return;
    }
    setSelectedEventId(id); // 乐观更新：点击立即移动高亮，避免加载期旧行蓝框残留
    setEventsLoading(true);
    try {
      let blocksNext: CardBlock[] = [defaultBlock('title'), defaultBlock('narrative')];
      let nameNext = '';
      const isSavedLoad = currentPackId !== null && eventList.some((e) => e.id === id);
      if (isSavedLoad) {
        const rec = await getWebEvent(currentPackId!);
        const dataRaw = rec?.files[`schema/event-${id}.json`];
        if (typeof dataRaw === 'string') {
          const next = fromCardFile(JSON.parse(dataRaw) as CardFile);
          if (next.length > 0) blocksNext = next;
        }
        const idxRaw = rec?.files['schema/events.json'];
        if (typeof idxRaw === 'string') {
          const idx = JSON.parse(idxRaw) as EventPackFile;
          const evDef = idx.events?.find((e) => e.id === id);
          if (evDef) nameNext = evDef.name ?? '';
        }
      } else {
        nameNext = eventList.find((e) => e.id === id)?.name ?? '';
      }
      if (isSavedLoad) skipDirty.current = true; // 载入已保存事件不标记“未保存”
      setBlocks(blocksNext);
      setEditingEventId(id);
      setEventName(nameNext);
      setSelected(null);
      setSaved(isSavedLoad);
    } finally {
      setEventsLoading(false);
    }
  };


  /**
   * 保存「当前事件」到所属事件包（调用 saveEventToPack）。
   * 一个事件可由多张卡片组成（多 card block）；无包时自动先建包。
   */
  const handleSaveEvent = async (): Promise<boolean> => {
    // 竞态守卫：若该包加载回填尚未完成，先 await 再落盘，避免使用加载前的过渡初值（幽灵 id）误建未命名事件。
    // 复现路径：打开包后、loadCurrentPack 的 await getWebEvent 未 resolve 时即点「保存事件包」。
    if (currentPackId && editLoadedRef.current !== currentPackId) {
      await loadCurrentPack(currentPackId, () => false);
      editLoadedRef.current = currentPackId;
    }
    // 事件名为空时以「未命名事件」兜底（用户可后续双击事件列表重命名）
    if (!eventName.trim()) {
      setEventName('未命名事件');
    }
    const cf = toCardFile(blocks);
    const errs = validateCardFile(cf, manifest);
    if (errs.length > 0) {
      setIssues(errs);
      setMode('visual');
      showSaveToast('校验未通过，请先修正卡片内容');
      return false;
    }
    // 锁定当前事件的稳定 id：若尚未分配（新建草稿 / 加载未完成），当场分配并写回状态，
    // 避免后续保存每次都 newEventId() 生成不同 id 而产生幽灵/重复事件。
    let eventId = editingEventId;
    if (!eventId) {
      eventId = newEventId();
      setEditingEventId(eventId);
    }
    const eventDef = buildEventDef(blocks, eventName, eventId);
    const pack = buildCurrentPackSnapshot();
    const type = computePackType(pack);
    setSaving(true);
    try {
      let packId = currentPackId;
      if (!packId) {
        // 尚无包：以当前 manifest + 当前事件建一个新包（manifest.type 由此次重算）
        packId = await createPackWithEvent(eventDef, buildManifest(manifest, pack));
        if (!packId) return false;
        setCurrentPackId(packId);
        // 首建包时一并落盘画布与周期规则，避免首次保存丢失周期规则（P1-4）
        await saveEventToPack(packId, eventDef, { cardFile: cf, periodicRules });
      } else {
        await saveEventToPack(packId, eventDef, { cardFile: cf, periodicRules });
        await persistPackType(packId, type);
      }
      // 落盘事件包元信息（名称/描述/作者等改名），saveEventToPack 不写 manifest.name
      await savePackMeta(packId, {
        name: manifest.name,
        description: manifest.description,
        author: manifest.author,
        version: manifest.version,
        coverColor: manifest.coverColor,
        icon: manifest.icon,
      });
      setEditingEventId(eventId);
      setSelectedEventId(eventId);
      setSaved(true);
      await refreshEventList();
      showSaveToast('已保存事件包');
      onSaved?.();
      return true;
    } catch (e) {
      showSaveToast('保存失败：' + (e instanceof Error ? e.message : String(e)));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** 在当前包内新建一个事件：直接生成「未命名事件」+ 默认卡片，无需手动填名。
   *  当前未保存的已命名事件会自动先存盘（避免丢失），未命名草稿直接丢弃。 */
  const handleNewEvent = async () => {
    if (!saved && eventName.trim().length > 0 && currentPackId && editLoadedRef.current === currentPackId) {
      const ok = await handleSaveEvent();
      if (!ok) return;
    }
    const newId = newEventId();
    setSelectedEventId(newId);
    setEditingEventId(newId);
    setEventName('未命名事件');
    setBlocks([defaultBlock('title'), defaultBlock('narrative')]);
    setSelected(null);
    setSaved(false);
  };

  const selectedBlock = blocks.find((b) => b.id === selected) ?? null;
  const       wordCount = useMemo(
    () => blocks.reduce((s, b) => s + (b.props.title?.length ?? 0) + (b.props.text?.length ?? 0) + (b.props.choices?.map((c) => (typeof c === 'string' ? c : c.label)).join('').length ?? 0), 0),
    [blocks],
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
        <button className="btn-ghost btn-sm" onClick={onBack} style={{ minHeight: 'var(--touch-min)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={16} /> 返回
        </button>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
          {/* 事件包名称：可直接改名，点「保存事件包」时落盘。铅笔统一在可编辑标签左侧（size=14, aria-label=可编辑） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Package size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <Pencil size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-label="可编辑" />
            <input
              value={manifest.name}
              onChange={(e) => {
                const name = e.target.value;
                setManifest((d) => ({ ...d, name, id: (d.id === slugify(d.name) || d.id === 'new-card-event') ? slugify(name) : d.id }));
              }}
              placeholder="事件包名称"
              aria-label="事件包名称"
              title="点击修改事件包名称，保存后生效"
              style={{
                fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)', fontWeight: 600,
                color: 'var(--text-primary)', border: '1px solid transparent', background: 'transparent',
                borderRadius: 'var(--radius-sm)', padding: '2px 6px', minWidth: 0, maxWidth: 320,
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'transparent')}
            />
          </div>
          {/* 面包屑仅静态文字：事件 / 叙事卡片（事件改名入口已移至左侧「当前事件」区，不再出现在顶部） */}
          <nav aria-label="事件层级" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-xs)', lineHeight: 1.2, flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>事件</span>
            <span style={{ color: 'var(--text-muted)' }}>/</span>
            <span style={{ color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>叙事卡片</span>
          </nav>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {currentPackId ? `包 ID：${currentPackId}` : '新事件包 · 首次保存时创建'}
          </span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn-secondary btn-sm" onClick={() => setShowPreview(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Eye size={15} /> 预览</button>
          <button className="btn-secondary btn-sm" onClick={runValidate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={15} /> 校验</button>
          <button className="btn-primary btn-sm" onClick={() => void handleSaveEvent()} disabled={saving} title="保存当前事件及事件包元信息" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Save size={15} /> 保存事件包</button>
          <button className="btn-secondary btn-sm" onClick={handleExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Download size={15} /> 导出</button>
          <button
            className={mode === 'json' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => (mode === 'json' ? backToVisual() : enterJson())}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Braces size={15} /> {mode === 'json' ? '可视化' : '</> JSON'}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => setShowSettings((s) => !s)} aria-label="事件设置" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <Settings size={15} />
          </button>
        </div>
      </div>

      {/* 校验结果条 */}
      {issues.length > 0 && (
        <div style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--danger-bg-soft)', borderBottom: '1px solid var(--border)', fontSize: 'var(--font-size-sm)', color: 'var(--danger)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {issues.map((i, k) => (
            <div key={k} style={{ display: 'flex', gap: 6 }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{i.field ? `[${i.field}] ` : ''}{i.message}</span></div>
          ))}
        </div>
      )}
      {issues.length === 0 && mode === 'visual' && (
        <div style={{ padding: 'var(--space-1) var(--space-4)', fontSize: 'var(--font-size-xs)', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Check size={13} /> 校验通过
        </div>
      )}

      {/* 事件设置浮层 */}
      {showSettings && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)' }}>
          {([
            ['id', '事件 id', manifest.id, (v: string) => setManifest((d) => ({ ...d, id: v }))],
            ['version', '版本', manifest.version, (v: string) => setManifest((d) => ({ ...d, version: v }))],
            ['author', '作者', manifest.author, (v: string) => setManifest((d) => ({ ...d, author: v }))],
            ['icon', '图标名(Lucide)', manifest.icon, (v: string) => setManifest((d) => ({ ...d, icon: v }))],
          ] as Array<[string, string, string, (v: string) => void]>).map(([key, label, val, set]) => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
              {label}
              <input value={val} onChange={(e) => set(e.target.value)} style={inputStyle} />
              {key === 'id' && (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 4 }}>
                  包 ID：小写英文/数字/连字符，内部标识；填中文名称时会自动生成，也可手动修改。
                </span>
              )}
            </label>
          ))}
          {/* 事件名称改在顶栏面包屑内联编辑，避免与顶栏重复修改 */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            封面色（实色块，禁渐变）
            <input type="color" value={manifest.coverColor} onChange={(e) => setManifest((d) => ({ ...d, coverColor: e.target.value }))} style={{ width: '100%', height: 32, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            描述
            <textarea value={manifest.description} onChange={(e) => setManifest((d) => ({ ...d, description: e.target.value }))} rows={2} style={inputStyle} />
          </label>
        </div>
      )}

      {/* 主体 */}
      {mode === 'json' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--space-4)', gap: 'var(--space-3)', overflow: 'hidden' }}>
          {jsonError && (
            <div style={{ background: 'var(--danger-bg-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', color: 'var(--danger)', fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap' }}>
              {jsonError}
            </div>
          )}
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
            style={{ flex: 1, width: '100%', resize: 'none', fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-sm)', lineHeight: 1.6, color: jsonError ? 'var(--danger)' : 'var(--text-primary)', background: jsonError ? 'var(--danger-bg-soft)' : 'var(--bg-secondary)', border: `1px solid ${jsonError ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn-sm" onClick={() => setJsonText(JSON.stringify(toCardFile(blocks), null, 2))}>重置为画布</button>
            <button className="btn-primary btn-sm" onClick={backToVisual} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={15} /> 应用并返回可视化</button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 叙事卡片编辑区（周期事件已移至专门的「周期包」编辑，见 EventsScreen.periodic） */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr var(--right-panel-width)', overflow: 'hidden' }}>
          {/* 左栏：上=事件列表，下=组件库（不新增第 4 列，保持画布宽度） */}
          <div style={{ borderRight: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* 事件列表（上区，maxHeight 40%） */}
            <div style={{ maxHeight: '40%', overflow: 'auto', padding: 'var(--space-3)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>事件</span>
                <button className="btn-secondary btn-sm" onClick={() => void handleNewEvent()} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)' }}><Plus size={14} /> 新建事件</button>
              </div>
              {eventList.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-2)', textAlign: 'center' }}>
                  <Layers size={32} style={{ color: 'var(--text-muted)' }} />
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: 600 }}>这个事件包还没有事件</div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>事件包由多个事件组成，每个事件包含若干叙事卡片。先创建第一个事件吧。</div>
                  <button className="btn-primary btn-sm" onClick={() => void handleNewEvent()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 'var(--space-1)' }}><Plus size={14} /> 新建事件</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  {eventList.map((ev) => (
                    <EventRow
                      key={ev.id}
                      event={ev}
                      selected={ev.id === selectedEventId}
                      loading={eventsLoading && ev.id === selectedEventId}
                      disabled={saving || eventsLoading}
                      onSelect={() => void selectEvent(ev.id)}
                      onDelete={() => setDeleteTarget(ev.id)}
                      onRename={(name) => {
                        setEventName(name);
                        if (currentPackId) void renameEventInPack(currentPackId, ev.id, name).then(() => void refreshEventList());
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            {/* 组件库（下区） */}
            <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-3)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-2)' }}>组件库</div>
            {BLOCK_TYPES.map((t) => {
              const Icon = BLOCK_META[t].icon;
              return (
                <button
                  key={t}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/block-type', t)}
                  onClick={() => addBlock(t)}
                  style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left', padding: 'var(--space-2)', marginBottom: 'var(--space-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-primary)', cursor: 'grab', color: 'var(--text-primary)' }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-md)', fontWeight: 600 }}><Icon size={15} style={{ color: 'var(--accent)' }} /> {BLOCK_META[t].label}</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{BLOCK_META[t].desc}</span>
                </button>
              );
            })}
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>点击或拖拽到画布添加</div>
            </div>
          </div>

          {/* 画布 */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const t = e.dataTransfer.getData('text/block-type') as BlockType;
              if (t && BLOCK_TYPES.includes(t)) addBlock(t);
            }}
            style={{ overflow: 'auto', padding: 'var(--space-4)', background: 'var(--bg-primary)', backgroundImage: 'linear-gradient(var(--canvas-grid) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-grid) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          >
            {blocks.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>从左侧拖入组件开始编辑</div>
            ) : (
              blocks.map((b, i) => {
                const Icon = BLOCK_META[b.type].icon;
                const active = selected === b.id;
                return (
                  <div
                    key={b.id}
                    draggable
                    onDragStart={() => (dragIdx.current = i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdx.current !== null) reorder(dragIdx.current, i);
                      dragIdx.current = null;
                    }}
                    onClick={() => setSelected(b.id)}
                    style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)', borderRadius: 'var(--radius-lg)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-secondary)', boxShadow: active ? 'var(--shadow-glow)' : 'var(--shadow-xs)', cursor: 'pointer' }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{BLOCK_META[b.type].label}</div>
                      <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{blockTitle(b)}</div>
                      {b.props.worldbookRefs && b.props.worldbookRefs.length > 0 && (
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}><BookOpen size={12} /> 引用 {b.props.worldbookRefs.length} 条世界书</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); reorder(i, i - 1); }} disabled={i === 0} aria-label="上移" style={{ padding: 2 }}><ArrowUp size={14} /></button>
                      <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); reorder(i, i + 1); }} disabled={i === blocks.length - 1} aria-label="下移" style={{ padding: 2 }}><ArrowDown size={14} /></button>
                      <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); removeBlock(b.id); }} aria-label="删除" style={{ padding: 2, color: 'var(--danger)' }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 属性面板 */}
          <div style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', overflow: 'auto', padding: 'var(--space-3)' }}>
            {!selectedBlock ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', padding: 'var(--space-6)', textAlign: 'center' }}>选中一个卡片以编辑属性</div>
            ) : (
              <BlockProperties block={selectedBlock} onChange={updateSelected} onOpenWorldBook={() => { setWbTarget(selectedBlock.id); setWbOpen(true); }} gameState={gameState} />
            )}
          </div>
          </div>
        </div>
      )}

      {/* 底栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '6px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', flexShrink: 0 }}>
        <span>缩放 100%</span>
        <span>网格对齐 开</span>
        <span style={{ color: saved ? 'var(--success)' : 'var(--text-muted)' }}>{saved ? '● 已存库' : '○ 未保存'}</span>
        <span>周期事件 {periodicRules.length}</span>
        <span style={{ marginLeft: 'auto' }}>字数 {wordCount}</span>
      </div>

      {/* 预览浮层 */}
      {showPreview && (
        <div onClick={() => setShowPreview(false)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)' }}>
          <div className="event-fade-in" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 92vw)', maxHeight: '80vh', overflow: 'auto', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: 'var(--space-5)', color: 'var(--text-primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: manifest.coverColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textOn(manifest.coverColor || '#333') }}><FileText size={18} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontFamily: 'var(--font-display)' }}>{manifest.name}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>v{manifest.version} · {manifest.author}</div>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => setShowPreview(false)} aria-label="关闭"><X size={16} /></button>
            </div>
            {blocks.map((b) => (
              <div key={b.id} style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                {b.type === 'title' && <div style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)', color: 'var(--accent)' }}>{b.props.title}</div>}
                {b.type === 'narrative' && <div style={{ lineHeight: 1.7, fontSize: 'var(--font-size-base)' }}>{b.props.text}</div>}
                {b.type === 'choice' && (
                  <div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 4 }}>选择</div>
                    {(b.props.choices ?? []).map((c, i) => {
                      const opt = typeof c === 'string' ? { label: c } : c;
                      return (
                        <div key={i} style={{ padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', marginBottom: 4, background: 'var(--bg-primary)' }}>
                          · {opt.label}
                          {(opt.effect?.statId || opt.effect?.resourcePath) && (
                            <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                              （{opt.effect?.resourcePath ?? opt.effect?.statId} {opt.effect.delta >= 0 ? '+' : ''}{opt.effect.delta}）
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 世界书选择器 */}
      <WorldBookPicker
        open={wbOpen}
        entries={wbEntries}
        selectedIds={selectedBlock?.props.worldbookRefs ?? []}
        onConfirm={(ids) => {
          if (wbTarget) updateSelected({ worldbookRefs: ids });
          setWbOpen(false);
          setWbTarget(null);
        }}
        onClose={() => { setWbOpen(false); setWbTarget(null); }}
      />
      {saveToast && (
        <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 60, padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 'var(--font-size-sm)', boxShadow: 'var(--shadow-md)' }}>
          {saveToast}
        </div>
      )}

      {/* 删除事件二次确认模态（非原生 alert） */}
      {deleteTarget && (
        <div onClick={() => setDeleteTarget(null)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 92vw)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: 'var(--space-5)', color: 'var(--text-primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
              <div style={{ fontWeight: 600, fontFamily: 'var(--font-display)' }}>删除事件</div>
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              将删除事件「{eventList.find((e) => e.id === deleteTarget)?.name || '未命名事件'}」，此操作不可恢复。
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              <button className="btn-secondary btn-sm" onClick={() => setDeleteTarget(null)}>取消</button>
              <button onClick={() => void handleDeleteEvent(deleteTarget)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--danger)', background: 'var(--danger)', color: 'var(--color-on-accent)', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}><Trash2 size={14} /> 删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-body)',
};

function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 'var(--font-size-md)',
        fontWeight: 600,
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        padding: 'var(--space-2) var(--space-1)',
        borderRadius: 'var(--radius-md)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        marginBottom: '-1px',
        transition: 'color var(--duration-fast) var(--ease-out)',
      }}
    >
      {children}
    </button>
  );
}

/** 事件列表单条行（六态齐备：Default / Hover / Focus-visible / Active / Disabled / Loading）
 *  双击事件名进入重命名模式，Enter 确认，Escape 取消，失焦确认。 */
function EventRow({ event, selected, loading, disabled, onSelect, onDelete, onRename }: {
  event: EventListItem;
  selected: boolean;
  loading: boolean;
  disabled: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [active, setActive] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editName, setEditName] = useState(event.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = () => {
    setEditName(event.name);
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== event.name) onRename(trimmed);
    setRenaming(false);
  };

  const cancelRename = () => {
    setRenaming(false);
    setEditName(event.name);
  };

  const isDisabled = disabled || loading;
  const selStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    flex: 1,
    minWidth: 0,
    minHeight: 'var(--touch-min)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-md)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    fontSize: 'var(--font-size-md)',
    textAlign: 'left',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    pointerEvents: isDisabled ? 'none' : 'auto',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out)',
  };
  if (selected) {
    selStyle.background = 'var(--accent-dim)';
    selStyle.borderColor = 'var(--accent)';
    selStyle.color = 'var(--accent)';
  } else if (hovered) {
    selStyle.background = 'var(--bg-tertiary)';
  }
  if (active) {
    selStyle.background = 'var(--accent-dim)';
    selStyle.transform = 'scale(0.98)';
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
      <button
        type="button"
        disabled={isDisabled}
        aria-busy={loading || undefined}
        aria-current={selected ? 'true' : undefined}
        onClick={() => { if (!isDisabled && !renaming) onSelect(); }}
        onDoubleClick={(e) => { e.stopPropagation(); if (!isDisabled) startRename(); }}
        className="event-row-btn"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setActive(false); }}
        onMouseDown={() => setActive(true)}
        onMouseUp={() => setActive(false)}
        style={selStyle}
      >
        {loading ? (
          <Loader2 size={16} className="event-spin" style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
        ) : (
          <Layers size={16} style={{ flexShrink: 0, color: selected ? 'var(--accent)' : 'var(--text-secondary)' }} />
        )}
        {renaming ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); e.stopPropagation(); }}
            onBlur={() => commitRename()}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', padding: '1px 6px', outline: 'none' }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-display)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.name || '未命名事件'}
          </span>
        )}
        <span style={{ flexShrink: 0, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>
          {event.cardsLen} 卡片
        </span>
      </button>
      <button
        type="button"
        aria-label="删除事件"
        title="删除该事件"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, flexShrink: 0, borderRadius: 'var(--radius-md)', border: 'none', background: 'transparent', color: 'var(--danger)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1 }}
        onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--danger-bg-soft)'; }}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        onMouseDown={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--danger-bg-hover)'; }}
        onMouseUp={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--danger-bg-soft)'; }}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function BlockProperties({ block, onChange, onOpenWorldBook, gameState }: { block: CardBlock; onChange: (p: Partial<BlockProps>) => void; onOpenWorldBook: () => void; gameState?: GameState }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{BLOCK_META[block.type].label}属性</div>
      {block.type === 'title' && (
        <label style={fieldLabel}>标题<textarea value={block.props.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} rows={2} style={inputStyle} /></label>
      )}
      {block.type === 'narrative' && (
        <label style={fieldLabel}>正文<textarea value={block.props.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} rows={5} style={inputStyle} /></label>
      )}
      {block.type === 'choice' && (
        <div style={fieldLabel}>选项
          {(block.props.choices ?? []).map((c, i) => {
            const opt: ChoiceOption = typeof c === 'string' ? { label: c } : c;
            const effect: ChoiceEffect = opt.effect ?? { statId: '', delta: 0 };
            return (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 8, marginBottom: 8, background: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    value={opt.label}
                    placeholder="选项标题"
                    onChange={(e) => {
                      const next = [...(block.props.choices ?? [])];
                      next[i] = { ...opt, label: e.target.value };
                      onChange({ choices: next });
                    }}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button className="btn-ghost btn-sm" onClick={() => onChange({ choices: (block.props.choices ?? []).filter((_, j) => j !== i) })} aria-label="删除选项" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 6, marginBottom: 6 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                    属性 id
                    <StatIdSelect
                      value={effect.statId ?? ''}
                      gameState={gameState}
                      onChange={(v) => {
                        const next = [...(block.props.choices ?? [])];
                        next[i] = { ...opt, effect: { ...effect, statId: v } };
                        onChange({ choices: next });
                      }}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                    变动值
                    <input
                      type="number"
                      value={effect.delta ?? 0}
                      onChange={(e) => {
                        const next = [...(block.props.choices ?? [])];
                        next[i] = { ...opt, effect: { ...effect, delta: Number(e.target.value) } };
                        onChange({ choices: next });
                      }}
                      style={inputStyle}
                    />
                  </label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 6 }}>
                  资源路径（与属性 id 二选一）
                  <input
                    value={effect.resourcePath ?? ''}
                    placeholder="生存资源.食物 / 经营资产.资金 / 货币资源.主货币"
                    onChange={(e) => {
                      const next = [...(block.props.choices ?? [])];
                      next[i] = { ...opt, effect: { ...effect, resourcePath: e.target.value } };
                      onChange({ choices: next });
                    }}
                    style={inputStyle}
                  />
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                    资源为世界自定义键；当前世界无此资源时自动跳过（变动值必填）。
                  </span>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                  AI 决策备注（aiNote，喂给下一轮叙事）
                  <textarea
                    value={opt.aiNote ?? ''}
                    rows={2}
                    placeholder="如：玩家选择了激进路线"
                    onChange={(e) => {
                      const next = [...(block.props.choices ?? [])];
                      next[i] = { ...opt, aiNote: e.target.value };
                      onChange({ choices: next });
                    }}
                    style={inputStyle}
                  />
                </label>
              </div>
            );
          })}
          <button className="btn-secondary btn-sm" onClick={() => onChange({ choices: [...(block.props.choices ?? []), { label: '新选项' }] })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> 添加选项</button>
        </div>
      )}
      <button className="btn-secondary btn-sm" onClick={onOpenWorldBook} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}><BookOpen size={15} /> 世界书引用（{(block.props.worldbookRefs ?? []).length}）</button>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 'var(--font-size-xs)',
  color: 'var(--text-secondary)',
};
