// 生图设置子组件共享类型
import type { ImageGenConfig } from '@/api/imageGenTypes';

/** updateConfig 泛型函数签名 */
export type UpdateConfigFn = <K extends keyof ImageGenConfig>(key: K, value: ImageGenConfig[K]) => void;

/** 所有引擎配置子组件的基础 props */
export interface ConfigSectionProps {
  config: ImageGenConfig;
  updateConfig: UpdateConfigFn;
}
