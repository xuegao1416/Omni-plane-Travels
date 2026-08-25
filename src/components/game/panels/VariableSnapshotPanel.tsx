import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, History, RotateCcw } from 'lucide-react';
import { useDialog } from '../../shared/Dialog';
import type { GameState } from '../../../schema/variables';
import type { SnapshotLayer, VariableSnapshotPanelProps } from './variableSnapshot/types';
import { SnapshotToolbar } from './variableSnapshot/SnapshotToolbar';
import { ApiSettingsSection } from './variableSnapshot/ApiSettingsSection';
import { SnapshotList } from './variableSnapshot/SnapshotList';
import { RollbackConfirm } from './variableSnapshot/RollbackConfirm';
import { STORAGE_KEYS } from '../../../config/storageKeys';
import type { GameplayLogEntry } from '../../../gameplay/types';
import { revertGameplayTransaction } from '../../../gameplay/kernel';

const GAMEPLAY_LOG_LIMIT = 20;

const GAMEPLAY_SOURCE_LABELS: Record<string, string> = {
  player: '玩家操作', system: '本地系统', ai: '模型更新', rule: '规则', periodic: '周期结算',
  'event-workflow': '事件流程', 'combat.start': '战斗开始', 'combat.action': '战斗行动',
  'combat.end': '战斗结束', 'combat.result': '战斗结算', 'system:revert': '安全撤销',
};
const GAMEPLAY_MODULE_LABELS: Record<string, string> = {
  system: '系统', stat: '数值属性', survival: '生存资源', business: '经营资产', progression: '成长体系',
  dice: '骰子检定', talent: '天赋与技能', profession: '职业体系', combat: '战斗系统', event: '事件系统',
};

function gameplaySourceLabel(source: string): string {
  return GAMEPLAY_SOURCE_LABELS[source] ?? (/[A-Za-z]/.test(source) ? '其他来源' : source);
}

function gameplayModuleLabel(moduleId?: string): string {
  if (!moduleId) return '';
  return GAMEPLAY_MODULE_LABELS[moduleId] ?? (/[A-Za-z]/.test(moduleId) ? '其他模块' : moduleId);
}

function gameplayPathLabel(path: string): string {
  const replacements: Record<string, string> = {
    attrA: '生命', attrB: '能量', dim1: '属性一', dim2: '属性二', dim3: '属性三',
    dim4: '属性四', dim5: '属性五', dim6: '属性六', currentXP: '当前经验', currentTierIndex: '当前阶段',
  };
  const localized = path.split('.').map(part => replacements[part] ?? part).join(' › ');
  return /[A-Za-z]/.test(localized) ? localized.replace(/[A-Za-z_][A-Za-z0-9_-]*/g, '内部项') : localized;
}

function formatGameplayValue(value: unknown): string {
  if (value === undefined) return '∅';
  if (typeof value === 'string') return value.length > 36 ? `${value.slice(0, 36)}…` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > 36 ? `${text.slice(0, 36)}…` : text;
  } catch {
    return String(value);
  }
}

function gameplayStatusLabel(status: GameplayLogEntry['status']): string {
  return {
    applied: '已应用',
    blocked: '已阻止',
    failed: '执行失败',
    reverted: '已撤销',
  }[status];
}

function gameplayStatusColor(status: GameplayLogEntry['status']): string {
  return {
    applied: 'var(--success, #70c090)',
    blocked: 'var(--warning, #d6a85e)',
    failed: 'var(--danger, #d97878)',
    reverted: 'var(--text-muted)',
  }[status];
}

