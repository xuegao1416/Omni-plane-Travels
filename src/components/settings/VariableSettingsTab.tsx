// ============================================================
// 变量系统设置 — 数据快照管理（分层、编辑、回滚、导入导出）
// ============================================================

import { useState, useMemo, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { useDialog } from '../shared/Dialog';
import {
  BarChart3, Cpu, Layers, Download, Upload,
  ChevronDown, ChevronRight, RotateCcw, Save,
  ChevronLeft, ChevronRight as ChevronRightNav, Bot,
} from 'lucide-react';
import type { GameState } from '../../schema/variables';
import type { VariableManager } from '../../engine/variableManager';
import type { ChatMessage } from '../../engine/types';
import { Section, SettingRow, Select, Toggle } from './SettingsUIComponents';
import { type ApiPreset, VARIABLE_ENABLED_KEY } from './apiPresetUtils';
import { STORAGE_KEYS } from '@/config/storageKeys';

// ============================================================
//  类型
// ============================================================

export interface VariableSettingsRef {
  getValues: () => { variableEnabled: boolean; auxPresetId: string; varDelay: number; varRetries: number; varModel: string };
}

interface SnapshotLayer {
  id: string;
  msgIndex: number;
  snapshot: GameState;
  snapshotTime: number;
  content?: string;
}

interface Props {
  variableManager: VariableManager;
  presets: ApiPreset[];
  initialAuxPresetId: string;
  messages: ChatMessage[];
}

const PAGE_SIZE = 20;

// ============================================================
//  主组件
// ============================================================

const VariableSettingsTab = forwardRef<VariableSettingsRef, Props>(
  ({ variableManager, presets, initialAuxPresetId, messages }, ref) => {
    const { DialogUI, alert: dlgAlert } = useDialog();
    // ─── 设置状态 ───
    const [variableEnabled, setVariableEnabled] = useState(() => {
      try { return localStorage.getItem(VARIABLE_ENABLED_KEY) !== 'false'; } catch { return true; }
    });
    const [auxPresetId, setAuxPresetId] = useState(initialAuxPresetId);
    const [varDelay, setVarDelay] = useState<number>(() => {
      try { return Math.max(0, Math.min(10, parseFloat(localStorage.getItem(STORAGE_KEYS.PIPELINE_VARIABLE_DELAY) || '1') || 1)); } catch { return 1; }
    });
    const [varRetries, setVarRetries] = useState<number>(() => {
      try { return Math.max(0, Math.min(5, parseInt(localStorage.getItem(STORAGE_KEYS.PIPELINE_VARIABLE_RETRIES) || '3') || 3)); } catch { return 3; }
    });
    const [varModel, setVarModel] = useState<string>(() => {
      try { return localStorage.getItem(STORAGE_KEYS.PIPELINE_VARIABLE_MODEL) || ''; } catch { return ''; }
    });

    useImperativeHandle(ref, () => ({
      getValues: () => ({ variableEnabled, auxPresetId, varDelay, varRetries, varModel }),
    }));

    // ─── 快照管理状态 ───
    const [page, setPage] = useState(0);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [editTexts, setEditTexts] = useState<Record<string, string>>({});
    const [modified, setModified] = useState<Set<string>>(new Set());
    const [confirmLayer, setConfirmLayer] = useState<SnapshotLayer | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const importRef = useRef<HTMLInputElement>(null);

    // ─── 构建快照层级 ───
    const layers = useMemo<SnapshotLayer[]>(() => {
      const result: SnapshotLayer[] = [];
      // 最新层：当前状态
      result.push({
        id: 'current', msgIndex: -1,
        snapshot: variableManager.getState(),
        snapshotTime: Date.now(), content: '当前状态（最新）',
      });
      // 历史层：从消息中提取（用轮次命名）
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.snapshot) {
          result.push({
            id: `msg-${i}`, msgIndex: i,
            snapshot: msg.snapshot as GameState,
            snapshotTime: (msg as any).snapshotTime || msg.timestamp || Date.now(),
            content: `第 ${msg.round} 轮`,
          });
        }
      }
      return result;
    }, [messages, variableManager, refreshKey]);

    const totalPages = Math.ceil(layers.length / PAGE_SIZE);
    const paged = layers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    // ─── 操作 ───
    const toggleExpand = useCallback((id: string) => {
      setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }, []);

    const getEditText = useCallback((layer: SnapshotLayer) => {
      if (editTexts[layer.id] !== undefined) return editTexts[layer.id];
      return JSON.stringify(layer.snapshot, null, 2);
    }, [editTexts]);

    const handleEdit = useCallback((id: string, text: string) => {
      setEditTexts(prev => ({ ...prev, [id]: text }));
      setModified(prev => new Set(prev).add(id));
    }, []);

    const handleLoad = useCallback((layer: SnapshotLayer) => {
      const text = getEditText(layer);
      try {
        if (variableManager.setStateFromJSON(text)) {
          setModified(prev => { const n = new Set(prev); n.delete(layer.id); return n; });
          setRefreshKey(k => k + 1);
        }
      } catch { dlgAlert('JSON 格式错误', { title: '格式错误' }); }
    }, [variableManager, getEditText]);

    const handleRollback = useCallback((layer: SnapshotLayer) => {
      variableManager.restoreSnapshot(layer.snapshot);
      setConfirmLayer(null);
      setRefreshKey(k => k + 1);
    }, [variableManager]);

    const handleExport = useCallback(() => {
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), current: variableManager.getState() }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `variables-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
    }, [variableManager]);

    const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const snap = data.current || data.snapshot || data;
        if (typeof snap === 'object' && snap !== null) { variableManager.restoreSnapshot(snap); setRefreshKey(k => k + 1); }
      } catch { dlgAlert('导入失败', { title: '导入失败' }); }
      if (importRef.current) importRef.current.value = '';
    }, [variableManager]);

    const fmtTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return (
      <div style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {DialogUI}
        {/* 基础设置 */}
        <Section icon={<BarChart3 size={15} />} title="变量系统">
          <SettingRow label="启用变量系统" desc="AI 回复后自动提取并更新游戏变量">
            <Toggle value={variableEnabled} onChange={setVariableEnabled} />
          </SettingRow>
        </Section>

        {variableEnabled && (
          <>
            <Section icon={<Cpu size={15} />} title="变量提取 API">
              <SettingRow label="提取方式" desc="选择用哪个 API 从回复中提取变量更新">
                <Select
                  options={[{ label: '跟随主 API', value: '' }, ...presets.map(p => ({ label: p.name, value: p.id }))]}
                  value={auxPresetId} onChange={v => setAuxPresetId(v)} width="160px"
                />
              </SettingRow>
              <SettingRow label="提取模型" desc="留空使用所选 API 的模型，填写则覆盖（可用轻量模型加速）">
                <input
                  type="text"
                  value={varModel}
                  onChange={e => setVarModel(e.target.value)}
                  placeholder="留空=默认模型"
                  style={{
                    width: '160px', padding: '4px 8px',
                    fontSize: 'var(--font-size-sm)',
                    background: 'var(--bg-primary)', border: '1px solid var(--border)',
                    borderRadius: '6px', color: 'var(--text-primary)',
                  }}
                />
              </SettingRow>
            </Section>

            <Section icon={<BarChart3 size={15} />} title="提取参数">
              <SettingRow label="提取延迟" desc="正文显示后等待多久再调用变量 API">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="range" min="0" max="10" step="0.5" value={varDelay} onChange={e => setVarDelay(parseFloat(e.target.value))} style={{ width: '120px' }} />
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', width: '36px' }}>{varDelay}s</span>
                </div>
              </SettingRow>
              <SettingRow label="失败重试" desc="变量提取失败后重试的次数">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="range" min="0" max="5" step="1" value={varRetries} onChange={e => setVarRetries(parseInt(e.target.value))} style={{ width: '120px' }} />
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', width: '36px' }}>{varRetries}次</span>
                </div>
              </SettingRow>
            </Section>

            {/* ═══ 数据快照 ═══ */}
            <Section icon={<Layers size={15} />} title="数据快照">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>共 {layers.length} 层快照</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
                  <button onClick={handleExport} title="导出" style={btnStyle}><Download size={13} /></button>
                  <button onClick={() => importRef.current?.click()} title="导入" style={btnStyle}><Upload size={13} /></button>
                </div>
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '6px 0' }}>
                  <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={btnStyle}><ChevronLeft size={13} /></button>
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>{page + 1} / {totalPages}</span>
                  <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={btnStyle}><ChevronRightNav size={13} /></button>
                </div>
              )}

              {/* 层列表 */}
              <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {paged.map((layer, idx) => {
                  const isExpanded = expanded.has(layer.id);
                  const isModified = modified.has(layer.id);
                  const isLatest = idx === 0 && page === 0;
                  const gIdx = page * PAGE_SIZE + idx;

                  return (
                    <div key={layer.id} style={{
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                      overflow: 'hidden', background: isLatest ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                    }}>
                      <div onClick={() => toggleExpand(layer.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' }}>
                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: '700', color: isLatest ? 'var(--accent)' : 'var(--text-muted)', minWidth: 24 }}>#{gIdx}</span>
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{fmtTime(layer.snapshotTime)}</span>
                        {layer.content && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer.content}</span>}
                        {isLatest && <span style={{ padding: '1px 5px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-xs)', fontWeight: '600', background: 'var(--accent)', color: '#fff' }}>最新</span>}
                        {isModified && <span style={{ padding: '1px 5px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-xs)', fontWeight: '600', background: '#f0883e', color: '#fff' }}>已修改</span>}
                        {isLatest ? (
                          <button onClick={e => { e.stopPropagation(); handleLoad(layer); }} title="应用编辑" style={{ ...btnStyle, opacity: isModified ? 1 : 0.3 }}><Save size={12} /></button>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); setConfirmLayer(layer); }} title="回滚" style={btnStyle}><RotateCcw size={12} /></button>
                        )}
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                          <textarea value={getEditText(layer)} onChange={e => handleEdit(layer.id, e.target.value)} readOnly={!isLatest} spellCheck={false}
                            style={{ width: '100%', minHeight: 140, maxHeight: 280, padding: 6, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 'var(--font-size-xs)', fontFamily: 'monospace', lineHeight: 1.5, resize: 'vertical', outline: 'none' }}
                          />
                          {isLatest && <button onClick={() => handleLoad(layer)} style={{ marginTop: 4, padding: '3px 12px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: '#fff', fontSize: 'var(--font-size-xs)', fontWeight: '600', cursor: 'pointer' }}>应用编辑</button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>

            {/* 回滚确认 */}
            {confirmLayer && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div onClick={() => setConfirmLayer(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
                <div style={{ position: 'relative', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 340, textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '600', marginBottom: 8 }}>确认回滚？</div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 16 }}>
                    回滚到第 {confirmLayer.msgIndex + 1} 层
                    <div style={{ color: '#f0883e', marginTop: 4 }}>⚠️ 将覆盖当前变量状态</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button onClick={() => setConfirmLayer(null)} style={{ padding: '5px 16px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>取消</button>
                    <button onClick={() => handleRollback(confirmLayer)} style={{ padding: '5px 16px', border: 'none', borderRadius: 'var(--radius-md)', background: '#da3633', color: '#fff', cursor: 'pointer', fontSize: 'var(--font-size-sm)', fontWeight: '600' }}>确认回滚</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  },
);

export default VariableSettingsTab;

const btnStyle: React.CSSProperties = {
  width: 24, height: 24,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 4px)',
  background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
  cursor: 'pointer', padding: 0,
};
