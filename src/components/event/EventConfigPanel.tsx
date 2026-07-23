// ============================================================
// 游戏内「事件」配置面板（作为 GameScreen 的 overlay 打开）。
//   - 列出事件中心已全局启用的事件包（按 type 分组）
//   - 每个事件包开关 = 本局二级开关（只控制本局是否使用，不改全局状态）
//   - 导入 .opt-event / 导出已启用事件包
//   - 事件包提供「预览」按钮（折叠列表看事件和卡片）
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Package, FileText, Zap, BookOpen, Boxes, Upload, Download, Eye,
} from 'lucide-react';
import * as eventApi from '../../modules/eventApi';
import { useSaveStore } from '../../stores/saveStore';
import { getWebEvent, allWebEvents } from '../../modules/eventDb';
import { eventWorldEvolution } from '../../modules/eventIntegration';
import type { EventPackType, EventRegistryEntry, Collection } from '../../modules/schema';
import EventPackPreview from './EventPackPreview';
import type { WorldDef } from '../../data/worlds-schema';
import EventSwitch from './EventSwitch';
import { textOn } from './colorUtils';
import { useIsPhone } from '../../hooks/useIsMobile';

const TYPE_META: Record<string, { label: string; icon: typeof Package }> = {
  card: { label: '事件包', icon: FileText },
  rule: { label: '规则', icon: Zap },
  worldbook: { label: '世界书', icon: BookOpen },
  bundle: { label: '合集', icon: Boxes },
};

const TYPE_ORDER: EventPackType[] = ['card', 'rule', 'worldbook', 'bundle'];

