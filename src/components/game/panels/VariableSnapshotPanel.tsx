import { useState,useMemo,useCallback,useEffect,useRef } from 'react';
import { ChevronDown,ChevronRight,History,RotateCcw } from 'lucide-react';
import { useDialog } from '../../shared/Dialog';
import type { GameState } from '../../../schema/variables';
import type { SnapshotLayer,VariableSnapshotPanelProps } from './variableSnapshot/types';
import { SnapshotToolbar } from './variableSnapshot/SnapshotToolbar';
import { ApiSettingsSection } from './variableSnapshot/ApiSettingsSection';
import { SnapshotList } from './variableSnapshot/SnapshotList';
import { RollbackConfirm } from './variableSnapshot/RollbackConfirm';
import { importCurrentVariableJSON, prepareCurrentVariableJSON, resolveCurrentRollbackIndex } from './variableSnapshot/currentVariableActions';
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
  onCommitState,
  onIsCurrent,
  onChanged,
  revision,
}: Pick<VariableSnapshotPanelProps, 'varMgr' | 'onCommitState' | 'onIsCurrent'> & { onChanged: () => void; revision: number }) {
  const { DialogUI, confirm, alert } = useDialog();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
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
    if (!accepted || !alive.current || onIsCurrent && !onIsCurrent()) return;

    const state = varMgr.getState();
    const result = revertGameplayTransaction(state, log.transactionId, {
      tick: state.simulationRuntime?.tick ?? 0,
    });
    // 即使撤销被阻止，也保留内核产生的审计日志，让玩家能看到原因。
    try {
      if (!await onCommitState(result.state as GameState)) { await alert('当前行动仍在处理或旅程已变化，撤销未应用。', { title: '撤销未完成' }); return; }
    } catch {
      if (alive.current && (!onIsCurrent || onIsCurrent())) { onChanged(); await alert('撤销结果已应用，但立即存档失败。请保留页面并继续保存。', { title: '保存失败' }); }
      return;
    }
    if (!alive.current || onIsCurrent && !onIsCurrent()) return;
    onChanged();
    if (result.status !== 'applied') {
      await alert(result.reason || '该事务当前无法撤销。', { title: '撤销未完成' });
    }
  }, [alert, confirm, onChanged, onCommitState, onIsCurrent, varMgr]);

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
  messages, varMgr, onRollbackToSnapshot, onSave, onCommitState, onPrepareStateJSON, onIsCurrent,
}: VariableSnapshotPanelProps) {
  const { DialogUI, alert: dlgAlert, confirm: dlgConfirm } = useDialog();
  const activeManager = useRef(varMgr); activeManager.current = varMgr;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const pendingApply = useRef<AbortController | null>(null);
  const editSources = useRef<Record<string, string>>({});
  const rollbackSource = useRef<{ manager: typeof varMgr; messageId: string; isCurrent: () => boolean } | null>(null);
  useEffect(() => () => { pendingApply.current?.abort(); pendingApply.current = null; }, [varMgr]);
  const currentHost = () => ({ readState: () => varMgr.getState(), prepare: onPrepareStateJSON,
    isCurrent: () => alive.current && activeManager.current === varMgr && (onIsCurrent?.() ?? true) });
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

  const refreshCurrentDraft = useCallback(async () => {
    const host = currentHost();
    if (layerModified.has('current') && !await dlgConfirm('刷新会用最新变量替换当前 JSON 草稿。保留草稿可先复制文本再刷新。', { title: '载入最新变量', confirmText: '替换草稿' })) return;
    if (!host.isCurrent()) return;
    const latest = varMgr.getState();
    editSources.current.current = JSON.stringify(latest);
    setLayerEditTexts(prev => ({ ...prev, current: JSON.stringify(latest, null, 2) }));
    setLayerModified(prev => { const next = new Set(prev); next.delete('current'); return next; });
    setGameplayRevision(prev => prev + 1);
  }, [varMgr, onIsCurrent, layerModified, dlgConfirm]);

  // ─── 层编辑 ───
  const getLayerEditText = useCallback((layer: SnapshotLayer) => {
    if (layerEditTexts[layer.id] !== undefined) return layerEditTexts[layer.id];
    return JSON.stringify(layer.snapshot, null, 2);
  }, [layerEditTexts]);

  const handleLayerEdit = useCallback((layerId: string, text: string) => {
    editSources.current[layerId] ??= JSON.stringify(snapshotLayers.find(layer => layer.id === layerId)?.snapshot ?? varMgr.getState());
    setLayerEditTexts(prev => ({ ...prev, [layerId]: text }));
    setLayerModified(prev => new Set(prev).add(layerId));
  }, [snapshotLayers, varMgr]);

  const handleLoadLatest = useCallback(async (layer: SnapshotLayer) => {
    if (pendingApply.current) return;
    const controller = new AbortController(); pendingApply.current = controller;
    const host = currentHost();
    const proposal = prepareCurrentVariableJSON({ host, json: getLayerEditText(layer),
      expectedState: editSources.current[layer.id] ?? JSON.stringify(layer.snapshot), signal: controller.signal });
    if (!proposal.state) {
      pendingApply.current = null;
      void dlgAlert(proposal.reason || '当前状态无法应用', { title: '应用未完成' }); return;
    }
    try {
      const accepted = await onCommitState(proposal.state);
      if (controller.signal.aborted || !host.isCurrent()) return;
      if (!accepted) { void dlgAlert('当前旅程正在处理行动或已变化，编辑草稿保留。', { title: '应用未完成' }); return; }
      const canonical = varMgr.getState();
      editSources.current[layer.id] = JSON.stringify(canonical);
      setLayerEditTexts(prev => ({ ...prev, [layer.id]: JSON.stringify(canonical, null, 2) }));
      setLayerModified(prev => { const next = new Set(prev); next.delete(layer.id); return next; });
      setGameplayRevision(prev => prev + 1);
    } catch {
      if (!controller.signal.aborted && host.isCurrent()) void dlgAlert('编辑已经应用到当前游戏，但立即存档失败。草稿保留，可继续保存。', { title: '保存失败' });
    } finally { if (pendingApply.current === controller) pendingApply.current = null; }
  }, [varMgr, getLayerEditText, onCommitState, onPrepareStateJSON, onIsCurrent, dlgAlert]);

  const requestRollback = useCallback((layer: SnapshotLayer) => {
    rollbackSource.current = { manager: varMgr, messageId: messages[layer.msgIndex]?.id ?? '', isCurrent: currentHost().isCurrent };
    setConfirmRollback(layer);
  }, [varMgr, messages, onIsCurrent]);

  const handleRollback = useCallback(() => {
    if (!confirmRollback) return;
    const source = rollbackSource.current;
    const index = source && source.manager === varMgr ? resolveCurrentRollbackIndex({ messages,
      messageId: source.messageId, snapshot: confirmRollback.snapshot, isCurrent: source.isCurrent }) : -1;
    if (index < 0 || !onRollbackToSnapshot) {
      void dlgAlert('所选历史记录或旅程已经变化，请重新选择快照。', { title: '恢复未执行' });
    } else onRollbackToSnapshot(index);
    rollbackSource.current = null; setConfirmRollback(null);
  }, [varMgr, messages, onRollbackToSnapshot, confirmRollback, dlgAlert]);

  // ─── 导出 / 导入 ───
  const handleExport = useCallback(() => {
    const data = {
      exportedAt: new Date().toISOString(),
      snapshot: varMgr.getState(),
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
  }, [snapshotLayers, varMgr]);

  const handleImport = useCallback(async (file: File) => {
    pendingApply.current?.abort();
    const controller = new AbortController(); pendingApply.current = controller;
    const host = currentHost();
    try {
      const proposal = await importCurrentVariableJSON({ host, readText: () => file.text(), signal: controller.signal });
      if (controller.signal.aborted || !host.isCurrent()) return;
      if (!proposal.state) { void dlgAlert(proposal.reason || '文件格式不正确', { title: '导入未完成' }); return; }
      const accepted = await onCommitState(proposal.state);
      if (controller.signal.aborted || !host.isCurrent()) return;
      if (!accepted) { void dlgAlert('当前旅程正在处理行动或已变化，导入未应用。', { title: '导入未完成' }); return; }
      setGameplayRevision(prev => prev + 1);
    } catch {
      if (!controller.signal.aborted && host.isCurrent()) void dlgAlert('变量已经应用，但立即存档失败。请保留页面并继续保存。', { title: '保存失败' });
    } finally { if (pendingApply.current === controller) pendingApply.current = null; }
  }, [varMgr, onCommitState, onPrepareStateJSON, onIsCurrent, dlgAlert]);

  return (
    <div className="game-variable-panel">
      {DialogUI}
      <SnapshotToolbar
        snapshotLayers={snapshotLayers}
        onExport={handleExport}
        onImport={handleImport}
        onRefresh={() => void refreshCurrentDraft()}
      />
      <ApiSettingsSection
        varApiPresetId={varApiPresetId}
        onPresetIdChange={setVarApiPresetId}
        onSave={handleSaveApiSettings}
      />
      <GameplayLogSection
        varMgr={varMgr}
        onCommitState={onCommitState}
        onIsCurrent={onIsCurrent}
        onChanged={() => setGameplayRevision(prev => prev + 1)}
        revision={gameplayRevision}
      />
      <SnapshotList
        snapshotLayers={snapshotLayers}
        getLayerEditText={getLayerEditText}
        layerModified={layerModified}
        onLoadLatest={handleLoadLatest}
        onRollbackRequest={requestRollback}
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
