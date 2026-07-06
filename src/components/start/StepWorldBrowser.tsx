import { useState, useMemo, useRef, useEffect } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { Search, Globe, ChevronRight, Upload, ArrowLeft, ExternalLink } from 'lucide-react';
import type { WorldDef } from '../../data/worlds-schema';
import type { WorldBookEntry } from '../../worldbook/index';
import WorldCard, { CreateWorldCard, getWorldIcon } from './WorldCard';
import WorldBookEditor from './WorldBookEditor';
import { useIsPhone } from '../../hooks/useIsMobile';
import { DIFFICULTY_FILTERS, TABS, type TabKey, normalizeExternal } from './stepWorldBrowser/constants';
import { OverviewTab, LoreTab, FactionsTab, CultureTab, NpcsTab, RulesTab, SystemsTab, EconomyTab } from './stepWorldBrowser/WorldDetailTabs';

interface StepWorldBrowserProps {
  selectedWorld: string;
  setSelectedWorld: (id: string) => void;
  createdWorlds: WorldDef[];
  allWorlds: WorldDef[];
  worldEntry: WorldBookEntry | null;
  onNext: () => void;
  onEditWorld: (world: WorldDef) => void;
  onDeleteWorld: (worldId: string) => void;
  onCreateWorld: () => void;
  onImportWorld: (world: WorldDef) => void;
  onSaveWorld?: (world: WorldDef) => void;
}

