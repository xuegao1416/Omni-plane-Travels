import { useCallback } from 'react';
import type { MemorySystemConfig } from '../../../memory/types';

/**
 * 提供记忆系统配置的各个子模块更新函数，以及派生值（isSimple / modeLabel / configDesc）。
 */
export function useMemoryConfig(
  localConfig: MemorySystemConfig,
  setLocalConfig: React.Dispatch<React.SetStateAction<MemorySystemConfig>>,
) {
  const updateConfig = useCallback((patch: Record<string, unknown>) => {
    setLocalConfig(prev => ({ ...prev, ...patch } as MemorySystemConfig));
  }, [setLocalConfig]);

  const updateWritePipeline = useCallback((patch: Record<string, unknown>) => {
    setLocalConfig(prev => ({
      ...prev,
      writePipeline: { ...prev.writePipeline, ...patch },
    }));
  }, [setLocalConfig]);

  const updateRetrieval = useCallback((patch: Record<string, unknown>) => {
    setLocalConfig(prev => ({
      ...prev,
      retrieval: { ...prev.retrieval, ...patch },
    }));
  }, [setLocalConfig]);

  const updateCompiler = useCallback((patch: Record<string, unknown>) => {
    setLocalConfig(prev => ({
      ...prev,
      compiler: { ...prev.compiler, ...patch },
    }));
  }, [setLocalConfig]);

  const updateRetention = useCallback((patch: Record<string, unknown>) => {
    setLocalConfig(prev => ({
      ...prev,
      retention: { ...prev.retention, ...patch },
    }));
  }, [setLocalConfig]);

  // ─── 派生值 ───
  const isSimple = localConfig.memoryMode === 'simple';
  const modeLabel = isSimple ? '简单模式' : '满血模式';
  const configDesc = isSimple
    ? '简单模式仅保留本地热态编译与记忆检索规划设置。'
    : '写入记忆层与向量化设置并列显示，下方为检索记忆层。';

  return {
    updateConfig,
    updateWritePipeline,
    updateRetrieval,
    updateCompiler,
    updateRetention,
    isSimple,
    modeLabel,
    configDesc,
  };
}
