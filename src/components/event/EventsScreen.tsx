import { useEffect, useState } from 'react';
import { ArrowLeft, Lock, Layers, Save, Loader2 } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { ensureModListener } from '../../modules/eventApi';
import type { EventRegistryEntry, EventType, PeriodicRule, RuleFile } from '../../modules/schema';
import { getWebEvent } from '../../modules/eventDb';
import { savePeriodicRulesToPack, createRulePack, createEmptyPack } from '../../modules/webEventStore';
import { useEvents } from './useEvents';
import EventCenter from './EventCenter';
import EventLibrary from './EventLibrary';
import CardEditor from './CardEditor';
import EventErrorBoundary from './EventErrorBoundary';
import RuleEditor from './RuleEditor';
import PeriodicEventPackEditor from './PeriodicEventPackEditor';
import { WorldBookBrowser } from './WorldBookPicker';
import EventImportWizard from './EventImportWizard';
import './mod.css';

type SubView = 'center' | 'library' | 'card' | 'rule' | 'worldbook' | 'wizard' | 'periodic';

/** 按事件类型决定跳转的占位子视图（Part 2 已实现真实编辑页） */
function subViewForType(type: EventType): SubView {
  if (type === 'rule') return 'rule';
  if (type === 'worldbook') return 'worldbook';
  // P1-8：周期包走专属编辑器视图，不再错送空白 CardEditor
  if (type === 'periodic') return 'periodic';
  return 'card'; // card / bundle 落入统一事件包编辑器
}