export default function StepWorldBrowser({
  selectedWorld, setSelectedWorld, createdWorlds, allWorlds, worldEntry,
  onNext, onEditWorld, onDeleteWorld, onCreateWorld, onImportWorld, onSaveWorld,
}: StepWorldBrowserProps) {
  const [search, setSearch] = useState('');
  const [diffFilter, setDiffFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [importError, setImportError] = useState('');
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsPhone();

  const selected = allWorlds.find(w => w.id === selectedWorld);
  useBodyScrollLock(isMobile && showMobileDetail && !!selected);

  useEffect(() => { if (isMobile && selectedWorld) setShowMobileDetail(true); }, [selectedWorld, isMobile]);

  const handleImportClick = () => { setImportError(''); fileInputRef.current?.click(); };
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        const isOurFormat = (Array.isArray(data.worldBookEntries) && data.worldBookEntries.some((e: any) => typeof e.entryType === 'string')) || Array.isArray(data.modules) || (typeof data.id === 'string' && data.id.startsWith('world_'));
        if (isOurFormat) { const world = data as WorldDef; if (!world.name) { setImportError('JSON 缺少 name 字段'); return; } if (!world.id) world.id = `custom_${Date.now()}`; world.entryId = null; world.source = undefined; onImportWorld(world); }
        else { onImportWorld(normalizeExternal(data, file.name)); }
        setImportError('');
      } catch { setImportError('JSON 解析失败，请检查文件格式'); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const filteredWorlds = useMemo(() => allWorlds.filter(w => {
    if (diffFilter !== 'all' && w.difficulty !== diffFilter) return false;
    if (search) { const q = search.toLowerCase(); const match = (s?: string) => s?.toLowerCase().includes(q); return match(w.name) || match(w.description) || w.tags?.some(t => match(t)); }
    return true;
  }), [allWorlds, search, diffFilter]);

  const renderTabBar = () => (
    <div className={`world-tabs${isMobile ? ' world-tabs-icon-only' : ''}`}>
      {TABS.filter(tab => tab.key !== 'systems' || (selected!.modules && selected!.modules.some(m => m.enabled))).map(tab => {
        const Icon = tab.icon;
        return <button key={tab.key} className={`world-tab${activeTab === tab.key ? ' active' : ''}`} onClick={() => setActiveTab(tab.key)} title={isMobile ? tab.label : undefined}><Icon size={isMobile ? 18 : 14} strokeWidth={2} />{!isMobile && tab.label}</button>;
      })}
    </div>
  );

  const renderTabContent = () => (
    <div className="world-tab-content">
      {activeTab === 'overview' && <OverviewTab world={selected!} worldEntry={worldEntry} />}
      {activeTab === 'lore' && <LoreTab world={selected!} />}
      {activeTab === 'factions' && <FactionsTab world={selected!} />}
      {activeTab === 'culture' && <CultureTab world={selected!} />}
      {activeTab === 'economy' && <EconomyTab world={selected!} />}
      {activeTab === 'npcs' && <NpcsTab world={selected!} />}
      {activeTab === 'rules' && <RulesTab world={selected!} />}
      {activeTab === 'systems' && <SystemsTab world={selected!} />}
    </div>
  );

  const renderDetailHeader = (w: WorldDef) => {
    const DetailIcon = getWorldIcon(w);
    return (
      <div className="world-detail-header" style={{ '--cover-color': w.coverColor ?? 'var(--accent)' } as React.CSSProperties}>
        <DetailIcon size={32} strokeWidth={1.5} />
        <div>
          <h2 className="world-detail-title">{w.name}</h2>
          <p className="world-detail-desc">{w.description}</p>
          {w.tags && <div className="world-detail-meta">{w.tags.map(tag => <span key={tag} className="world-card-tag">{tag}</span>)}</div>}
        </div>
      </div>
    );
  };

  // 移动端详情覆盖层
  const renderMobileDetailOverlay = () => {
    if (!isMobile || !showMobileDetail || !selected) return null;
    return (
      <div className="mobile-detail-overlay">
        <div className="mobile-detail-header">
          <button className="mobile-detail-back" onClick={() => setShowMobileDetail(false)}><ArrowLeft size={20} /><span>返回</span></button>
          <button className="btn-primary mobile-detail-next" onClick={onNext} disabled={!selectedWorld}>下一步 <ChevronRight size={16} /></button>
        </div>
        <div className="mobile-detail-content">
          {selected.source === 'external' ? (
            <WorldBookEditor key={selected.id} world={selected} onSave={(updated) => onSaveWorld?.(updated)} />
          ) : (
            <div className="world-detail">{renderDetailHeader(selected)}{renderTabBar()}{renderTabContent()}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="world-browser">
      <div className="world-browser-left">
        <div className="world-browser-toolbar">
          <div className="world-search-box"><Search size={14} strokeWidth={2} /><input type="text" placeholder="搜索世界..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="world-diff-filters">
            {DIFFICULTY_FILTERS.map(f => (
              <button key={f.key} className={`diff-filter-btn${diffFilter === f.key ? ' active' : ''}`} onClick={() => setDiffFilter(f.key)} style={f.color ? { '--dot-color': f.color } as React.CSSProperties : undefined} data-color={f.color}>
                {f.color && <span className="diff-dot" style={{ background: f.color }} />}{f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="world-card-grid">
          {filteredWorlds.map(w => <WorldCard key={w.id} world={w} selected={selectedWorld === w.id} onSelect={() => setSelectedWorld(w.id)} isCustom={createdWorlds.some(c => c.id === w.id)} onEdit={() => onEditWorld(w)} onDelete={() => onDeleteWorld(w.id)} />)}
          <CreateWorldCard onClick={onCreateWorld} />
          <div className="world-card create-world-card" onClick={handleImportClick} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, border: '2px dashed var(--border)', background: 'transparent' }}>
            <Upload size={28} style={{ color: 'var(--text-muted)' }} /><span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>导入世界</span>
          </div>
          {importError && <div style={{ gridColumn: '1 / -1', color: '#ef4444', fontSize: 'var(--font-size-sm)', textAlign: 'center' }}>{importError}</div>}
        </div>
        <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
      </div>

      {!isMobile && (
        <div className="world-browser-right">
          {selected ? (
            selected.source === 'external' ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {(() => { const DetailIcon = getWorldIcon(selected); return (
                  <div className="world-detail-header" style={{ '--cover-color': selected.coverColor ?? 'var(--accent)' } as React.CSSProperties}>
                    <DetailIcon size={32} strokeWidth={1.5} />
                    <div><h2 className="world-detail-title">{selected.name}<span style={{ marginLeft: 8, fontSize: 'var(--font-size-xs)', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.2)', fontWeight: 500, verticalAlign: 'middle', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ExternalLink size={12} /> 外部</span></h2><p className="world-detail-desc">{selected.description}</p></div>
                  </div>
                ); })()}
                <WorldBookEditor key={selected.id} world={selected} onSave={(updated) => onSaveWorld?.(updated)} />
              </div>
            ) : (
              <div className="world-detail">{renderDetailHeader(selected)}{renderTabBar()}{renderTabContent()}</div>
            )
          ) : (
            <div className="world-detail-empty"><Globe size={48} strokeWidth={1} style={{ color: 'var(--text-muted)', opacity: 0.3 }} /><p>选择一个世界查看详情</p></div>
          )}
          <div className="world-browser-nav">
            <button className="btn-primary" onClick={onNext} disabled={!selectedWorld} title={!selectedWorld ? '请先选择一个世界' : ''}>下一步 <ChevronRight size={16} /></button>
          </div>
        </div>
      )}
      {renderMobileDetailOverlay()}
    </div>
  );
}
