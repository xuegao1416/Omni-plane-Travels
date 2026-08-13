import type { ApiConfig, ApiProvider } from '../../../api/types';
import type { ApiPreset } from '../apiPresetUtils';

export interface ApiSettingsRef {
  getValues: () => { config: ApiConfig };
}

export interface ApiSettingsTabProps {
  initialConfig: ApiConfig | null;
  t: (key: string) => string;
  onSave?: () => void;
  onBack?: () => void;
}

export type ConfigSetter = <K extends keyof ApiConfig>(key: K, val: ApiConfig[K]) => void;

export interface ProviderFormProps {
  config: ApiConfig;
  set: ConfigSetter;
  models: string[];
  setModels: (models: string[]) => void;
  loadingModels: boolean;
  onFetchModels: () => void;
  presets: ApiPreset[];
  setPresets: (presets: ApiPreset[]) => void;
}

export const PROVIDERS: { value: ApiProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'google', label: 'Google AI' },
  { value: 'custom', label: '自定义' },
];

export const REASONING_OPTIONS = ['关闭', 'low', 'medium', 'high'];

export const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '10px 16px',
  borderBottom: '1px solid var(--border)', minHeight: '44px',
  flexWrap: 'wrap', gap: '8px',
};

/** 警告/提示条样式 - 用于设置页中突出'流式响应'等关键开关的警告 */
export const warningStyle: React.CSSProperties = {
  margin: '10px 16px',
  padding: '10px 14px',
  background: 'rgba(217, 119, 6, 0.12)',
  border: '1px solid rgba(217, 119, 6, 0.45)',
  borderLeft: '4px solid #d97706',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  lineHeight: 1.55,
};
