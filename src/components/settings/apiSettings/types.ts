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
