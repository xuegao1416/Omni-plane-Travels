// ============================================================
//  卡片编辑器 v2 — 节点式工作流画布
//  遵循项目模式：EventsScreen 创建包并传入 eventPackId，
//  CardEditor 只负责编辑事件内容。
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { useIsPhone } from '../../hooks/useIsMobile';
import {
  ArrowLeft, Save, Download, Trash2, Plus, Settings, BookOpen,
  Layers, Loader2, Lock, Check, AlertTriangle, LayoutDashboard,
} from 'lucide-react';
import JSZip from 'jszip';
import type {
  CardWorkflowDefinition, Manifest, ValidationIssue, EventPackType,
  PeriodicRule, EventDef, EventPackFile,
} from '../../modules/schema';
import type { GameState } from '../../schema/variables';
import { getAllWorldBookEntries, WorldBookPicker } from './WorldBookPicker';
import { getWebEvent, putWebEvent } from '../../modules/eventDb';
import { saveEventToPack, listEventsInPack, savePackMeta, deleteEventFromPack } from '../../modules/webEventStore';
import { findWorldDef, getAllWorlds } from '../../data/worldLoader';
import type { WorldDef } from '../../data/worlds-schema';
import CardWorkflowEditor from '../card-workflow/CardWorkflowEditor';
import CardNodePalette from '../card-workflow/CardNodePalette';

const APP_VERSION = '2.7.0';

function newEventId(): string {
  return `evt-${Math.random().toString(36).slice(2, 8)}`;
}

export function validateCardWorkflow(wf: CardWorkflowDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // 空工作流允许保存（新建事件时是空的）
  if (!wf.nodes || wf.nodes.length === 0) return issues;
  // 有节点时才校验
  const hasNarrative = wf.nodes.some((n) => n.typeId.startsWith('narrative.'));
  if (!hasNarrative) {
    issues.push({ code: 'MISSING_FIELD', field: 'nodes', message: '工作流至少需要一个叙事节点' });
  }
  return issues;
}

function computePackType(pack: EventPackFile): EventPackType {
  const hasCards = pack.events.some((e) => e.cards && e.cards.length > 0);
  const hasPeriodic = (pack.periodicRules ?? []).length > 0;
  if (hasCards && hasPeriodic) return 'bundle';
  if (hasPeriodic) return 'rule';
  return 'card';
}

interface ManifestDraft {
  name: string;
  description: string;
  author: string;
  version: string;
  coverColor: string;
  icon: string;
}

function emptyManifest(): ManifestDraft {
  return { name: '', description: '', author: '', version: '1.0.0', coverColor: '#3b82f6', icon: 'FileText' };
}

interface EventListEntry {
  id: string;
  name: string;
}

// ─── 主组件 ───

export interface CardEditorProps {
  eventPackId: string;
  onBack: () => void;
  gameState?: GameState;
  onSaved?: () => void;
  worldDef?: WorldDef;
}

