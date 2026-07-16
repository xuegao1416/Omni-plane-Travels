// 生图 React Hook — 队列、生成、存储、URL 缓存

import { useRef, useCallback } from 'react';
import { useImageStore } from '@/stores/imageStore';
import { imageDb } from '@/storage/imageDb';
import {
  generateConfiguredImage,
  fetchComfyUIData,
  getGenerationConfigError,
  resolvePromptsForEngine,
} from '@/api/imageGen';
import type { ImageTask, ImageCategory, ImageGenConfig } from '@/api/imageGenTypes';

// ─── 全局队列（跨组件共享） ───

let globalQueueRunning = false;
const globalQueue: Array<{
  taskFn: () => Promise<unknown>;
  onStatusChange?: (status: string) => void;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}> = [];

function processQueue() {
  if (globalQueueRunning || globalQueue.length === 0) return;
  globalQueueRunning = true;

  const task = globalQueue.shift()!;
  if (task.onStatusChange) task.onStatusChange('generating');

  task
    .taskFn()
    .then(task.resolve)
    .catch(task.reject)
    .finally(() => {
      globalQueueRunning = false;
      processQueue();
    });
}

function enqueueTask<T>(taskFn: () => Promise<T>, onStatusChange?: (status: string) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    globalQueue.push({ taskFn, onStatusChange, resolve: resolve as (v: unknown) => void, reject });
    if (onStatusChange) onStatusChange('queued');
    processQueue();
  });
}

// ─── URL 缓存（带 LRU 淘汰，防止 Object URL 无限增长） ───

const IMAGE_URL_CACHE_MAX = 50;
const imageUrlCache = new Map<string, string>();

function evictOldCacheEntries() {
  if (imageUrlCache.size <= IMAGE_URL_CACHE_MAX) return;
  const toEvict = imageUrlCache.size - IMAGE_URL_CACHE_MAX;
  const keys = imageUrlCache.keys();
  for (let i = 0; i < toEvict; i++) {
    const key = keys.next().value;
    if (key) {
      const url = imageUrlCache.get(key);
      if (url) URL.revokeObjectURL(url);
      imageUrlCache.delete(key);
    }
  }
}

// ─── Hook ───

export function useImageGen() {
  const config = useImageStore((s) => s.config);
  const tasks = useImageStore((s) => s.tasks);
  const addTask = useImageStore((s) => s.addTask);
  const updateTask = useImageStore((s) => s.updateTask);
  const removeTask = useImageStore((s) => s.removeTask);
  const setComfyData = useImageStore((s) => s.setComfyData);
  const comfyData = useImageStore((s) => s.comfyData);

  // 生成并保存
  const generateAndSave = useCallback(
    async (
      prompt: string,
      options: { category?: ImageCategory; characterName?: string; negativePrompt?: string } = {},
      onStatusChange?: (status: string) => void,
    ) => {
      return enqueueTask(async () => {
        const taskId = 'si-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);

        const effectiveConfig = config;
        const { positivePrompt, negativePrompt } = resolvePromptsForEngine(prompt, options, effectiveConfig);

        const taskRecord: ImageTask = {
          id: taskId,
          status: 'generating',
          prompt: positivePrompt || String(prompt ?? ''),
          negativePrompt,
          imageUrl: '',
          imageBlobKey: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          params: {},
          errorMessage: '',
          category: options.category || 'story',
          characterName: options.characterName || '',
        };

        addTask(taskRecord);

        try {
          const result = await generateConfiguredImage(prompt, effectiveConfig);

          const isPersistent = taskRecord.category !== 'story'; // 角色画像持久化，正文图不存

          // 仅持久化分类（角色画像）保存到 IndexedDB
          if (isPersistent) {
            await imageDb.saveBlob(taskId, result.blob, 'image/png', options.characterName);
          }

          // 正文图用 blob URL（刷新后失效，不占存储）
          const blobUrl = isPersistent ? '' : URL.createObjectURL(result.blob);

          // 更新任务记录
          updateTask(taskId, {
            status: 'completed',
            imageBlobKey: isPersistent ? taskId : null,
            imageUrl: blobUrl,
            updatedAt: Date.now(),
            prompt: result.prompt || taskRecord.prompt,
            negativePrompt: result.negativePrompt || taskRecord.negativePrompt,
            params: {
              seed: result.seed,
              width: result.width,
              height: result.height,
              model: result.model,
              sampler: result.sampler,
              steps: result.steps,
              scale: result.scale,
            },
          });

          return { ...taskRecord, status: 'completed' as const, imageBlobKey: isPersistent ? taskId : null, imageUrl: blobUrl };
        } catch (e) {
          updateTask(taskId, {
            status: 'failed',
            errorMessage: (e as Error).message,
            updatedAt: Date.now(),
          });
          throw e;
        }
      }, onStatusChange);
    },
    [config, addTask, updateTask],
  );

  // 获取图片 URL
  const getImageUrl = useCallback(async (task: ImageTask): Promise<string> => {
    const cacheKey = `blob:${task.imageBlobKey || task.id}`;
    if (imageUrlCache.has(cacheKey)) return imageUrlCache.get(cacheKey)!;

    const blobKey = task.imageBlobKey || task.id;
    if (blobKey) {
      const blobData = await imageDb.getBlob(blobKey);
      if (blobData && blobData.blob) {
        const objectUrl = URL.createObjectURL(blobData.blob);
        imageUrlCache.set(cacheKey, objectUrl);
        evictOldCacheEntries();
        return objectUrl;
      }
    }

    return task.imageUrl || '';
  }, []);

  // 删除任务
  const deleteImageTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        const cacheKey = `blob:${task.imageBlobKey || task.id}`;
        const cachedUrl = imageUrlCache.get(cacheKey);
        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          imageUrlCache.delete(cacheKey);
        }
        const blobKey = task.imageBlobKey || task.id;
        if (blobKey) await imageDb.deleteBlob(blobKey);
      }
      removeTask(taskId);
    },
    [tasks, removeTask],
  );

  // 验证配置
  const validateConfig = useCallback(
    (cfgOverride?: Partial<ImageGenConfig>): string => {
      return getGenerationConfigError(cfgOverride || config);
    },
    [config],
  );

  // 获取 ComfyUI 数据
  const loadComfyUIData = useCallback(
    async (apiUrl?: string) => {
      const url = apiUrl || config.comfyUrl;
      if (!url) return;
      try {
        const data = await fetchComfyUIData(url);
        setComfyData(data);
        return data;
      } catch (e) {
        console.error('[useImageGen] 获取 ComfyUI 数据失败:', e);
        throw e;
      }
    },
    [config.comfyUrl, setComfyData],
  );

  return {
    config,
    tasks,
    comfyData,
    generateAndSave,
    getImageUrl,
    deleteImageTask,
    validateConfig,
    loadComfyUIData,
  };
}