export default function EventConfigPanel({
  onClose,
  worldDef,
}: {
  onClose: () => void;
  worldDef?: WorldDef | null;
}) {
  const [packs, setPacks] = useState<EventRegistryEntry[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [previewPackId, setPreviewPackId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isPhone = useIsPhone();

  // sessionActivePacks: undefined = 全部用全局列表；[] 或具体列表 = 按列表来
  const sessionActivePacks = useSaveStore(s => s.sessionActivePacks);
  const setSessionActivePacks = useSaveStore(s => s.setSessionActivePacks);

  // 计算本局实际激活的 id 集合
  const globalEnabledIds = useMemo(() => new Set(packs.map(m => m.meta.id)), [packs]);
  const activeIds = useMemo(() => {
    if (sessionActivePacks === undefined) return globalEnabledIds; // 未手动切换过 → 用全局
    return new Set(sessionActivePacks); // 手动切换过 → 用本局列表
  }, [sessionActivePacks, globalEnabledIds]);

  const refresh = async () => {
    try {
      const list = await eventApi.listPacks(true);
      // 只显示全局已启用的包（总开关）
      const enabled = list.filter(e => e.enabled);
      // 预加载 worldId：批量读取 WebEventRecord，构建 id→worldId 映射
      // 优先取 WebEventRecord.worldId，回退到 manifest.worldId
      const allRecs = await allWebEvents();
      const worldIdMap = new Map(allRecs.map(r => [r.id, r.worldId ?? r.manifest.worldId]));
      // 所有包必须 worldId === worldDef.id 才显示（防止跨世界污染）
      const filtered = enabled.filter(e => {
        if (!worldDef) return true; // 无世界上下文时不过滤
        const wId = worldIdMap.get(e.meta.id);
        if (!wId) return true; // 无 worldId 的全局包正常显示
        return wId === worldDef.id; // 有 worldId 的包必须匹配当前世界
      });
      setPacks(filtered);
      // 加载合集列表
      const cols = await eventApi.listCollections();
      setCollections(cols);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // 合集成员 id 集合（用于区分独立包 vs 合集内包）
  const collectionMemberIds = useMemo(() => {
    const s = new Set<string>();
    for (const col of collections) {
      for (const mid of col.memberIds) s.add(mid);
    }
    return s;
  }, [collections]);

  // 独立包（不属于任何合集）按 TYPE_ORDER 分组
  const standaloneGrouped = useMemo(() => {
    const m = new Map<EventPackType, EventRegistryEntry[]>();
    for (const t of TYPE_ORDER) m.set(t, []);
    for (const e of packs) {
      if (collectionMemberIds.has(e.meta.id)) continue; // 合集成员单独处理
      const t = e.meta.type;
      if (!m.has(t)) m.set(t, []);
      m.get(t)!.push(e);
    }
    return m;
  }, [packs, collectionMemberIds]);

  // 合集 → 成员列表映射（仅包含当前已启用且可见的包）
  const collectionMembersMap = useMemo(() => {
    const m = new Map<string, EventRegistryEntry[]>();
    const packMap = new Map(packs.map(e => [e.meta.id, e]));
    for (const col of collections) {
      const members = col.memberIds
        .map(mid => packMap.get(mid))
        .filter((e): e is EventRegistryEntry => !!e);
      m.set(col.id, members);
    }
    return m;
  }, [packs, collections]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // 二级开关：只控制本局，不改全局 rec.enabled
  const toggle = (id: string, on: boolean) => {
    if (sessionActivePacks === undefined) {
      // 首次切换：用当前全局列表作为基础，然后加/减
      const base = [...globalEnabledIds];
      if (!on) {
        setSessionActivePacks(base.filter(x => x !== id));
      }
      // 开的情况：已经在全局列表里了，不需要额外操作
    } else {
      if (on && !sessionActivePacks.includes(id)) {
        setSessionActivePacks([...sessionActivePacks, id]);
      } else if (!on) {
        setSessionActivePacks(sessionActivePacks.filter(x => x !== id));
      }
    }
    // 立即注册/注销到 eventWorldEvolution（本局即时生效）
    if (on) {
      // 注册：读包内容并注册（异步，但不阻塞 UI）
      getWebEvent(id).then(rec => {
        if (!rec) return;
        const rules: any[] = [];
        const periodicRules: any[] = [];
        let workflow: import('../../modules/workflowSchema').WorkflowDefinition | undefined;
        // 优先读工作流格式
        const wfRaw = rec.files['schema/workflow.json'];
        if (typeof wfRaw === 'string') {
          try { workflow = JSON.parse(wfRaw); } catch { /* 损坏 */ }
        }
        // 回退读规则格式
        if (!workflow) {
          const raw = rec.files['schema/rules.json'];
          if (typeof raw === 'string') {
            const rf = JSON.parse(raw);
            if (rf.rules) rules.push(...rf.rules);
            if (rf.periodicRules) periodicRules.push(...rf.periodicRules);
          }
        }
        eventWorldEvolution.registerPack({
          eventPackId: id, rules, periodicRules, workflow,
          permissions: rec.manifest.permissions ?? [],
          runtime: { onceFired: {}, cooldownRemaining: {} },
          source: rec.builtin ? 'world' : 'user',
        });
      }).catch(() => {});
    } else {
      eventWorldEvolution.unregisterPack(id);
    }
  };

  // 合集总开关：批量开关成员的 sessionActivePacks
  const toggleCollection = (memberIds: string[], on: boolean) => {
    for (const mid of memberIds) {
      toggle(mid, on);
    }
  };

  const handleImport = async (file: File) => {
    try {
      const meta = await eventApi.importPack({ file });
      if (meta) {
        showToast(`已导入：${meta.name}`);
        await refresh();
      }
    } catch (e) {
      showToast('导入失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleExport = async () => {
    const enabledList = packs.filter(m => m.enabled);
    if (enabledList.length === 0) {
      showToast('当前没有已启用的事件包');
      return;
    }
    for (const m of enabledList) {
      try {
        await eventApi.exportPack(m.meta.id);
      } catch {
        /* 单个失败不影响其它 */
      }
    }
    showToast(`已导出 ${enabledList.length} 个已启用事件包`);
  };

  const handlePreview = (eventPackId: string) => {
    setPreviewPackId(eventPackId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: isPhone ? 44 : undefined, flex: isPhone ? '1 1 auto' : undefined }}>
          <Upload size={15} /> 导入 .opt-event
        </button>
        <button className="btn-secondary btn-sm" onClick={handleExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: isPhone ? 44 : undefined, flex: isPhone ? '1 1 auto' : undefined }}>
          <Download size={15} /> 导出已启用
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".opt-event,.zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImport(f);
            e.target.value = '';
          }}
        />
      </div>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>加载中…</div>}
      {!loading && packs.length === 0 && collections.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
          事件中心暂无已装事件包。可在「事件中心」页面创建/导入卡片或规则事件包。
        </div>
      )}

      {/* ── 合集分组 ── */}
      {collections.map((col) => {
        const members = collectionMembersMap.get(col.id) ?? [];
        if (members.length === 0) return null;
        const allActive = members.every(m => activeIds.has(m.meta.id));
        const ColIcon = Boxes;
        return (
          <div key={col.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <ColIcon size={14} style={{ color: col.coverColor || 'var(--accent)' }} /> {col.name}
              <div style={{ flex: 1 }} />
              <EventSwitch checked={allActive} onChange={(v) => toggleCollection(col.memberIds, v)} label={allActive ? '全部启用' : '全部禁用'} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {members.map((e) => {
                const Icon = TYPE_META[e.meta.type]?.icon ?? Package;
                return (
                  <div key={e.meta.id} style={{ padding: isPhone ? 'var(--space-3)' : 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? 'var(--space-2)' : 'var(--space-3)' }}>
                      <span style={{ width: isPhone ? 36 : 28, height: isPhone ? 36 : 28, borderRadius: 'var(--radius-md)', background: e.meta.coverColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textOn(e.meta.coverColor || '#333'), flexShrink: 0 }}>
                        <Icon size={isPhone ? 18 : 15} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>{e.meta.name}</div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>v{e.meta.version}{!isPhone && ` · ${e.meta.id}`}</div>
                      </div>
                      {e.meta.type === 'card' && (
                        <button className="btn-ghost btn-sm" onClick={() => void handlePreview(e.meta.id)} aria-label="预览卡" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: isPhone ? 44 : undefined, minHeight: isPhone ? 44 : undefined, padding: isPhone ? '8px' : undefined }}>
                          <Eye size={isPhone ? 18 : 14} />{!isPhone && ' 预览'}
                        </button>
                      )}
                      <EventSwitch checked={activeIds.has(e.meta.id)} onChange={(v) => toggle(e.meta.id, v)} label={activeIds.has(e.meta.id) ? '本局启用' : '本局禁用'} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ── 独立包按类型分组 ── */}
      {TYPE_ORDER.map((t) => {
        const list = standaloneGrouped.get(t) ?? [];
        if (list.length === 0) return null;
        const Icon = TYPE_META[t].icon;
        return (
          <div key={t}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <Icon size={14} style={{ color: 'var(--accent)' }} /> {TYPE_META[t].label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {list.map((e) => (
                <div key={e.meta.id} style={{ padding: isPhone ? 'var(--space-3)' : 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? 'var(--space-2)' : 'var(--space-3)' }}>
                    <span style={{ width: isPhone ? 36 : 28, height: isPhone ? 36 : 28, borderRadius: 'var(--radius-md)', background: e.meta.coverColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textOn(e.meta.coverColor || '#333'), flexShrink: 0 }}>
                      <Icon size={isPhone ? 18 : 15} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>{e.meta.name}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>v{e.meta.version}{!isPhone && ` · ${e.meta.id}`}</div>
                    </div>
                    {t === 'card' && (
                      <button className="btn-ghost btn-sm" onClick={() => void handlePreview(e.meta.id)} aria-label="预览卡" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: isPhone ? 44 : undefined, minHeight: isPhone ? 44 : undefined, padding: isPhone ? '8px' : undefined }}>
                        <Eye size={isPhone ? 18 : 14} />{!isPhone && ' 预览'}
                      </button>
                    )}
                    <EventSwitch checked={activeIds.has(e.meta.id)} onChange={(v) => toggle(e.meta.id, v)} label={activeIds.has(e.meta.id) ? '本局启用' : '本局禁用'} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {toast && (
        <div style={{ position: 'sticky', bottom: 0, padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--accent-dim)', color: 'var(--accent)', fontSize: 'var(--font-size-sm)' }}>
          {toast}
        </div>
      )}

      {previewPackId && (
        <EventPackPreview eventPackId={previewPackId} onClose={() => setPreviewPackId(null)} />
      )}
    </div>
  );
}
