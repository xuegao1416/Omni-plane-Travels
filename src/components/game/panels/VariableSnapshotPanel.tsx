import { useState, useMemo, useCallback } from 'react';
import { useDialog } from '../../shared/Dialog';
import type { GameState } from '../../../schema/variables';
import type { SnapshotLayer, VariableSnapshotPanelProps } from './variableSnapshot/types';
import { SnapshotToolbar } from './variableSnapshot/SnapshotToolbar';
import { ApiSettingsSection } from './variableSnapshot/ApiSettingsSection';
import { SnapshotList } from './variableSnapshot/SnapshotList';
import { RollbackConfirm } from './variableSnapshot/RollbackConfirm';
import { STORAGE_KEYS } from '../../../config/storageKeys';

export default function VariableSnapshotPanel({
  messages, varMgr, onRestoreSnapshot, onSave,
}: VariableSnapshotPanelProps) {
  const { DialogUI, alert: dlgAlert } = useDialog();
  const [layerEditTexts, setLayerEditTexts] = useState<Record<string, string>>({});
  const [layerModified, setLayerModified] = useState<Set<string>>(new Set());
  const [confirmRollback, setConfirmRollback] = useState<SnapshotLayer | null>(null);

  // ─── 变量提取 API 配置 ───
  const [varApiPresetId, setVarApiPresetId] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.VARIABLE_API_PRESET) || ''; } catch { return ''; }
  });

  const handleSaveApiSettings = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.VARIABLE_API_PRESET, varApiPresetId);
    onSave?.();
  }, [varApiPresetId, onSave]);

  // ─── 构建快照层级 ───
  const snapshotLayers = useMemo<SnapshotLayer[]>(() => {
    const layers: SnapshotLayer[] = [];
    const currentState = varMgr.getState();
    layers.push({
      id: 'current', msgIndex: -1, snapshot: currentState,
      snapshotTime: Date.now(), isInitial: false, content: '当前状态（最新）',
    });
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.snapshot) {
        const raw = msg.rawText || '';
        layers.push({
          id: `msg-${i}`, msgIndex: i, snapshot: msg.snapshot as GameState,
          snapshotTime: (msg as any).snapshotTime || Date.now(), isInitial: false,
          content: raw.slice(0, 80) + (raw.length > 80 ? '...' : ''),
        });
      }
    }
    return layers;
  }, [messages, varMgr]);

  // ─── 层编辑 ───
  const getLayerEditText = useCallback((layer: SnapshotLayer) => {
    if (layerEditTexts[layer.id] !== undefined) return layerEditTexts[layer.id];
    return JSON.stringify(layer.snapshot, null, 2);
  }, [layerEditTexts]);

  const handleLayerEdit = useCallback((layerId: string, text: string) => {
    setLayerEditTexts(prev => ({ ...prev, [layerId]: text }));
    setLayerModified(prev => new Set(prev).add(layerId));
  }, []);

  const handleLoadLatest = useCallback((layer: SnapshotLayer) => {
    const text = getLayerEditText(layer);
    try {
      JSON.parse(text);
      if (varMgr.setStateFromJSON(text)) {
        setLayerModified(prev => { const next = new Set(prev); next.delete(layer.id); return next; });
        onSave?.();
      }
    } catch {
      dlgAlert('JSON 格式错误，请检查后重试', { title: '格式错误' });
    }
  }, [varMgr, getLayerEditText, onSave, dlgAlert]);

  const handleRollback = useCallback(() => {
    if (!confirmRollback) return;
    varMgr.restoreSnapshot(confirmRollback.snapshot);
    onRestoreSnapshot?.(confirmRollback.snapshot);
    onSave?.();
    setConfirmRollback(null);
  }, [varMgr, onRestoreSnapshot, onSave, confirmRollback]);

  // ─── 导出 / 导入 ───
  const handleExport = useCallback(() => {
    const data = {
      exportedAt: new Date().toISOString(),
      layers: snapshotLayers.map(l => ({
        msgIndex: l.msgIndex, snapshotTime: l.snapshotTime,
        isInitial: l.isInitial, snapshot: l.snapshot,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `variable-snapshots-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [snapshotLayers]);

  const handleImport = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const snapshot = data.snapshot || data;
      if (typeof snapshot === 'object' && snapshot !== null) {
        varMgr.restoreSnapshot(snapshot);
        onSave?.();
      }
    } catch {
      dlgAlert('导入失败：文件格式不正确', { title: '导入失败' });
    }
  }, [varMgr, onSave, dlgAlert]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-primary)', position: 'relative',
    }}>
      {DialogUI}
      <SnapshotToolbar
        snapshotLayers={snapshotLayers}
        onExport={handleExport}
        onImport={handleImport}
        onRefresh={() => {}}
      />
      <ApiSettingsSection
        varApiPresetId={varApiPresetId}
        onPresetIdChange={setVarApiPresetId}
        onSave={handleSaveApiSettings}
      />
      <SnapshotList
        snapshotLayers={snapshotLayers}
        getLayerEditText={getLayerEditText}
        layerModified={layerModified}
        onLoadLatest={handleLoadLatest}
        onRollbackRequest={setConfirmRollback}
        onLayerEdit={handleLayerEdit}
      />
      {confirmRollback && (
        <RollbackConfirm
          layer={confirmRollback}
          onConfirm={handleRollback}
          onCancel={() => setConfirmRollback(null)}
        />
      )}
    </div>
  );
}
