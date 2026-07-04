import { useState, useCallback } from 'react';
import type { VectorMemoryItem } from '../../../memory/types';

/** store 需要暴露的最小接口 */
interface RawEditorStore {
  getMemoryRuntime: () => {
    sceneAnchor: unknown;
    activeThreads: unknown;
    stateSlots: unknown;
    relationEdges: unknown;
    relationNetwork: unknown;
    eventCards: unknown;
    entityCards: unknown;
    archiveCards: unknown;
    mutationLog: unknown;
    checkpoints: unknown;
  };
  updateSceneAnchor: (patch: any) => void;
  bumpRuntimeVersion: () => void;
}

/**
 * 管理原始 JSON 编辑器的状态和操作逻辑。
 */
export function useRawEditor(
  store: RawEditorStore,
  vectorMemory: VectorMemoryItem[],
) {
  const [rawEditorVisible, setRawEditorVisible] = useState(false);
  const [rawEditorTabKey, setRawEditorTabKey] = useState('scene');
  const [rawEditorText, setRawEditorText] = useState('');
  const [rawEditorSaving, setRawEditorSaving] = useState(false);
  const [rawEditorError, setRawEditorError] = useState('');

  const openRawEditor = useCallback((tabKey: string) => {
    setRawEditorTabKey(tabKey);
    const rt = store.getMemoryRuntime();
    let data: unknown;
    switch (tabKey) {
      case 'scene': data = rt.sceneAnchor; break;
      case 'threads': data = rt.activeThreads; break;
      case 'states': data = rt.stateSlots; break;
      case 'relations': data = rt.relationEdges; break;
      case 'relationNetwork': data = rt.relationNetwork; break;
      case 'events': data = rt.eventCards; break;
      case 'entities': data = rt.entityCards; break;
      case 'archives': data = rt.archiveCards; break;
      case 'vector': data = vectorMemory; break;
      case 'mutations': data = rt.mutationLog; break;
      case 'checkpoints': data = rt.checkpoints; break;
      default: data = null;
    }
    setRawEditorText(JSON.stringify(data, null, 2));
    setRawEditorError('');
    setRawEditorVisible(true);
  }, [store, vectorMemory]);

  const saveRawEditor = useCallback(() => {
    setRawEditorSaving(true);
    setRawEditorError('');
    try {
      const parsed = JSON.parse(rawEditorText);
      const rt = store.getMemoryRuntime();
      switch (rawEditorTabKey) {
        case 'scene': store.updateSceneAnchor(parsed); break;
        case 'threads': { if (Array.isArray(parsed)) { rt.activeThreads = parsed; } break; }
        case 'states': { if (Array.isArray(parsed)) { rt.stateSlots = parsed; } break; }
        case 'events': { if (Array.isArray(parsed)) { rt.eventCards = parsed; } break; }
        case 'entities': { if (Array.isArray(parsed)) { rt.entityCards = parsed; } break; }
        case 'archives': { if (Array.isArray(parsed)) { rt.archiveCards = parsed; } break; }
        default: break;
      }
      store.bumpRuntimeVersion();
      setRawEditorVisible(false);
    } catch (err) {
      setRawEditorError(String(err instanceof Error ? err.message : err));
    } finally {
      setRawEditorSaving(false);
    }
  }, [rawEditorText, rawEditorTabKey, store]);

  return {
    rawEditorVisible,
    setRawEditorVisible,
    rawEditorTabKey,
    rawEditorText,
    setRawEditorText,
    rawEditorSaving,
    rawEditorError,
    openRawEditor,
    saveRawEditor,
  };
}
