import { useRef, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessage } from '../../../../engine/types';
import type { WorldSystemData, DiceRoll } from '../../../../modules/schema';
import type { RenderedContent } from './renderPipeline';
import { useImageStore } from '../../../../stores/imageStore';
import { usePortraitStore } from '../../../../stores/portraitStore';
import { imageDb } from '../../../../storage/imageDb';

function applyDialoguePortrait(card: HTMLElement, url: string) {
  const avatar = card.querySelector<HTMLElement>('.inline-dialogue-card__avatar');
  if (!avatar) return;
  let image = avatar.querySelector<HTMLImageElement>('.inline-dialogue-card__avatar-image');
  if (!url) {
    image?.remove();
    return;
  }
  if (!image) {
    image = document.createElement('img');
    image.className = 'inline-dialogue-card__avatar-image';
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    avatar.appendChild(image);
  }
  if (image.dataset.fallbackBound !== 'true') {
    image.dataset.fallbackBound = 'true';
    image.addEventListener('error', () => image?.remove(), { once: true });
  }
  if (image.src !== url) image.src = url;
}

/** 延迟卸载 React root，避免在 React commit 阶段同步 unmount 导致竞态警告 */
function deferredUnmount(roots: Root[]) {
  // 微任务延迟：等当前 React 渲染/提交周期结束后再 unmount
  queueMicrotask(() => {
    roots.forEach(root => {
      try { root.unmount(); } catch { /* ignore */ }
    });
  });
}

/**
 * 内联内容挂载 Hook：管理交互卡片 Root，并为静态对话卡补入头像。
 */
