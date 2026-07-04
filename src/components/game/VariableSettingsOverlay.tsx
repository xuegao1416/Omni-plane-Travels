import { useState, useMemo, useCallback, useRef } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useDialog } from '../shared/Dialog';
import { X, Layers, List, Download, Upload } from 'lucide-react';
import type { GameState } from '../../schema/variables';
import type { ChatMessage } from '../../engine/types';
import { groupVariableEntriesBySection, getNpcVariableValues } from '../../engine/variableStructureDefs';
import type { SnapshotLayer, VariableSettingsOverlayProps } from './variableSettings/types';
import { SNAPSHOT_PAGE_SIZE, formatTime, displayValue } from './variableSettings/types';
import { SnapshotTab } from './variableSettings/SnapshotTab';
import { VariableTab } from './variableSettings/VariableTab';
import { ToolBtn, TabBtn } from './variableSettings/shared';

export function VariableSettingsOverlay({
  visible, onClose, messages, varMgr, onRestoreSnapshot, onSave,
}: VariableSettingsOverlayProps) {
  const { DialogUI, alert: dlgAlert } = useDialog();
  const [activeTab, setActiveTab] = useState<'snapshots' | 'variables'>('snapshots');
  const [snapshotPage, setSnapshotPage] = useState(0);
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
  const [layerEditTexts, setLayerEditTexts] = useState<Record<string, string>>({});
  const [layerModified, setLayerModified] = useState<Set<string>>(new Set());
  const [confirmRollback, setConfirmRollback] = useState<SnapshotLayer | null>(null);
  const [variableFilter, setVariableFilter] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedNpcs, setExpandedNpcs] = useState<Set<string>>(new Set());
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const snapshotLayers = useMemo<SnapshotLayer[]>(() => {
    const layers: SnapshotLayer[] = [];
    layers.push({ id: 'current', msgIndex: -1, snapshot: varMgr.getState(), snapshotTime: Date.now(), isInitial: false, content: '当前状态（最新）' });
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.snapshot) {
        layers.push({
          id: `msg-${i}`, msgIndex: i, snapshot: msg.snapshot as GameState,
          snapshotTime: (msg as any).snapshotTime || Date.now(), isInitial: false,
          content: (() => { const raw = msg.rawText || ''; return raw.slice(0, 80) + (raw.length > 80 ? '...' : ''); })(),
        });
      }
    }
    return layers;
  }, [messages, varMgr]);

  const totalPages = Math.ceil(snapshotLayers.length / SNAPSHOT_PAGE_SIZE);
  const pagedLayers = snapshotLayers.slice(snapshotPage * SNAPSHOT_PAGE_SIZE, (snapshotPage + 1) * SNAPSHOT_PAGE_SIZE);

  const toggleLayer = useCallback((layerId: string) => {
    setExpandedLayers(prev => { const n = new Set(prev); n.has(layerId) ? n.delete(layerId) : n.add(layerId); return n; });
  }, []);

  const getLayerEditText = useCallback((layer: SnapshotLayer) => {
    return layerEditTexts[layer.id] !== undefined ? layerEditTexts[layer.id] : JSON.stringify(layer.snapshot, null, 2);
  }, [layerEditTexts]);

  const handleLayerEdit = useCallback((layerId: string, text: string) => {
    setLayerEditTexts(prev => ({ ...prev, [layerId]: text }));
    setLayerModified(prev => new Set(prev).add(layerId));
  }, []);

  const handleLoadLatest = useCallback((layer: SnapshotLayer) => {
    try { JSON.parse(getLayerEditText(layer)); if (varMgr.setStateFromJSON(getLayerEditText(layer))) { setLayerModified(prev => { const n = new Set(prev); n.delete(layer.id); return n; }); onSave?.(); } }
    catch { dlgAlert('JSON 格式错误，请检查后重试', { title: '格式错误' }); }
  }, [varMgr, getLayerEditText, onSave, dlgAlert]);

  const handleRollback = useCallback((layer: SnapshotLayer) => {
    varMgr.restoreSnapshot(layer.snapshot); onRestoreSnapshot?.(layer.snapshot); onSave?.(); setConfirmRollback(null);
  }, [varMgr, onRestoreSnapshot, onSave]);

  const handleExport = useCallback(() => {
    const data = { exportedAt: new Date().toISOString(), layers: snapshotLayers.map(l => ({ msgIndex: l.msgIndex, snapshotTime: l.snapshotTime, isInitial: l.isInitial, snapshot: l.snapshot })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `variable-snapshots-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  }, [snapshotLayers]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { const text = await file.text(); const data = JSON.parse(text); const snapshot = data.snapshot || data; if (typeof snapshot === 'object' && snapshot !== null) { varMgr.restoreSnapshot(snapshot); onSave?.(); } }
    catch { dlgAlert('导入失败：文件格式不正确', { title: '导入失败' }); }
    if (importRef.current) importRef.current.value = '';
  }, [varMgr, onSave]);

  const sections = useMemo(() => groupVariableEntriesBySection(), []);
  const currentState = useMemo(() => varMgr.getState(), [varMgr, messages]);
  const npcVariables = useMemo(() => getNpcVariableValues(currentState), [currentState]);

  const startEdit = useCallback((path: string, value: unknown) => {
    setEditingVar(path); setEditValue(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''));
  }, []);

  const saveEdit = useCallback((path: string) => {
    try { let value: unknown; try { value = JSON.parse(editValue); } catch { value = editValue; } varMgr.setVar(path, value); setEditingVar(null); onSave?.(); }
    catch { dlgAlert('值格式错误', { title: '格式错误' }); }
  }, [editValue, varMgr, onSave]);

  const toggleSection = useCallback((key: string) => { setExpandedSections(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); }, []);
  const toggleNpc = useCallback((npcId: string) => { setExpandedNpcs(prev => { const n = new Set(prev); n.has(npcId) ? n.delete(npcId) : n.add(npcId); return n; }); }, []);

  if (!visible) return null;
  useBodyScrollLock(true);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {DialogUI}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />
      <div style={{ position: 'relative', width: '90vw', maxWidth: 1000, height: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: '0 16px 64px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-md)', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}><Layers size={18} /></div>
            <div>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: '700', color: 'var(--text-primary)' }}>变量管理</div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>VARIABLE MANAGEMENT · {snapshotLayers.length} 层快照</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
            <ToolBtn onClick={handleExport} title="导出快照"><Download size={14} /></ToolBtn>
            <ToolBtn onClick={() => importRef.current?.click()} title="导入快照"><Upload size={14} /></ToolBtn>
            <ToolBtn onClick={onClose} title="关闭"><X size={14} /></ToolBtn>
          </div>
        </div>

        {/* Tab 栏 */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
          <TabBtn active={activeTab === 'snapshots'} onClick={() => setActiveTab('snapshots')} icon={<Layers size={14} />} label="数据快照" />
          <TabBtn active={activeTab === 'variables'} onClick={() => setActiveTab('variables')} icon={<List size={14} />} label="变量列表" />
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {activeTab === 'snapshots' ? (
            <SnapshotTab layers={pagedLayers} totalLayers={snapshotLayers.length} page={snapshotPage} totalPages={totalPages} expandedLayers={expandedLayers} layerModified={layerModified} onPageChange={setSnapshotPage} onToggleLayer={toggleLayer} getEditText={getLayerEditText} onEdit={handleLayerEdit} onLoadLatest={handleLoadLatest} onRollback={setConfirmRollback} />
          ) : (
            <VariableTab sections={sections} state={currentState} npcVariables={npcVariables} filter={variableFilter} onFilterChange={setVariableFilter} expandedSections={expandedSections} onToggleSection={toggleSection} expandedNpcs={expandedNpcs} onToggleNpc={toggleNpc} editingVar={editingVar} editValue={editValue} onStartEdit={startEdit} onEditValueChange={setEditValue} onSaveEdit={saveEdit} onCancelEdit={() => setEditingVar(null)} />
          )}
        </div>

        {/* 确认回滚弹窗 */}
        {confirmRollback && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', zIndex: 10 }}>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px', maxWidth: 400, textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600', color: 'var(--text-primary)', marginBottom: 8 }}>确认回滚？</div>
              <div style={{ fontSize: 'var(--font-size-base)', color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
                回滚到第 {confirmRollback.msgIndex + 1} 层
                {confirmRollback.content && <span style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>"{confirmRollback.content.slice(0, 50)}..."</span>}
                <span style={{ display: 'block', marginTop: 8, color: '#f0883e', fontSize: 'var(--font-size-sm)' }}>⚠️ 此操作将覆盖当前变量状态</span>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={() => setConfirmRollback(null)} style={{ padding: '8px 20px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-base)' }}>取消</button>
                <button onClick={() => handleRollback(confirmRollback)} style={{ padding: '8px 20px', border: 'none', borderRadius: 'var(--radius-md)', background: '#da3633', color: '#fff', cursor: 'pointer', fontSize: 'var(--font-size-base)', fontWeight: '600' }}>确认回滚</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