function GameplayLogSection({
  varMgr,
  onSave,
  onChanged,
  revision,
}: Pick<VariableSnapshotPanelProps, 'varMgr' | 'onSave'> & { onChanged: () => void; revision: number }) {
  const { DialogUI, confirm, alert } = useDialog();
  const [expanded, setExpanded] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const logs = useMemo(() => {
    const state = varMgr.getState();
    return [...(state.gameplay?.logs ?? [])]
      .sort((a, b) => b.sequence - a.sequence)
      .slice(0, GAMEPLAY_LOG_LIMIT);
  }, [varMgr, expanded, revision]);

  const handleRevert = useCallback(async (log: GameplayLogEntry) => {
    const accepted = await confirm(
      `撤销“${log.label || log.transactionId}”？只有在该事务写入的变量尚未被后续变化覆盖时才能安全撤销。`,
      { title: '确认撤销玩法变化', confirmText: '撤销', danger: true },
    );
    if (!accepted) return;

    const state = varMgr.getState();
    const result = revertGameplayTransaction(state, log.transactionId, {
      tick: state.simulationRuntime?.tick ?? 0,
    });
    // 即使撤销被阻止，也保留内核产生的审计日志，让玩家能看到原因。
    varMgr.setState(result.state as GameState);
    onChanged();
    onSave?.();
    if (result.status !== 'applied') {
      await alert(result.reason || '该事务当前无法撤销。', { title: '撤销未完成' });
    }
  }, [alert, confirm, onChanged, onSave, varMgr]);

  return (
    <>
      {DialogUI}
      <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setExpanded(prev => !prev)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '10px 16px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)',
        }}
      >
        <History size={14} />
        <span>玩法日志</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
          {logs.length ? `最近 ${logs.length} 条` : '暂无记录'}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {logs.length === 0 ? (
            <div style={{ padding: '8px 4px', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
              玩法模块产生变化后，会在这里显示来源、原因和可撤销状态。
            </div>
          ) : logs.map(log => {
            const isExpanded = expandedLogs.has(log.id);
            const canRevert = log.status === 'applied';
            return (
              <div key={log.id} style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-secondary)', overflow: 'hidden',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px' }}>
                  <button
                    onClick={() => setExpandedLogs(prev => {
                      const next = new Set(prev);
                      if (next.has(log.id)) next.delete(log.id); else next.add(log.id);
                      return next;
                    })}
                    aria-label={isExpanded ? '收起日志详情' : '展开日志详情'}
                    style={{ background: 'none', border: 0, padding: 0, color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                    {log.label || log.transactionId}
                  </span>
                  <span style={{ color: gameplayStatusColor(log.status), fontSize: 'var(--font-size-xs)', flexShrink: 0 }}>
                    {gameplayStatusLabel(log.status)}
                  </span>
                  {canRevert && (
                    <button
                      onClick={() => void handleRevert(log)}
                      title="安全撤销这次玩法变化"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-secondary)', padding: '3px 6px', cursor: 'pointer', fontSize: 'var(--font-size-xs)' }}
                    >
                      <RotateCcw size={11} />撤销
                    </button>
                  )}
                </div>
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                    <div>来源：{gameplaySourceLabel(log.source)}{log.moduleId ? ` · ${gameplayModuleLabel(log.moduleId)}` : ''} · 推演轮次 {log.tick}</div>
                    {log.reason && <div style={{ color: log.status === 'failed' ? 'var(--danger)' : 'var(--warning)' }}>原因：{log.reason}</div>}
                    {log.changes.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {log.changes.slice(0, 8).map((change, index) => (
                          <div key={`${change.path}-${index}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {gameplayPathLabel(change.path)}：{formatGameplayValue(change.before)} → {formatGameplayValue(change.after)}
                          </div>
                        ))}
                        {log.changes.length > 8 && <div>还有 {log.changes.length - 8} 项变化…</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </>
  );
}

export default function VariableSnapshotPanel({
  messages, varMgr, onRestoreSnapshot, onRollbackToSnapshot, onSave, onCommitState,
}: VariableSnapshotPanelProps) {
  const { DialogUI, alert: dlgAlert } = useDialog();
  const [layerEditTexts, setLayerEditTexts] = useState<Record<string, string>>({});
  const [layerModified, setLayerModified] = useState<Set<string>>(new Set());
  const [confirmRollback, setConfirmRollback] = useState<SnapshotLayer | null>(null);
  const [gameplayRevision, setGameplayRevision] = useState(0);

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
  }, [messages, varMgr, gameplayRevision]);

  // ─── 层编辑 ───
  const getLayerEditText = useCallback((layer: SnapshotLayer) => {
    if (layerEditTexts[layer.id] !== undefined) return layerEditTexts[layer.id];
    return JSON.stringify(layer.snapshot, null, 2);
  }, [layerEditTexts]);

  const handleLayerEdit = useCallback((layerId: string, text: string) => {
    setLayerEditTexts(prev => ({ ...prev, [layerId]: text }));
    setLayerModified(prev => new Set(prev).add(layerId));
  }, []);

  const handleLoadLatest = useCallback(async (layer: SnapshotLayer) => {
    const text = getLayerEditText(layer);
    try {
      JSON.parse(text);
    } catch {
      dlgAlert('JSON 格式错误，请检查后重试', { title: '格式错误' });
      return;
    }
    if (!varMgr.setStateFromJSON(text)) {
      dlgAlert('状态内容无法应用，请检查数据后重试', { title: '应用失败' });
      return;
    }
    try {
      if (onCommitState) await onCommitState();
      else onSave?.();
      const canonicalText = JSON.stringify(varMgr.getState(), null, 2);
      setLayerEditTexts(prev => ({ ...prev, [layer.id]: canonicalText }));
      setLayerModified(prev => { const next = new Set(prev); next.delete(layer.id); return next; });
      setGameplayRevision(prev => prev + 1);
    } catch {
      dlgAlert('编辑已经应用到当前游戏，但立即存档失败。请保留页面并重试。', { title: '保存失败' });
    }
  }, [varMgr, getLayerEditText, onSave, onCommitState, dlgAlert]);

  const handleRollback = useCallback(() => {
    if (!confirmRollback) return;
    if (onRollbackToSnapshot && confirmRollback.msgIndex >= 0) {
      onRollbackToSnapshot(confirmRollback.msgIndex);
    } else {
      varMgr.restoreSnapshot(confirmRollback.snapshot);
      onRestoreSnapshot?.(confirmRollback.snapshot);
      onSave?.();
    }
    setConfirmRollback(null);
  }, [varMgr, onRestoreSnapshot, onRollbackToSnapshot, onSave, confirmRollback]);

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
      <GameplayLogSection
        varMgr={varMgr}
        onSave={onSave}
        onChanged={() => setGameplayRevision(prev => prev + 1)}
        revision={gameplayRevision}
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