export function useInlinePortals(
  messageHtmlRef: React.RefObject<HTMLDivElement | null>,
  renderedContent: RenderedContent,
  worldSystem: WorldSystemData | null | undefined,
  onDiceRoll: ((roll: DiceRoll) => void) | undefined,
  isUser: boolean,
  message: ChatMessage,
) {
  const diceRootsRef = useRef<Root[]>([]);
  const talentRootsRef = useRef<Root[]>([]);
  const imageGenRootsRef = useRef<Root[]>([]);

  // ─── 骰子卡片 Portal ────────────────────────
  useEffect(() => {
    deferredUnmount(diceRootsRef.current);
    diceRootsRef.current = [];

    if (!messageHtmlRef.current || isUser || !worldSystem?.骰子检定 || message.streaming) return;

    const placeholders = messageHtmlRef.current.querySelectorAll('.dice-roll-placeholder');
    if (placeholders.length === 0) return;

    const mountDiceCards = async () => {
      const { default: InlineDiceCardComponent } = await import('../InlineDiceCard');

      placeholders.forEach((el, index) => {
        const attr = el.getAttribute('data-attr') || '';
        const dc = Number(el.getAttribute('data-dc')) || 10;
        const requestId = `${message.id}:dice:${index}`;
        const existingRoll = worldSystem.骰子检定?.history?.find(roll => roll.requestId === requestId);
        const container = document.createElement('div');
        el.replaceWith(container);
        const root = createRoot(container);
        root.render(
          <InlineDiceCardComponent
            attr={attr}
            dc={dc}
            requestId={requestId}
            existingRoll={existingRoll}
            statData={worldSystem.数值属性}
            diceData={worldSystem.骰子检定}
            onRoll={onDiceRoll}
          />
        );
        diceRootsRef.current.push(root);
      });
    };

    mountDiceCards();

    return () => {
      deferredUnmount(diceRootsRef.current);
      diceRootsRef.current = [];
    };
  }, [renderedContent, worldSystem, onDiceRoll, isUser, message.id, message.streaming, messageHtmlRef]);

  // ─── 天赋觉醒卡片 Portal ────────────────────────
  useEffect(() => {
    deferredUnmount(talentRootsRef.current);
    talentRootsRef.current = [];

    if (!messageHtmlRef.current || isUser || !worldSystem?.天赋体系 || message.streaming) return;

    const placeholders = messageHtmlRef.current.querySelectorAll('.talent-gain-placeholder');
    if (placeholders.length === 0) return;

    const mountTalentCards = async () => {
      const { default: InlineTalentCardComponent } = await import('../InlineTalentCard');

      placeholders.forEach(el => {
        const talentDataStr = el.getAttribute('data-talent') || '{}';
        try {
          const talentData = JSON.parse(talentDataStr);
          const container = document.createElement('div');
          el.replaceWith(container);
          const root = createRoot(container);
          root.render(
            <InlineTalentCardComponent
              id={talentData.id || ''}
              name={talentData.name || '未知天赋'}
              rarity={talentData.rarity || '普通'}
              description={talentData.description || ''}
              effects={talentData.effects || []}
            />
          );
          talentRootsRef.current.push(root);
        } catch (e) {
          console.warn('[天赋觉醒] 解析天赋数据失败:', e);
        }
      });
    };

    mountTalentCards();

    return () => {
      deferredUnmount(talentRootsRef.current);
      talentRootsRef.current = [];
    };
  }, [renderedContent, worldSystem, isUser, message.streaming, messageHtmlRef]);

  // ─── 生图按钮 Portal ────────────────────────
  const inlineImageEnabled = useImageStore((s) => s.config.inlineImageEnabled);

  useEffect(() => {
    deferredUnmount(imageGenRootsRef.current);
    imageGenRootsRef.current = [];

    if (!messageHtmlRef.current || isUser || !inlineImageEnabled || message.streaming) return;

    const placeholders = messageHtmlRef.current.querySelectorAll('.inline-image-gen-placeholder');
    if (placeholders.length === 0) return;

    const mountImageButtons = async () => {
      const { default: InlineImageGenButtonComponent } = await import('../InlineImageGenButton');

      placeholders.forEach((el, index) => {
        const promptText = el.getAttribute('data-prompt') || '';
        if (!promptText.trim()) return;
        const container = document.createElement('div');
        el.replaceWith(container);
        const root = createRoot(container);
        root.render(<InlineImageGenButtonComponent prompt={promptText.trim()} msgId={message.id} imageKey={`${message.id}:inline-image:${index}`} />);
        imageGenRootsRef.current.push(root);
      });
    };

    mountImageButtons();

    return () => {
      deferredUnmount(imageGenRootsRef.current);
      imageGenRootsRef.current = [];
    };
  }, [renderedContent, inlineImageEnabled, isUser, message.streaming, message.id, messageHtmlRef]);

  // ─── 对话头像补水 ──────────────────────────────
  // 卡片正文已作为稳定 HTML 同步渲染；这里仅填入固定尺寸头像，不再创建成百上千个 React root。
  useEffect(() => {
    let cancelled = false;
    if (!messageHtmlRef.current || isUser || message.streaming) return;

    const cards = Array.from(messageHtmlRef.current.querySelectorAll<HTMLElement>('.inline-dialogue-card'));
    if (cards.length === 0) return;

    const applyFromStore = (portraits: Record<string, string>) => {
      for (const card of cards) {
        const npcId = card.dataset.npcid || card.dataset.name || '';
        const fallback = card.dataset.avatar || '';
        applyDialoguePortrait(card, portraits[npcId] || fallback);
      }
    };

    applyFromStore(usePortraitStore.getState().portraits);
    const unsubscribe = usePortraitStore.subscribe((state, previous) => {
      if (state.portraits !== previous.portraits) applyFromStore(state.portraits);
    });

    const unresolved = new Map<string, string>();
    const currentPortraits = usePortraitStore.getState().portraits;
    for (const card of cards) {
      const name = card.dataset.name || '';
      const npcId = card.dataset.npcid || name;
      if (name && !card.dataset.avatar && !currentPortraits[npcId]) unresolved.set(npcId, name);
    }

    for (const [npcId, name] of unresolved) {
      imageDb.findPortraitUrlByName(name).then(url => {
        if (cancelled || !url) return;
        const store = usePortraitStore.getState();
        if (store.portraits[npcId] !== url) store.setPortrait(npcId, url);
      }).catch(() => { /* ignore */ });
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [renderedContent, isUser, message.streaming, messageHtmlRef]);
}