export default function CardEditor({ eventPackId, onBack, gameState, onSaved, worldDef: worldDefProp }: CardEditorProps) {
  const isPhone = useIsPhone();

  // 当前编辑的事件工作流（每个事件独立）
  const [workflow, setWorkflow] = useState<CardWorkflowDefinition | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventName, setEventName] = useState('未命名事件');

  // 包状态
  const [manifest, setManifest] = useState<ManifestDraft>(emptyManifest());
  const [periodicRules] = useState<PeriodicRule[]>([]);
  const [eventList, setEventList] = useState<EventListEntry[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // UI 状态
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  const [wbOpen, setWbOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [worldBound, setWorldBound] = useState(false);
  const [localWorldDef, setLocalWorldDef] = useState<WorldDef | undefined>(worldDefProp);

  const worldDef = worldDefProp ?? localWorldDef;

  // ── 加载事件包 ──
  useEffect(() => {
    (async () => {
      const rec = await getWebEvent(eventPackId).catch(() => undefined);
      if (!rec) return;

      setManifest({
        name: rec.manifest?.name ?? '',
        description: rec.manifest?.description ?? '',
        author: rec.manifest?.author ?? '',
        version: rec.manifest?.version ?? '1.0.0',
        coverColor: rec.manifest?.coverColor ?? '#3b82f6',
        icon: rec.manifest?.icon ?? 'FileText',
      });

      // 加载事件列表
      const eventsRaw = rec.files['schema/events.json'];
      if (typeof eventsRaw === 'string') {
        const pack = JSON.parse(eventsRaw) as EventPackFile;
        setEventList(pack.events.map((e) => ({ id: e.id, name: e.name })));
        if (pack.events.length > 0) {
          const first = pack.events[0];
          setSelectedEventId(first.id);
          setEventName(first.name);
          setEditingEventId(first.id);
          loadEventWorkflow(eventPackId, first.id);
        }
      }

      if (rec.manifest?.worldId) {
        const wd = findWorldDef(rec.manifest.worldId);
        if (wd) { setLocalWorldDef(wd); setWorldBound(true); }
      }
    })();
  }, [eventPackId]);

  // ── 加载事件工作流 ──
  const loadEventWorkflow = useCallback(async (packId: string, eventId: string) => {
    const rec = await getWebEvent(packId).catch(() => undefined);
    if (!rec) {
      setWorkflow({ version: 1, id: `card-wf-${Date.now().toString(36)}`, name: '', nodes: [], connections: [] });
      return;
    }

    const canvasRaw = rec.files[`schema/event-${eventId}.json`];
    if (typeof canvasRaw === 'string') {
      try {
        const parsed = JSON.parse(canvasRaw);
        // 只接受新格式（有 nodes 数组）
        if (parsed.nodes && Array.isArray(parsed.nodes)) {
          setWorkflow(parsed as CardWorkflowDefinition);
          return;
        }
        // 旧格式（CardFile/puck）→ 忽略，创建空工作流
      } catch { /* fallthrough */ }
    }

    // 没有工作流数据或旧格式，创建空工作流
    setWorkflow({ version: 1, id: `card-wf-${Date.now().toString(36)}`, name: '', nodes: [], connections: [] });
  }, []);

  // ── 辅助函数（无依赖） ──

  const showSaveToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const refreshEventList = useCallback(async () => {
    const list = await listEventsInPack(eventPackId);
    setEventList(list.map((e) => ({ id: e.id, name: e.name })));
  }, [eventPackId]);

  const persistPackType = useCallback(async (type: EventPackType) => {
    try {
      const rec = await getWebEvent(eventPackId);
      if (rec) {
        rec.manifest = { ...rec.manifest, type } as Manifest;
        await putWebEvent(rec);
      }
    } catch (e) {
      console.error('[CardEditor] persistPackType 失败：', e);
    }
  }, [eventPackId]);

  // ── 保存当前事件（依赖 showSaveToast, persistPackType） ──
  const handleSaveEvent = useCallback(async (): Promise<boolean> => {
    if (!workflow || !editingEventId) return false;

    const wfWithName = { ...workflow, name: eventName };
    const errs = validateCardWorkflow(wfWithName);
    if (errs.length > 0) {
      setIssues(errs);
      showSaveToast('校验未通过，请先修正卡片内容');
      return false;
    }

    const eventDef: EventDef = { id: editingEventId, name: eventName, cards: [] };
    setSaving(true);
    try {
      await saveEventToPack(eventPackId, eventDef, { cardWorkflow: wfWithName, periodicRules });
      await persistPackType(computePackType({ version: 1, events: [eventDef], periodicRules }));
      await savePackMeta(eventPackId, {
        name: manifest.name,
        description: manifest.description,
        author: manifest.author,
        version: manifest.version,
        coverColor: manifest.coverColor,
        icon: manifest.icon,
      });
      setSaved(true);
      await refreshEventList();
      showSaveToast('已保存');
      onSaved?.();
      return true;
    } catch (e) {
      showSaveToast('保存失败：' + (e instanceof Error ? e.message : String(e)));
      return false;
    } finally {
      setSaving(false);
    }
  }, [workflow, editingEventId, eventName, eventPackId, manifest, periodicRules, onSaved, showSaveToast, persistPackType, refreshEventList]);

  // ── 切换事件（依赖 handleSaveEvent） ──
  const handleSelectEvent = useCallback(async (eventId: string) => {
    if (eventId === selectedEventId) return;

    // 先保存当前事件
    if (!saved && editingEventId && workflow) {
      await handleSaveEvent();
    }

    // 切换到新事件
    setSelectedEventId(eventId);
    setEditingEventId(eventId);
    const entry = eventList.find((e) => e.id === eventId);
    if (entry) setEventName(entry.name);
    await loadEventWorkflow(eventPackId, eventId);
    setSaved(true);
    setIssues([]);
  }, [selectedEventId, saved, editingEventId, workflow, eventList, eventPackId, loadEventWorkflow, handleSaveEvent]);

  // ── 新建事件（依赖 handleSaveEvent, refreshEventList, showSaveToast） ──
  const handleNewEvent = useCallback(async () => {
    // 先保存当前事件
    if (!saved && editingEventId && workflow) {
      await handleSaveEvent();
    }

    const newId = newEventId();
    const newName = '未命名事件';

    // 创建新的空工作流
    const newWorkflow: CardWorkflowDefinition = {
      version: 1,
      id: `card-wf-${Date.now().toString(36)}`,
      name: newName,
      nodes: [],
      connections: [],
    };

    // 立即落盘：保存空工作流 + 更新事件索引
    try {
      const eventDef: EventDef = { id: newId, name: newName, cards: [] };
      await saveEventToPack(eventPackId, eventDef, { cardWorkflow: newWorkflow });
      await refreshEventList();
    } catch (e) {
      console.error('[CardEditor] 新建事件落盘失败:', e);
      showSaveToast('新建事件失败');
      return;
    }

    // 切换到新事件
    setSelectedEventId(newId);
    setEditingEventId(newId);
    setEventName(newName);
    setWorkflow(newWorkflow);
    setSaved(true);
    setIssues([]);
  }, [saved, editingEventId, workflow, eventPackId, handleSaveEvent, refreshEventList, showSaveToast]);

  const handleExport = useCallback(async () => {
    const rec = await getWebEvent(eventPackId).catch(() => undefined);
    if (!rec) return;
    const zip = new JSZip();
    for (const [key, val] of Object.entries(rec.files)) {
      if (typeof val === 'string') zip.file(key, val);
    }
    zip.file('manifest.json', JSON.stringify(rec.manifest, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${manifest.name || 'event'}.opt-event`;
    a.click();
    URL.revokeObjectURL(url);
  }, [eventPackId, manifest.name]);

  const handleDeleteEvent = useCallback(async (eventId: string) => {
    await deleteEventFromPack(eventPackId, eventId);
    await refreshEventList();
    if (selectedEventId === eventId) {
      setSelectedEventId(null);
      setWorkflow(null);
      setEditingEventId(null);
    }
  }, [eventPackId, selectedEventId, refreshEventList]);

  const handleBindWorld = useCallback(async (worldId: string) => {
    const wd = findWorldDef(worldId);
    if (!wd) return;
    const rec = await getWebEvent(eventPackId);
    if (!rec) return;
    rec.manifest = { ...rec.manifest, worldId } as Manifest;
    await putWebEvent(rec);
    setLocalWorldDef(wd);
    setWorldBound(true);
  }, [eventPackId]);

  // ── 节点面板添加节点 ──
  const handleAddNode = useCallback((typeId: string) => {
    const editor = (window as unknown as Record<string, unknown>).__cardWorkflowEditor as { addNode?: (t: string) => void } | undefined;
    editor?.addNode?.(typeId);
  }, []);

  // ── 删除选中节点 ──
  const handleDeleteSelected = useCallback(() => {
    const editor = (window as unknown as Record<string, unknown>).__cardWorkflowEditor as { deleteSelected?: () => void } | undefined;
    editor?.deleteSelected?.();
  }, []);

  // ── 自动布局 ──
  const handleAutoLayout = useCallback(() => {
    const editor = (window as unknown as Record<string, unknown>).__cardWorkflowEditor as { handleAutoLayout?: () => void } | undefined;
    editor?.handleAutoLayout?.();
  }, []);

  // ── 渲染 ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* 顶部工具栏 */}
      <div style={{
        padding: 'var(--space-2) var(--space-3)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      }}>
        <button onClick={onBack} className="btn-ghost btn-sm" title="返回"><ArrowLeft size={16} /></button>
        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{manifest.name || '未命名事件包'}</span>

        {issues.length > 0 && (
          <span style={{ color: 'var(--danger)', fontSize: 'var(--font-size-xs)', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
            <AlertTriangle size={14} /> {issues.length}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <button onClick={handleSaveEvent} className="btn-primary btn-sm" disabled={saving || saved} title="保存">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {!isPhone && (saved ? '已保存' : '保存')}
          </button>
          <button onClick={handleDeleteSelected} className="btn-ghost btn-sm" title="删除选中节点" style={{ color: 'var(--danger)' }}>
            <Trash2 size={14} />
          </button>
          <button onClick={handleAutoLayout} className="btn-ghost btn-sm" title="整理布局">
            <LayoutDashboard size={14} /> {!isPhone && '整理'}
          </button>
          <button onClick={() => setShowPalette(!showPalette)} className="btn-ghost btn-sm" title="节点面板">
            <Plus size={14} />
          </button>
          <button onClick={handleExport} className="btn-ghost btn-sm" title="导出">
            <Download size={14} />
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className="btn-ghost btn-sm" title="设置">
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* 主体：事件列表 + 节点面板 + 画布 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 事件列表 */}
        <div style={{
          width: isPhone ? 48 : 180,
          borderRight: '1px solid var(--border)',
          overflow: 'auto',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--border)' }}>
            <button onClick={handleNewEvent} className="btn-secondary btn-sm" style={{ width: '100%' }}>
              <Plus size={14} /> {!isPhone && '新事件'}
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {eventList.map((entry) => (
              <div
                key={entry.id}
                onClick={() => handleSelectEvent(entry.id)}
                style={{
                  padding: isPhone ? 'var(--space-2)' : 'var(--space-2) var(--space-3)',
                  cursor: 'pointer',
                  background: selectedEventId === entry.id ? 'var(--bg-active)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                }}
              >
                <Layers size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                {!isPhone && (
                  <>
                    <span style={{ flex: 1, fontSize: 'var(--font-size-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.name}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteEvent(entry.id); }}
                      className="btn-ghost btn-sm"
                      style={{ color: 'var(--danger)', padding: 2 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 节点面板 */}
        {showPalette && <CardNodePalette onAddNode={handleAddNode} />}

        {/* 画布区域 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 事件名 */}
          <div style={{
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            background: 'var(--bg-secondary)',
          }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>事件:</span>
            <input
              type="text"
              value={eventName}
              onChange={(e) => { setEventName(e.target.value); setSaved(false); }}
              style={{ flex: 1, padding: '2px 6px', fontSize: 'var(--font-size-sm)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)' }}
            />
            {worldBound && worldDef && (
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Lock size={12} /> {worldDef.name}
              </span>
            )}
          </div>

          {/* 工作流画布 */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {workflow ? (
              <CardWorkflowEditor
                workflow={workflow}
                onChange={(wf) => { setWorkflow(wf); setSaved(false); }}
                gameState={gameState as unknown as Record<string, unknown>}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                点击左侧「新事件」创建
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 300,
          background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border)',
          overflow: 'auto', zIndex: 20, boxShadow: 'var(--shadow-lg)',
        }}>
          <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>事件包设置</span>
            <button onClick={() => setShowSettings(false)} className="btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>×</button>
          </div>
          <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
              名称
              <input value={manifest.name} onChange={(e) => setManifest({ ...manifest, name: e.target.value })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }} />
            </label>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
              描述
              <textarea value={manifest.description} onChange={(e) => setManifest({ ...manifest, description: e.target.value })} rows={3} style={{ width: '100%', padding: '4px 8px', marginTop: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }} />
            </label>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
              作者
              <input value={manifest.author} onChange={(e) => setManifest({ ...manifest, author: e.target.value })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }} />
            </label>
            {!worldBound && (
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 4 }}>绑定世界</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {getAllWorlds().map((w) => (
                    <button key={w.id} onClick={() => handleBindWorld(w.id)} className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }}>
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button onClick={() => setWbOpen(true)} className="btn-ghost btn-sm">
              <BookOpen size={14} /> 世界书引用
            </button>
          </div>
        </div>
      )}

      {wbOpen && (
        <WorldBookPicker open={wbOpen} entries={getAllWorldBookEntries()} onConfirm={() => setWbOpen(false)} onClose={() => setWbOpen(false)} />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: '8px 16px',
          boxShadow: 'var(--shadow-lg)', zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 'var(--font-size-sm)',
        }}>
          <Check size={14} style={{ color: 'var(--success)' }} />
          {toast}
        </div>
      )}
    </div>
  );
}
