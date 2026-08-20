import type { PresetPack } from '@/data/builtinPresets';

export interface PresetCardProps {
  name: string;
  desc: string;
  promptCount: number;
  regexCount: number;
  active: boolean;
  builtin?: boolean;
  onSelect: () => void;
  onExport: () => void;
  onDelete?: () => void;
  onEdit: () => void;
}

export interface PresetEditorOverlayProps {
  preset: PresetPack;
  builtin: boolean;
  onClose: () => void;
  onSave: (p: PresetPack) => void;
  onRestoreDefaults?: () => void;
  /** 内置预设中允许用户编辑内容的条目标识符 */
  editableContentIdentifiers?: string[];
}
