import { useEffect, useState } from 'react';
import { ArrowLeft, Lock, Layers } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { ensureCacheListener } from '../../modules/eventApi';
import type { EventRegistryEntry, EventPackType } from '../../modules/schema';
import { createRule, createEmptyPack } from '../../modules/webEventStore';
import { useEvents } from './useEvents';
import { useIsPhone } from '../../hooks/useIsMobile';
import EventCenter from './EventCenter';
import EventLibrary from './EventLibrary';
import CardEditor from './CardEditor';
import EventErrorBoundary from './EventErrorBoundary';
import WorkflowEditor from '../workflow/WorkflowEditor';
import { WorldBookBrowser } from './WorldBookPicker';
import EventImportWizard from './EventImportWizard';
import './event.css';

type SubView = 'center' | 'library' | 'card' | 'rule' | 'worldbook' | 'wizard';

/** 按事件包类型决定跳转的子视图 */
function subViewForType(type: EventPackType): SubView {
  if (type === 'rule') return 'rule';
  if (type === 'quest') return 'rule'; // 任务包用规则编辑器查看触发规则
  if (type === 'worldbook') return 'worldbook';
  return 'card'; // card / bundle 落入统一事件包编辑器
}

export default function EventsScreen() {
  const { navigate } = useGame();
  const eventApi = useEvents();
  const [subView, setSubView] = useState<SubView>('center');
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [centerTab, setCenterTab] = useState<'rules' | 'custom'>('rules');
  const isPhone = useIsPhone();
  // 监听 packs:changed 自动失效缓存（非 Tauri 环境静默忽略）
  useEffect(() => {
    void ensureCacheListener();
  }, []);

  const handleOpenPack = (entry: EventRegistryEntry) => {
    setSelectedPackId(entry.meta.id);
    setSubView(subViewForType(entry.meta.type));
  };

  // 新建事件包：立即创建一个空白且已落盘的事件包，随后打开编辑器往里加事件
  const handleNewPack = async () => {
    const packId = await createEmptyPack('我的卡片事件包');
    void eventApi.refresh();
    setSelectedPackId(packId);
    setSubView('card');
  };

  // 新建规则 → 落库后直接打开工作流编辑器
  const handleNewRule = async () => {
    try {
      const id = await createRule();
      setSelectedPackId(id);
      setSubView('rule');
    } catch (e) {
      console.error('[EventsScreen] 新建规则失败：', e);
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
            gap: isPhone ? 'var(--space-2)' : 'var(--space-3)',
            padding: isPhone ? '8px 12px' : '12px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            flexShrink: 0,
          }}
        >
          <button
            className="btn-ghost btn-sm"
            onClick={() => navigate('start')}
            style={{ minHeight: 'var(--touch-min)', minWidth: isPhone ? 44 : undefined, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ArrowLeft size={16} />{!isPhone && ' 返回'}
          </button>
          <h1 style={{ fontSize: isPhone ? 'var(--font-size-lg)' : 'var(--font-size-xl)', fontWeight: 600, fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' }}>
            {title}
          </h1>
          <div style={{ display: 'flex', gap: isPhone ? 'var(--space-2)' : 'var(--space-3)', marginLeft: 'auto', alignItems: 'center' }}>
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
                onOpenPack={handleOpenPack}
                onNewPack={handleNewPack}
                onNewRule={handleNewRule}
                onGoImport={() => setSubView('wizard')}
              />
              ) : (
                <ModuleCustomPlaceholder />
              )}
            </div>
          </div>
        )}
        {subView === 'library' && <EventLibrary eventApi={eventApi} onOpenPack={handleOpenPack} />}

        {/* 全屏编辑器 / 抽屉 / 向导（自带头部与返回，覆盖外壳头部）
            每个路由包一层本地错误边界（P0-3）：任一面板渲染失败仅隔离自身，
            不拖垮整个事件中心，并给出错误文案 + 返回入口。 */}
        {subView === 'card' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <EventErrorBoundary onBack={goCenter}>
              <CardEditor eventPackId={selectedPackId} onBack={goCenter} onSaved={() => void eventApi.refresh()} />
            </EventErrorBoundary>
          </div>
        )}
        {subView === 'rule' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <EventErrorBoundary onBack={goCenter}>
              <WorkflowEditor eventPackId={selectedPackId} onBack={goCenter} onSaved={() => void eventApi.refresh()} />
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
            <EventImportWizard eventApi={eventApi} eventPackId={selectedPackId} onClose={goCenter} />
          </EventErrorBoundary>
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
        minHeight: 44,
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 'var(--radius-md)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'color var(--duration-fast) var(--ease-out)',
        whiteSpace: 'nowrap',
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
        minHeight: 44,
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
