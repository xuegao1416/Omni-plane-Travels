// 正文生图内联按钮 — 点击触发图片生成，完成后内联展示
// 状态持久化到全局 Map，避免 MessageBubble 重新渲染时丢失
import { useState, useCallback, useEffect, useRef } from 'react';
import { useImageGen } from '../../../hooks/useImageGen';
import { getGenerationConfigError } from '../../../api/imageGen';
import { ImageIcon, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

// ─── 全局状态缓存（跨渲染周期持久化） ───
// key: `${msgId}::${prompt}` → value: { status, imageUrl, errorMsg, taskId }
interface CachedState {
  status: 'idle' | 'generating' | 'done' | 'error';
  imageUrl: string;
  errorMsg: string;
  taskId: string | null;
}
const globalImageStateCache = new Map<string, CachedState>();
const globalImageStateListeners = new Map<string, Set<(state: CachedState) => void>>();

function publishImageState(cacheKey: string, state: CachedState) {
  globalImageStateCache.set(cacheKey, state);
  globalImageStateListeners.get(cacheKey)?.forEach(listener => listener(state));
}

interface Props {
  prompt: string;
  /** 消息 ID，用于构建缓存 key */
  msgId?: string | number;
  /** Stable placeholder identity; unlike the prompt it does not change during final rendering. */
  imageKey?: string;
}

/** Stable, compact IndexedDB key for one inline image placeholder. */
export function buildInlineImageStorageKey(identity: string): string {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const safeIdentity = identity.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `inline-story-${safeIdentity}-${(hash >>> 0).toString(36)}`;
}

export default function InlineImageGenButton({ prompt, msgId, imageKey }: Props) {
  const { config, generateAndSave, getImageUrl, getStoredImageUrl } = useImageGen();
  const cacheKey = imageKey || `${msgId || 'unknown'}::${prompt}`;
  const storageKey = buildInlineImageStorageKey(cacheKey);

  // 从全局缓存恢复状态
  const cached = globalImageStateCache.get(cacheKey);
  const [status, setStatus] = useState<CachedState['status']>(cached?.status || 'idle');
  const [imageUrl, setImageUrl] = useState(cached?.imageUrl || '');
  const [errorMsg, setErrorMsg] = useState(cached?.errorMsg || '');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const listener = (next: CachedState) => {
      setStatus(next.status);
      setImageUrl(next.imageUrl);
      setErrorMsg(next.errorMsg);
    };
    const listeners = globalImageStateListeners.get(cacheKey) ?? new Set<(state: CachedState) => void>();
    listeners.add(listener);
    globalImageStateListeners.set(cacheKey, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) globalImageStateListeners.delete(cacheKey);
    };
  }, [cacheKey]);

  // 状态变化时同步到全局缓存
  const updateState = useCallback((patch: Partial<CachedState>) => {
    const prev = globalImageStateCache.get(cacheKey) || { status: 'idle', imageUrl: '', errorMsg: '', taskId: null };
    const next = { ...prev, ...patch };
    publishImageState(cacheKey, next);
  }, [cacheKey]);

  // The message node can be rebuilt when the rest of the generation pipeline
  // commits its snapshot. Restore the completed inline image from IndexedDB
  // instead of falling back to an empty button/text-only message.
  useEffect(() => {
    if (globalImageStateCache.has(cacheKey)) return;
    let cancelled = false;
    getStoredImageUrl(storageKey).then(url => {
      if (!cancelled && url) updateState({ status: 'done', imageUrl: url, taskId: storageKey });
    }).catch(() => { /* no image has been generated for this placeholder yet */ });
    return () => { cancelled = true; };
  }, [cacheKey, getStoredImageUrl, storageKey, updateState]);

  const handleClick = useCallback(async () => {
    if (status === 'generating' || status === 'done') return;

    const configError = getGenerationConfigError(config);
    if (configError) {
      updateState({ status: 'error', errorMsg: configError });
      return;
    }

    updateState({ status: 'generating', errorMsg: '' });

    try {
      console.log('[InlineImage] 开始生成:', prompt.substring(0, 50));
      const result = await generateAndSave(
        prompt,
        { category: 'story', persist: true, storageKey },
        (s) => {
          if (s === 'generating' && mountedRef.current) {
            updateState({ status: 'generating' });
          }
        },
      );
      console.log('[InlineImage] generateAndSave 返回:', result ? { id: result.id, status: result.status, imageBlobKey: result.imageBlobKey, hasImageUrl: !!result.imageUrl } : null);

      // 优先用 blob URL（正文图），其次从 IndexedDB 恢复（角色画像）
      let url = result?.imageUrl || '';
      if (!url && result?.imageBlobKey) {
        url = await getImageUrl(result) || '';
      }
      if (url) {
        updateState({ status: 'done', imageUrl: url, taskId: result!.id });
      } else {
        updateState({ status: 'error', errorMsg: '生成完成但未返回图片' });
      }
    } catch (e) {
      console.error('[InlineImage] 生成失败:', e);
      updateState({ status: 'error', errorMsg: (e as Error).message || '生图失败' });
    }
  }, [status, config, prompt, generateAndSave, getImageUrl, storageKey, updateState]);

  // 重试
  const handleRetry = useCallback(() => {
    updateState({ status: 'idle', imageUrl: '', errorMsg: '' });
  }, [updateState]);

  // ─── 已完成：显示图片 ───
  if (status === 'done' && imageUrl) {
    return (
      <div style={{ margin: '8px 0', position: 'relative' }}>
        <img
          src={imageUrl}
          alt={prompt}
          style={{
            maxWidth: '100%',
            maxHeight: '400px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            display: 'block',
          }}
          loading="lazy"
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
          <button
            onClick={handleRetry}
            style={retryBtnStyle}
            title="重新生成"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
    );
  }

  // ─── 生成中 / 等待 / 错误 ───
  return (
    <div style={{ margin: '8px 0' }}>
      <button
        onClick={status === 'error' ? handleRetry : handleClick}
        disabled={status === 'generating'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 16px',
          borderRadius: '8px',
          border: status === 'error' ? '1px dashed var(--danger)' : '1px dashed var(--accent)',
          background: status === 'generating' ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
          color: status === 'generating' ? 'var(--accent)' : status === 'error' ? 'var(--danger)' : 'var(--text-primary)',
          cursor: status === 'generating' ? 'wait' : 'pointer',
          fontSize: 'var(--font-size-sm)',
          fontFamily: 'var(--font-family)',
          transition: 'all 0.2s',
        }}
      >
        {status === 'generating' ? (
          <>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            生成中...
          </>
        ) : status === 'error' ? (
          <>
            <AlertCircle size={14} />
            重试生图
          </>
        ) : (
          <>
            <ImageIcon size={14} />
            点击生图
          </>
        )}
      </button>
      {status === 'error' && errorMsg && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px',
          fontSize: 'var(--font-size-xs)', color: 'var(--danger)',
        }}>
          <AlertCircle size={12} />
          {errorMsg}
        </div>
      )}
    </div>
  );
}

const retryBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)',
  display: 'flex', alignItems: 'center',
};
