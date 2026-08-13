import { useMemo, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../../../engine/types';
import { parseContent, createIframeSrcDoc } from '../../../../utils/markdown';
import { getEnabledTextColorizationRules } from '../../../../utils/text-colorization';
import { processRegexScripts } from '../../../../utils/regexScripts';
import type { RegexScript } from '../../../../utils/regexScripts';
import { getBuiltinDisplayScripts } from '../../../../data/builtinPresets';
import { usePresetStore, applyOverrides } from '../../../../stores/presetStore';
import { getBuiltinPreset } from '../../../../data/builtinPresets';
import { stripTimeAdvanceTags } from '../../../../time/worldClock';
import { renderDialogueMarkup } from '../../../../utils/dialogueMarkup';

export type RenderedContent =
  | { type: 'html'; content: string }
  | { type: 'iframe'; content: string }
  | null;

const LEGACY_DIALOGUE_REGEX_SCRIPT_IDS = new Set([
  'builtin_display_dialogue_avatar',
  'builtin_display_uidl_dialogue',
]);

/** Built-in presets already contain the common display scripts. Keep one copy per id. */
export function mergeDisplayScripts(...groups: RegexScript[][]): RegexScript[] {
  const merged = new Map<string, RegexScript>();
  for (const script of groups.flat()) {
    // Old exported presets may still carry the unsafe cross-block avatar regexes.
    if (!LEGACY_DIALOGUE_REGEX_SCRIPT_IDS.has(script.id)) merged.set(script.id, script);
  }
  return [...merged.values()];
}

/**
 * 渲染管线 Hook：正则脚本处理 + Markdown 解析，返回最终可渲染内容。
 * 同时管理 iframe 高度自适应。
 */
export function useRenderedContent(
  message: ChatMessage,
  isUser: boolean,
): { renderedContent: RenderedContent; iframeRef: React.RefObject<HTMLIFrameElement | null> } {
  const colorizationRules = useMemo(() => getEnabledTextColorizationRules(), []);
  // 内置渲染正则始终执行 + 预设正则叠加（合并而非二选一）
  const builtinDisplay = useMemo(() => getBuiltinDisplayScripts(), []);
  // 订阅原始状态字段，避免 getActivePreset() 每次返回新引用导致无限重渲染
  const activePresetId = usePresetStore(s => s.activePresetId);
  const userPresets = usePresetStore(s => s.userPresets);
  const builtinOverrides = usePresetStore(s => s.builtinOverrides);
  const activePreset = useMemo(() => {
    if (activePresetId) {
      const found = userPresets.find(p => p.id === activePresetId);
      if (found) return found;
      const builtin = getBuiltinPreset(activePresetId);
      return applyOverrides(builtin, builtinOverrides);
    }
    return applyOverrides(getBuiltinPreset('default'), builtinOverrides);
  }, [activePresetId, userPresets, builtinOverrides]);
  const presetDisplayScripts = useMemo(
    () => (activePreset?.regexScripts || []).filter(s => (s.markdownOnly || (!s.markdownOnly && !s.promptOnly)) && !s.disabled),
    [activePreset],
  );
  const displayScripts = useMemo(() => mergeDisplayScripts(builtinDisplay, presetDisplayScripts), [builtinDisplay, presetDisplayScripts]);

  const renderedContent = useMemo(() => {
    if (isUser) return null; // 用户消息不走渲染管线
    const raw = message.rawText || '';
    if (!raw) return { type: 'html' as const, content: '' };
    // 全部交给正则脚本处理（thinking 折叠、OPTION 卡片、元标签剥除）
    const cleanedByRegex = stripTimeAdvanceTags(processRegexScripts(stripTimeAdvanceTags(raw), displayScripts));
    // 头像协议只在完整回复上进行 JSON 感知解析，避免流式阶段反复替换节点导致文字跳动。
    const cleaned = message.streaming ? cleanedByRegex : renderDialogueMarkup(cleanedByRegex);
    if (!cleaned.trim()) return { type: 'html' as const, content: '' };
    return parseContent(cleaned, {
      isStreaming: !!message.streaming,
      textColorizationRules: colorizationRules,
    });
  }, [isUser, message.rawText, message.streaming, colorizationRules, displayScripts]);

  // iframe 高度自适应
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (renderedContent?.type !== 'iframe') return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'iframe-resize' && iframeRef.current) {
        iframeRef.current.style.height = `${e.data.height}px`;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [renderedContent?.type]);

  return { renderedContent, iframeRef };
}

/**
 * 获取 displayScripts，供 ContextMenu 复制功能使用。
 */
export function useDisplayScripts() {
  const builtinDisplay = useMemo(() => getBuiltinDisplayScripts(), []);
  const activePresetId = usePresetStore(s => s.activePresetId);
  const userPresets = usePresetStore(s => s.userPresets);
  const builtinOverrides = usePresetStore(s => s.builtinOverrides);
  const activePreset = useMemo(() => {
    if (activePresetId) {
      const found = userPresets.find(p => p.id === activePresetId);
      if (found) return found;
      const builtin = getBuiltinPreset(activePresetId);
      return applyOverrides(builtin, builtinOverrides);
    }
    return applyOverrides(getBuiltinPreset('default'), builtinOverrides);
  }, [activePresetId, userPresets, builtinOverrides]);
  const presetDisplayScripts = useMemo(
    () => (activePreset?.regexScripts || []).filter(s => (s.markdownOnly || (!s.markdownOnly && !s.promptOnly)) && !s.disabled),
    [activePreset],
  );
  return useMemo(() => mergeDisplayScripts(builtinDisplay, presetDisplayScripts), [builtinDisplay, presetDisplayScripts]);
}
