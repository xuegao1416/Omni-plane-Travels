/**
 * 世界动态配置编辑器 — 在 SimSettings 中显示。
 *
 * 注意：周期事件已迁出本面板，改为在「事件中心」作为世界内置事件包编辑
 * （见 src/components/event/PeriodicEventPackEditor）。本编辑器只负责
 * 世界动态的后台配置：安全护栏 + 配置导入导出。
 */

import { useState } from 'react';
import { Copy, ClipboardPaste, ChevronDown, ChevronRight } from 'lucide-react';
import type { WorldDynamicsConfig } from '../../../../modules/schema';

interface SimulationRuleEditorProps {
  rules: WorldDynamicsConfig;
  onChange: (rules: WorldDynamicsConfig) => void;
}

export default function SimulationRuleEditor({ rules, onChange }: SimulationRuleEditorProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['guardrails']));
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // ── 安全护栏操作 ──
  const updateGuardrails = (patch: Partial<WorldDynamicsConfig['narrativeGuardrails']>) => {
    onChange({
      ...rules,
      narrativeGuardrails: { ...rules.narrativeGuardrails, ...patch },
    });
  };

  // ── 导入导出 ──
  const handleExport = async () => {
    const exportData = {
      version: 1,
      name: '自定义演化规则',
      description: '从游戏内导出的演化规则',
      rules,
    };
    const json = JSON.stringify(exportData, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      alert('规则已复制到剪贴板！');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = json;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert('规则已复制到剪贴板！');
    }
  };

  const handleImport = () => {
    if (!importText.trim()) return;
    try {
      const parsed = JSON.parse(importText);
      if (parsed.rules && typeof parsed.rules === 'object') {
        onChange(parsed.rules);
        setImportText('');
        setShowImport(false);
        alert('规则导入成功！');
      } else {
        alert('导入失败：格式不正确，需要包含 rules 字段');
      }
    } catch {
      alert('导入失败：JSON 解析错误');
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setImportText(text);
    } catch {
      alert('无法读取剪贴板，请手动粘贴');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 导入导出按钮 */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={handleExport} className="btn-ghost btn-sm" style={{ flex: 1, minWidth: '120px' }}>
          <Copy size={14} style={{ marginRight: '4px' }} />
          导出规则
        </button>
        <button onClick={() => setShowImport(!showImport)} className="btn-ghost btn-sm" style={{ flex: 1, minWidth: '120px' }}>
          <ClipboardPaste size={14} style={{ marginRight: '4px' }} />
          导入规则
        </button>
      </div>

      {/* 导入面板 */}
      {showImport && (
        <div style={{
          padding: '12px',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder="粘贴规则 JSON..."
            className="input-field"
            style={{ minHeight: '100px', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handlePasteFromClipboard} className="btn-ghost btn-sm">
              从剪贴板粘贴
            </button>
            <button onClick={handleImport} className="btn-primary btn-sm" style={{ flex: 1 }}>
              确认导入
            </button>
            <button onClick={() => { setShowImport(false); setImportText(''); }} className="btn-ghost btn-sm">
              取消
            </button>
          </div>
        </div>
      )}

      {/* ── 安全护栏 ── */}
      <div>
        <button
          onClick={() => toggleSection('guardrails')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px 0', width: '100%',
          }}
        >
          {expandedSections.has('guardrails') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            安全护栏
          </span>
        </button>

        {expandedSections.has('guardrails') && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '8px',
            paddingLeft: '22px',
            fontSize: 'var(--font-size-xs)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>属性最大变动:</span>
              <input
                type="number"
                value={rules.narrativeGuardrails?.maxDeltaPerStat?.['*'] ?? 20}
                onChange={e => updateGuardrails({
                  maxDeltaPerStat: { ...(rules.narrativeGuardrails?.maxDeltaPerStat ?? {}), '*': parseInt(e.target.value) || 20 },
                })}
                className="input-field"
                style={{ width: '80px' }}
              />
              <span style={{ color: 'var(--text-muted)' }}>/ 次</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>资源最大变动:</span>
              <input
                type="number"
                value={rules.narrativeGuardrails?.maxDeltaPerResource?.['*'] ?? 10}
                onChange={e => updateGuardrails({
                  maxDeltaPerResource: { ...(rules.narrativeGuardrails?.maxDeltaPerResource ?? {}), '*': parseInt(e.target.value) || 10 },
                })}
                className="input-field"
                style={{ width: '80px' }}
              />
              <span style={{ color: 'var(--text-muted)' }}>/ 次</span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={rules.narrativeGuardrails?.allowCreateResources ?? true}
                onChange={e => updateGuardrails({ allowCreateResources: e.target.checked })}
              />
              <span style={{ color: 'var(--text-primary)' }}>允许 AI 创建新资源</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
