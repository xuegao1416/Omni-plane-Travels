import { useState, useRef, useCallback } from 'react';
import { FileText, Plus, Upload, X } from 'lucide-react';
import type { PresetPromptEntry } from '@/data/builtinPresets';
import { getBuiltinPreset } from '@/data/builtinPresets';
import type { RegexScript } from '@/utils/regexScripts';
import { parseRegexScriptsJSON } from '@/utils/presetIO';
import { v4 as uuid } from 'uuid';
import { Button } from '../SettingsUIComponents';
import { useDialog } from '../../shared/Dialog';
import type { PresetEditorOverlayProps } from './types';
import { iconBtnStyle } from './constants';
import { PromptEntry } from './PromptEntry';
import { RegexEntry } from './RegexEntry';

export function PresetEditorOverlay({ preset, builtin, onClose, onSave, onRestoreDefaults }: PresetEditorOverlayProps) {
  const { DialogUI, confirm: dlgConfirm } = useDialog();
  const [tab, setTab] = useState<'prompts' | 'regex'>('prompts');
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [expandedRegex, setExpandedRegex] = useState<number | null>(null);
  const regexFileRef = useRef<HTMLInputElement>(null);

  // 恢复内置预设默认值
  const handleRestoreDefaults = useCallback(async () => {
    if (!await dlgConfirm('确定要恢复默认设置吗？所有条目将重置为初始状态。', { confirmText: '恢复默认' })) return;
    if (onRestoreDefaults) {
      onRestoreDefaults();
    } else {
      const original = getBuiltinPreset(preset.id);
      onSave({ ...original, builtin: true });
    }
  }, [preset.id, onSave, onRestoreDefaults, dlgConfirm]);

  // ─── 条目操作 ───
  const togglePrompt = useCallback((identifier: string) => {
    const prompts = preset.prompts.map(p =>
      p.identifier === identifier ? { ...p, enabled: !p.enabled } : p
    );
    onSave({ ...preset, prompts });
  }, [preset, onSave]);

  const updatePrompt = useCallback((identifier: string, patch: Partial<PresetPromptEntry>) => {
    const prompts = preset.prompts.map(p =>
      p.identifier === identifier ? { ...p, ...patch } : p
    );
    onSave({ ...preset, prompts });
  }, [preset, onSave]);

  const addPrompt = useCallback(() => {
    const id = `custom_${uuid().slice(0, 8)}`;
    const maxOrder = preset.prompts.reduce((max, p) => Math.max(max, p.order), 0);
    const newEntry: PresetPromptEntry = {
      identifier: id,
      name: '新条目',
      role: 'system',
      content: '',
      enabled: true,
      triggerMode: 'blue',
      order: maxOrder + 1,
    };
    onSave({ ...preset, prompts: [...preset.prompts, newEntry] });
    setExpandedPrompt(id);
  }, [preset, onSave]);

  const deletePrompt = useCallback((identifier: string) => {
    onSave({ ...preset, prompts: preset.prompts.filter(p => p.identifier !== identifier) });
    if (expandedPrompt === identifier) setExpandedPrompt(null);
  }, [preset, onSave, expandedPrompt]);

  // ─── 正则操作 ───
  const addRegex = useCallback(() => {
    const newScript: RegexScript = {
      id: uuid(), scriptName: '新正则', findRegex: '', replaceString: '',
      placement: [2], disabled: false, markdownOnly: false, promptOnly: false,
    };
    onSave({ ...preset, regexScripts: [...preset.regexScripts, newScript] });
    setExpandedRegex(preset.regexScripts.length);
  }, [preset, onSave]);

  const updateRegex = useCallback((idx: number, patch: Partial<RegexScript>) => {
    const scripts = [...preset.regexScripts];
    scripts[idx] = { ...scripts[idx], ...patch };
    onSave({ ...preset, regexScripts: scripts });
  }, [preset, onSave]);

  const deleteRegex = useCallback((idx: number) => {
    onSave({ ...preset, regexScripts: preset.regexScripts.filter((_, i) => i !== idx) });
    if (expandedRegex === idx) setExpandedRegex(null);
  }, [preset, onSave, expandedRegex]);

  const handleImportRegex = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseRegexScriptsJSON(String(reader.result || ''));
      if (result.ok) {
        onSave({ ...preset, regexScripts: [...preset.regexScripts, ...result.data] });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [preset, onSave]);

  const sortedPrompts = [...(preset.prompts || [])].sort((a, b) => a.order - b.order);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      {DialogUI}
      <div style={{
        width: '90vw', maxWidth: '720px', height: '90vh',
        background: 'var(--bg-primary)', borderRadius: '12px',
        border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        marginTop: '5vh',
      }} onClick={e => e.stopPropagation()}>

        {/* ─── 头部 ─── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <FileText size={18} />
          <span style={{ fontWeight: '600', fontSize: 'var(--font-size-lg)', flex: 1 }}>
            {preset.name}{builtin && '（内置）'}
          </span>
          {builtin && (
            <button onClick={handleRestoreDefaults} style={{ ...iconBtnStyle, fontSize: 'var(--font-size-xs)', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }} title="恢复默认">
              🔄 恢复默认
            </button>
          )}
          <button onClick={onClose} style={iconBtnStyle}><X size={18} /></button>
        </div>

        {/* ─── Tab 切换 ─── */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <button
            onClick={() => setTab('prompts')}
            style={{
              flex: 1, padding: '10px', background: 'none', border: 'none',
              borderBottom: tab === 'prompts' ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === 'prompts' ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: '600', fontSize: 'var(--font-size-sm)', cursor: 'pointer',
            }}
          >
            📝 提示词条目 ({sortedPrompts.length})
          </button>
          <button
            onClick={() => setTab('regex')}
            style={{
              flex: 1, padding: '10px', background: 'none', border: 'none',
              borderBottom: tab === 'regex' ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === 'regex' ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: '600', fontSize: 'var(--font-size-sm)', cursor: 'pointer',
            }}
          >
            🔧 正则脚本 ({preset.regexScripts?.length || 0})
          </button>
        </div>

        {/* ─── 内容区 ─── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>

          {/* === 条目 Tab === */}
          {tab === 'prompts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {!builtin && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <Button onClick={addPrompt} icon={<Plus size={14} />}>新增条目</Button>
                </div>
              )}
              {sortedPrompts.map(p => (
                <PromptEntry
                  key={p.identifier}
                  entry={p}
                  expanded={expandedPrompt === p.identifier}
                  builtin={builtin}
                  onToggleExpand={() => setExpandedPrompt(expandedPrompt === p.identifier ? null : p.identifier)}
                  onToggle={() => togglePrompt(p.identifier)}
                  onUpdate={(patch) => updatePrompt(p.identifier, patch)}
                  onDelete={() => deletePrompt(p.identifier)}
                />
              ))}
            </div>
          )}

          {/* === 正则 Tab === */}
          {tab === 'regex' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <input ref={regexFileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportRegex} />

              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                {!builtin && <Button onClick={addRegex} icon={<Plus size={14} />}>新增正则</Button>}
                {!builtin && <Button onClick={() => regexFileRef.current?.click()} icon={<Upload size={14} />}>导入正则</Button>}
              </div>

              {(preset.regexScripts || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  暂无正则脚本
                </div>
              ) : (
                (preset.regexScripts || []).map((script, idx) => (
                  <RegexEntry
                    key={script.id}
                    script={script}
                    expanded={expandedRegex === idx}
                    builtin={builtin}
                    onToggleExpand={() => setExpandedRegex(expandedRegex === idx ? null : idx)}
                    onUpdate={(patch) => updateRegex(idx, patch)}
                    onDelete={() => deleteRegex(idx)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
