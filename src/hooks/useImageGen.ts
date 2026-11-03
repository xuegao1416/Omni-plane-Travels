// Shared image requests; the existing stores own configuration, task state and paid bytes.
import { useCallback, useEffect } from 'react';
import { useImageStore } from '@/stores/imageStore';
import { useSaveStore, captureCurrentSave } from '@/stores/saveStore';
import { imageDb } from '@/storage/imageDb';
import { generateConfiguredImage, fetchComfyUIData, getGenerationConfigError } from '@/api/imageGen';
import { ImageTaskQueue, type ImageTaskOptions } from '@/api/imageTasks';
import type { ImageGenConfig } from '@/api/imageGenTypes';

const imageQueue = new ImageTaskQueue({
  generate: generateConfiguredImage,
  add: task => useImageStore.getState().addTask(task),
  update: (id, patch) => useImageStore.getState().updateTask(id, patch),
  tasks: () => useImageStore.getState().tasks,
  save: async (record, isCurrent) => {
    await imageDb.saveGenerated(record, isCurrent);
  },
  retain: record => imageDb.retainGenerated(record),
  read: key => imageDb.getBlob(key),
  records: () => imageDb.getAllBlobsStrict(),
});

export function useImageGen() {
  const config = useImageStore(s => s.config);
  const tasks = useImageStore(s => s.tasks);
  const comfyData = useImageStore(s => s.comfyData);
  useEffect(() => { void imageQueue.restore().catch(error => console.warn('[生图] 已完成任务恢复失败:', error)); }, []);

  const generateAndSave = useCallback((prompt: string, options: ImageTaskOptions = {}, onStatusChange?: (status: string) => void) => {
    const sessionId = options.sessionId ?? useSaveStore.getState().currentSaveId ?? undefined;
    const isCurrent = () => {
      if (sessionId && useSaveStore.getState().currentSaveId !== sessionId) return false;
      if (options.isCurrent && !options.isCurrent()) return false;
      if (options.messageId) {
        try { return captureCurrentSave().messages.some(message => message.id === options.messageId); }
        catch { return false; }
      }
      return true;
    };
    return imageQueue.generate(prompt, config, { ...options, sessionId, isCurrent }, onStatusChange);
  }, [config]);

  const hasRecoverableImage = useCallback((prompt: string, storageKey: string) => Boolean(imageQueue.recoverable(prompt, {
    storageKey, sessionId: useSaveStore.getState().currentSaveId ?? undefined,
  })), []);

  const findRecoverableImage = useCallback((storageKey: string) => tasks.findLast(task => task.deliveryKey === storageKey
    && task.hasResult && task.status === 'failed' && task.sessionId === (useSaveStore.getState().currentSaveId ?? undefined)), [tasks]);
  const reuseImageTask = useCallback((id: string, options: ImageTaskOptions = {}) => {
    const sessionId = useSaveStore.getState().currentSaveId;
    return imageQueue.reuse(id, { ...options, isCurrent: () => useSaveStore.getState().currentSaveId === sessionId
      && (!options.isCurrent || options.isCurrent()) });
  }, []);

  const deleteImageTask = useCallback(async (id: string) => {
    const task = useImageStore.getState().tasks.find(task => task.id === id);
    if (!task) return;
    if (task.status === 'queued' || task.status === 'generating') throw new Error('图片正在生成，请完成或取消后删除');
    if (task.deliveryKey && task.deliveryKey !== id) {
      const delivered = await imageDb.getBlob(task.deliveryKey);
      if (delivered?.generation?.id === id) await imageDb.deleteBlob(task.deliveryKey);
    }
    await imageDb.deleteBlob(id);
    useImageStore.getState().removeTask(id);
  }, []);

  const validateConfig = useCallback((override?: Partial<ImageGenConfig>) => getGenerationConfigError(override || config), [config]);
  const loadComfyUIData = useCallback(async (apiUrl?: string) => {
    const url = apiUrl || config.comfyUrl;
    if (!url) return;
    const data = await fetchComfyUIData(url);
    useImageStore.getState().setComfyData(data);
    return data;
  }, [config.comfyUrl]);

  return { config, tasks, comfyData, generateAndSave, deleteImageTask,
    hasRecoverableImage, findRecoverableImage, reuseImageTask, validateConfig, loadComfyUIData };
}
