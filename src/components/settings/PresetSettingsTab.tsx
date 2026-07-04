// 预设管理 Tab — 预设列表 + 覆盖层编辑器（条目 + 正则一体化）
import { useState, useRef, useCallback } from 'react';
import { FileText, Upload } from 'lucide-react';
import { usePresetStore } from '@/stores/presetStore';
import { getBuiltinPresets, getBuiltinPreset } from '@/data/builtinPresets';
import type { PresetPack } from '@/data/builtinPresets';
import { exportPresetJSON, parsePresetJSON, downloadJSON } from '@/utils/presetIO';
import { Button } from './SettingsUIComponents';
import { useDialog } from '../shared/Dialog';
import { PresetCard } from './presetSettings/PresetCard';
import { PresetEditorOverlay } from './presetSettings/PresetEditorOverlay';

export default function PresetSettingsTab() {
  const { userPresets, activePresetId, builtinOverrides, savePreset, deletePreset, setActivePreset, resetToDefault, saveBuiltinOverride, restoreBuiltinDefaults } = usePresetStore();
  const { DialogUI, confirm: dlgConfirm } = useDialog();
  const [editingPreset, setEditingPreset] = useState<PresetPack | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const builtinPresets = getBuiltinPresets();
  const isActiveDefault = activePresetId === null;

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const result = parsePresetJSON(text);
      if (result.ok) {
        savePreset(result.data);
        setActivePreset(result.data.id);
        setEditingPreset(result.data);
        setError('');
      } else {
        setError(result.error);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [savePreset, setActivePreset]);

  const handleExport = useCallback((pack: PresetPack) => {
    const json = exportPresetJSON(pack);
    downloadJSON(json, `preset_${pack.name || 'unnamed'}.json`);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!await dlgConfirm('确定要删除这个预设吗？', { danger: true, confirmText: '删除' })) return;
    deletePreset(id);
    if (editingPreset?.id === id) setEditingPreset(null);
  }, [deletePreset, editingPreset, dlgConfirm]);

  if (!editingPreset) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {DialogUI}
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <FileText size={18} />
          <span style={{ fontWeight: '600', fontSize: 'var(--font-size-lg)' }}>预设管理</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button onClick={() => fileRef.current?.click()} icon={<Upload size={14} />}>导入预设</Button>
        </div>
        {error && (
          <div style={{ padding: '8px 12px', background: 'var(--danger-dim, #3a1c1c)', border: '1px solid var(--danger)', borderRadius: '6px', fontSize: 'var(--font-size-sm)', color: 'var(--danger)' }}>{error}</div>
        )}
        {builtinPresets.map(bp => (
          <PresetCard
            key={bp.id}
            name={`${bp.name}（内置）`}
            desc={bp.description || ''}
            promptCount={bp.prompts?.length || 0}
            regexCount={bp.regexScripts?.length || 0}
            active={bp.id === 'default' ? isActiveDefault : activePresetId === bp.id}
            builtin
            onSelect={() => { if (bp.id === 'default') resetToDefault(); else setActivePreset(bp.id); }}
            onExport={() => handleExport(bp)}
            onEdit={() => setEditingPreset(bp)}
          />
        ))}
        {userPresets.map(pack => (
          <PresetCard
            key={pack.id}
            name={pack.name}
            desc={pack.description || ''}
            promptCount={pack.prompts?.length || 0}
            regexCount={pack.regexScripts?.length || 0}
            active={activePresetId === pack.id}
            onSelect={() => setActivePreset(pack.id)}
            onExport={() => handleExport(pack)}
            onDelete={() => handleDelete(pack.id)}
            onEdit={() => setEditingPreset(pack)}
          />
        ))}
      </div>
    );
  }

  const isBuiltin = builtinPresets.some(bp => bp.id === editingPreset.id);
  const displayPreset = isBuiltin ? {
    ...editingPreset,
    prompts: editingPreset.prompts.map(p => {
      const override = builtinOverrides[editingPreset.id]?.[p.identifier];
      return override !== undefined ? { ...p, enabled: override } : p;
    }),
  } : editingPreset;

  return (
    <PresetEditorOverlay
      preset={displayPreset}
      builtin={isBuiltin}
      onClose={() => setEditingPreset(null)}
      onSave={(updated) => {
        if (isBuiltin) {
          for (const p of updated.prompts) {
            const original = editingPreset.prompts.find(op => op.identifier === p.identifier);
            if (original && p.enabled !== original.enabled) {
              saveBuiltinOverride(editingPreset.id, p.identifier, p.enabled);
            }
          }
          const newDisplay = {
            ...editingPreset,
            prompts: editingPreset.prompts.map(p => {
              const override = builtinOverrides[editingPreset.id]?.[p.identifier];
              const newEntry = updated.prompts.find(up => up.identifier === p.identifier);
              if (newEntry) return { ...p, enabled: newEntry.enabled };
              return override !== undefined ? { ...p, enabled: override } : p;
            }),
          };
          setEditingPreset(newDisplay);
          setActivePreset(editingPreset.id);
        } else {
          savePreset(updated);
          setActivePreset(updated.id);
          setEditingPreset(updated);
        }
      }}
      onRestoreDefaults={isBuiltin ? () => {
        restoreBuiltinDefaults(editingPreset.id);
        const original = getBuiltinPreset(editingPreset.id);
        setEditingPreset(original);
        setActivePreset(editingPreset.id);
      } : undefined}
    />
  );
}
