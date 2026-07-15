// ============================================================
// 游戏内「事件」配置面板（作为 GameScreen 的 overlay 打开）。
//   - 列出事件中心已全局启用的事件包（按 type 分组）
//   - 每个事件包开关 = 本局二级开关（只控制本局是否使用，不改全局状态）
//   - 导入 .opt-event / 导出已启用事件包
//   - 事件包提供「预览」按钮（折叠列表看事件和卡片）
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Package, FileText, Zap, BookOpen, Boxes, Repeat, Upload, Download, Eye, Plus,
} from 'lucide-react';
import * as eventApi from '../../modules/eventApi';
import { useSaveStore } from '../../stores/saveStore';
import { getWebEvent, putWebEvent, type WebEventRecord } from '../../modules/eventDb';
import { eventWorldEvolution } from '../../modules/eventIntegration';
import type { EventType, EventRegistryEntry, PeriodicRule, RuleFile, Manifest } from '../../modules/schema';
import EventPackPreview from './EventPackPreview';
import type { WorldDef } from '../../data/worlds-schema';
import PeriodicEventPackEditor from './PeriodicEventPackEditor';
import EventSwitch from './EventSwitch';
import { textOn } from './colorUtils';

const TYPE_META: Record<EventType, { label: string; icon: typeof Package }> = {
  card: { label: '事件包', icon: FileText },
  rule: { label: '规则包', icon: Zap },
  worldbook: { label: '世界书', icon: BookOpen },
  bundle: { label: '合集', icon: Boxes },
  periodic: { label: '周期包', icon: Repeat },
};

const TYPE_ORDER: EventType[] = ['card', 'rule', 'worldbook', 'bundle', 'periodic'];

