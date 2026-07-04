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
}