export default function EventsScreen() {
  const { navigate } = useGame();
  const eventApi = useEvents();
  const [subView, setSubView] = useState<SubView>('center');
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  /** 事件中心内部 Tab：事件（默认，装全部 mod 管理 UI）/ 模块自定义（禁用占位，未来） */
  const [centerTab, setCenterTab] = useState<'rules' | 'custom'>('rules');

  // 监听 mods:changed 自动失效缓存（非 Tauri 环境静默忽略）
  useEffect(() => {
    void ensureModListener();
  }, []);

  const handleOpenMod = (entry: EventRegistryEntry) => {
    setSelectedModId(entry.meta.id);
    setSubView(subViewForType(entry.meta.type));
  };

  // 新建事件包：立即创建一个空白且已落盘的事件包（类比「创建游戏存档」），随后打开编辑器往里加事件
  const handleNewMod = async () => {
    const packId = await createEmptyPack();
    void eventApi.refresh();
    setSelectedModId(packId);
    setSubView('card');
  };

  // P1-8：新建规则包 → 落库后直接打开 RuleEditor
  const handleNewRulePack = async () => {
    try {
      const id = await createRulePack();
      setSelectedModId(id);
      setSubView('rule');
    } catch (e) {
      console.error('[EventsScreen] 新建规则包失败：', e);
    }
  };

  const goCenter = () => setSubView('center');

  const isShell = subView === 'center' || subView === 'library';
  const title = subView === 'library' ? '事件库' : '事件中心';

  return (
    <div
      className="full-height"
      style={{
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 外壳头部（仅仪表盘视图显示；编辑器自带头部与返回） */}
      {isShell && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            flexShrink: 0,
          }}
        >
          <button
            className="btn-ghost btn-sm"
            onClick={() => navigate('start')}
            style={{ minHeight: 'var(--touch-min)' }}
          >
            <ArrowLeft size={16} /> 返回
          </button>
          <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
            {title}
          </h1>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginLeft: 'auto' }}>
            <TabButton active={subView === 'center'} onClick={() => setSubView('center')}>
              事件中心
            </TabButton>
            <TabButton active={subView === 'library'} onClick={() => setSubView('library')}>
              事件库
            </TabButton>
          </div>
        </div>
      )}

      {/* 内容 */}
      <div style={{ flex: 1, position: 'relative', overflow: isShell ? 'auto' : 'hidden' }}>
        {subView === 'center' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 事件中心内部 Tab 栏 */}
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-4)',
                padding: '10px 16px 0',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-secondary)',
                flexShrink: 0,
              }}
            >
              <InnerTab label="事件" active={centerTab === 'rules'} onClick={() => setCenterTab('rules')} />
              <InnerTab
                label="模块自定义"
                disabled
                hint="敬请期待"
                active={false}
                onClick={() => { /* 禁用占位：本期不建，点击无反应 */ }}
              />
            </div>
            {/* 内部 Tab 内容 */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {centerTab === 'rules' ? (
              <EventCenter
                eventApi={eventApi}
                onOpenMod={handleOpenMod}
                onNewMod={handleNewMod}
                onNewRulePack={handleNewRulePack}
                onGoImport={() => setSubView('wizard')}
              />
              ) : (
                <ModuleCustomPlaceholder />
              )}
            </div>
          </div>
        )}
        {subView === 'library' && <EventLibrary eventApi={eventApi} onOpenMod={handleOpenMod} />}

        {/* 全屏编辑器 / 抽屉 / 向导（自带头部与返回，覆盖外壳头部）
            每个路由包一层本地错误边界（P0-3）：任一面板渲染失败仅隔离自身，
            不拖垮整个事件中心，并给出错误文案 + 返回入口。 */}
        {subView === 'card' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <EventErrorBoundary onBack={goCenter}>
              <CardEditor eventPackId={selectedModId} onBack={goCenter} onSaved={() => void eventApi.refresh()} />
            </EventErrorBoundary>
          </div>
        )}
        {subView === 'rule' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <EventErrorBoundary onBack={goCenter}>
              <RuleEditor eventPackId={selectedModId} onBack={goCenter} />
            </EventErrorBoundary>
          </div>
        )}
        {subView === 'worldbook' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <EventErrorBoundary onBack={goCenter}>
              <WorldBookBrowser onClose={goCenter} />
            </EventErrorBoundary>
          </div>
        )}
        {subView === 'wizard' && (
          <EventErrorBoundary onBack={goCenter}>
            <EventImportWizard eventApi={eventApi} eventPackId={selectedModId} onClose={goCenter} />
          </EventErrorBoundary>
        )}
        {subView === 'periodic' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <EventErrorBoundary onBack={goCenter}>
              <PeriodicPackView packId={selectedModId ?? ''} onBack={goCenter} />
            </EventErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 周期包专属视图（P1-8）：从 schema/rules.json 读取 periodicRules，
 * 用 PeriodicEventPackEditor 编辑，保存时写回（保留同文件中的 rules）。
 * 不再把周期包错送进空白 CardEditor。
 */
function PeriodicPackView({ packId, onBack }: { packId: string; onBack: () => void }) {
  const [rules, setRules] = useState<PeriodicRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rec = await getWebEvent(packId).catch(() => undefined);
        const raw = rec?.files['schema/rules.json'];
        const next = typeof raw === 'string'
          ? ((JSON.parse(raw) as RuleFile).periodicRules ?? [])
          : [];
        if (!cancelled) setRules(next);
      } catch {
        if (!cancelled) setRules([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [packId]);

  const save = async () => {
    setSaving(true);
    try {
      await savePeriodicRulesToPack(packId, rules);
    } catch (e) {
      console.error('[PeriodicPackView] 保存周期规则失败：', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
        <button className="btn-ghost btn-sm" onClick={onBack} style={{ minHeight: 'var(--touch-min)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={16} /> 返回
        </button>
        <h1 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, fontFamily: 'var(--font-display)' }}>周期事件包</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn-primary btn-sm" onClick={() => void save()} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Save size={15} /> {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
            <Loader2 size={18} className="event-spin" /> 加载中…
          </div>
        ) : (
          <PeriodicEventPackEditor periodicEvents={rules} onChange={setRules} worldDef={null} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
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
        padding: 'var(--space-1) var(--space-2)',
        borderRadius: 'var(--radius-md)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'color var(--duration-fast) var(--ease-out)',
      }}
    >
      {children}
    </button>
  );
}

/** 事件中心内部 Tab：事件（启用）/ 模块自定义（禁用占位） */
function InnerTab({
  label,
  active,
  disabled,
  hint,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      aria-disabled={disabled}
      title={disabled ? '本期未开放' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: 'var(--space-2) var(--space-1)',
        background: 'none',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 'var(--font-size-md)',
        fontWeight: 600,
        color: disabled ? 'var(--text-muted)' : active ? 'var(--accent)' : 'var(--text-secondary)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        marginBottom: '-1px',
        opacity: disabled ? 0.55 : 1,
        transition: 'color var(--duration-fast) var(--ease-out)',
      }}
    >
      {label}
      {disabled && <Lock size={13} />}
      {disabled && hint && (
        <span
          style={{
            fontSize: 'var(--font-size-xs)',
            fontWeight: 500,
            color: 'var(--text-muted)',
            background: 'var(--bg-tertiary, var(--bg-primary))',
            padding: '1px 6px',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

/** 模块自定义占位（未来功能，本期仅占位） */
function ModuleCustomPlaceholder() {
  return (
    <div
      className="event-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        height: '100%',
        padding: 'var(--space-8)',
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Layers size={28} strokeWidth={1.75} />
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
        模块自定义
      </div>
      <div style={{ fontSize: 'var(--font-size-sm)', maxWidth: 360 }}>
        真正的模块级自定义（自定义资源、专属规则、世界级变量）将在后续版本开放。敬请期待。
      </div>
    </div>
  );
}