export default function EventConfigPanel({
  onClose,
  worldDef,
}: {
  onClose: () => void;
  worldDef?: WorldDef | null;
}) {
  const [mods, setMods] = useState<EventRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [previewPackId, setPreviewPackId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [periodicRulesById, setPeriodicRulesById] = useState<Record<string, PeriodicRule[]>>({});

  // sessionActivePacks: undefined = 全部用全局列表；[] 或具体列表 = 按列表来
  const sessionActivePacks = useSaveStore(s => s.sessionActivePacks);
  const setSessionActivePacks = useSaveStore(s => s.setSessionActivePacks);

  // 计算本局实际激活的 id 集合
  const globalEnabledIds = useMemo(() => new Set(mods.map(m => m.meta.id)), [mods]);
  const activeIds = useMemo(() => {
    if (sessionActivePacks === undefined) return globalEnabledIds; // 未手动切换过 → 用全局
    return new Set(sessionActivePacks); // 手动切换过 → 用本局列表
  }, [sessionActivePacks, globalEnabledIds]);

  const refresh = async () => {
    try {
      const list = await eventApi.listMods(true);
      // 只显示全局已启用的包（总开关）
      setMods(list.filter(e => e.enabled));
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<EventType, EventRegistryEntry[]>();
    for (const t of TYPE_ORDER) m.set(t, []);
    for (const e of mods) {
      const t = e.meta.type;
      if (!m.has(t)) m.set(t, []);
      m.get(t)!.push(e);
    }
    return m;
  }, [mods]);

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
        const raw = rec.files['schema/rules.json'];
        if (typeof raw === 'string') {
          const rf = JSON.parse(raw);
          if (rf.rules) rules.push(...rf.rules);
          if (rf.periodicRules) periodicRules.push(...rf.periodicRules);
        }
        eventWorldEvolution.register({
          eventPackId: id, rules, periodicRules,
          permissions: rec.manifest.permissions ?? [],
          runtime: { onceFired: {}, cooldownRemaining: {} },
          source: rec.builtin ? 'world' : 'mod',
        });
      }).catch(() => {});
    } else {
      eventWorldEvolution.unregister(id);
    }
  };

  // ── 周期事件包：内联读取 / 创建 / 保存（复用 PeriodicEventPackEditor，不另建编辑器） ──
  useEffect(() => {
    const periodicList = grouped.get('periodic') ?? [];
    if (periodicList.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, PeriodicRule[]> = {};
      for (const e of periodicList) {
        try {
          const rec = await getWebEvent(e.meta.id);
          const raw = rec?.files['schema/rules.json'];
          if (typeof raw === 'string') {
            const rf = JSON.parse(raw) as RuleFile;
            next[e.meta.id] = rf.periodicRules ?? [];
          } else {
            next[e.meta.id] = [];
          }
        } catch {
          next[e.meta.id] = [];
        }
      }
      if (!cancelled) setPeriodicRulesById(prev => ({ ...prev, ...next }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped]);

  /** 创建空周期事件包并写入事件库；随后刷新列表使其出现在「周期」分区并可绑定 */
  const createPeriodicPack = async () => {
    const id = `periodic-${Date.now()}`;
    const manifest: Manifest = {
      id,
      name: '我的周期事件包',
      version: '1.0.0',
      author: '匿名',
      description: '由游戏内「模块」面板创建的周期事件包。',
      engine: 'opt-event',
      schemaVersion: 1,
      minAppVersion: '2.5.0',
      type: 'periodic',
      coverColor: '#3b82f6',
      icon: 'Repeat',
      enabledByDefault: false,
      loadOrder: 100,
      permissions: ['register_tick'],
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
    try {
      await putWebEvent(rec);
      setPeriodicRulesById(prev => ({ ...prev, [id]: [] }));
      eventApi.invalidateModCache();
      await refresh();
      showToast('已创建周期事件包，点击「添加周期事件」即可编辑规则');
    } catch (e) {
      showToast('创建周期事件包失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  /** 保存某周期事件包内的 periodicRules 到 schema/rules.json（保留其它文件） */
  const savePeriodicRules = async (packId: string, next: PeriodicRule[]) => {
    setPeriodicRulesById(prev => ({ ...prev, [packId]: next }));
    try {
      const rec = await getWebEvent(packId);
      if (!rec) return;
      const files = {
        ...rec.files,
        'schema/rules.json': JSON.stringify({ version: 1, rules: [], periodicRules: next } as RuleFile, null, 2),
      };
      await putWebEvent({ ...rec, files });
    } catch (e) {
      showToast('保存周期事件失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleImport = async (file: File) => {
    try {
      const meta = await eventApi.importMod({ file });
      if (meta) {
        showToast(`已导入：${meta.name}`);
        await refresh();
      }
    } catch (e) {
      showToast('导入失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleExport = async () => {
    const enabledList = mods.filter(m => m.enabled);
    if (enabledList.length === 0) {
      showToast('当前没有已启用的事件包');
      return;
    }
    for (const m of enabledList) {
      try {
        await eventApi.exportMod(m.meta.id);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Upload size={15} /> 导入 .opt-event
        </button>
        <button className="btn-secondary btn-sm" onClick={handleExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
      {!loading && mods.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
          事件中心暂无已装事件包。可在「事件中心」页面创建/导入卡片或规则事件包。
        </div>
      )}

      {TYPE_ORDER.map((t) => {
        const list = grouped.get(t) ?? [];
        // 周期分区必须始终渲染（空态 + 新建按钮）；其余类型无数据则跳过
        if (list.length === 0 && t !== 'periodic') return null;
        const Icon = TYPE_META[t].icon;
        return (
          <div key={t}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-2)', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <Icon size={14} style={{ color: 'var(--accent)' }} /> {TYPE_META[t].label}
              {t === 'periodic' && (
                <button
                  className="btn-primary btn-sm"
                  onClick={() => void createPeriodicPack()}
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'none' }}
                >
                  <Plus size={14} /> 新建周期事件包
                </button>
              )}
            </div>

            {t === 'periodic' && list.length === 0 ? (
              <div style={{ padding: 'var(--space-5)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)', background: 'var(--bg-secondary)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                <Repeat size={22} style={{ color: 'var(--text-muted)' }} />
                <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>还没有周期事件包</div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', maxWidth: 280 }}>
                  周期事件包可设置「每隔若干轮自动结算」的资源 / 属性变动，无需玩家操作。点击下方按钮创建你的第一个。
                </div>
                <button className="btn-primary btn-sm" onClick={() => void createPeriodicPack()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={14} /> 新建周期事件包
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {list.map((e) => {
                  return (
                    <div key={e.meta.id} style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <span style={{ width: 28, height: 28, borderRadius: 'var(--radius-md)', background: e.meta.coverColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textOn(e.meta.coverColor || '#333'), flexShrink: 0 }}>
                          <Icon size={15} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)' }}>{e.meta.name}</div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>v{e.meta.version} · {e.meta.id}</div>
                        </div>
                        {t === 'card' && (
                          <button className="btn-ghost btn-sm" onClick={() => void handlePreview(e.meta.id)} aria-label="预览卡" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Eye size={14} /> 预览
                          </button>
                        )}
                        <EventSwitch checked={activeIds.has(e.meta.id)} onChange={(v) => toggle(e.meta.id, v)} label={activeIds.has(e.meta.id) ? '本局启用' : '本局禁用'} />
                      </div>
                      {t === 'periodic' && (
                        <PeriodicEventPackEditor
                          periodicEvents={periodicRulesById[e.meta.id] ?? []}
                          onChange={(next) => void savePeriodicRules(e.meta.id, next)}
                          worldDef={worldDef}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
