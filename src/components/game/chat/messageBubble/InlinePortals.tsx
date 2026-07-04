import { useRef, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessage } from '../../../../engine/types';
import type { WorldSystemData, DiceRoll } from '../../../../modules/schema';
import type { RenderedContent } from './renderPipeline';
import { useImageStore } from '../../../../stores/imageStore';

/**
 * 内联 Portal 挂载 Hook：骰子卡片、天赋卡片、生图按钮。
 * 管理 createRoot / unmount 生命周期。
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
    diceRootsRef.current.forEach(root => {
      try { root.unmount(); } catch { /* ignore */ }
    });
    diceRootsRef.current = [];

    if (!messageHtmlRef.current || isUser || !worldSystem?.骰子检定 || message.streaming) return;

    const placeholders = messageHtmlRef.current.querySelectorAll('.dice-roll-placeholder');
    if (placeholders.length === 0) return;

    const mountDiceCards = async () => {
      const { default: InlineDiceCardComponent } = await import('../InlineDiceCard');

      placeholders.forEach(el => {
        const attr = el.getAttribute('data-attr') || '';
        const dc = Number(el.getAttribute('data-dc')) || 10;
        const container = document.createElement('div');
        el.replaceWith(container);
        const root = createRoot(container);
        root.render(
          <InlineDiceCardComponent
            attr={attr}
            dc={dc}
            statData={worldSystem.数值属性}
            onRoll={onDiceRoll}
          />
        );
        diceRootsRef.current.push(root);
      });
    };

    mountDiceCards();

    return () => {
      diceRootsRef.current.forEach(root => {
        try { root.unmount(); } catch { /* ignore */ }
      });
      diceRootsRef.current = [];
    };
  }, [renderedContent, worldSystem, onDiceRoll, isUser, message.streaming, messageHtmlRef]);

  // ─── 天赋觉醒卡片 Portal ────────────────────────
  useEffect(() => {
    talentRootsRef.current.forEach(root => {
      try { root.unmount(); } catch { /* ignore */ }
    });
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
      talentRootsRef.current.forEach(root => {
        try { root.unmount(); } catch { /* ignore */ }
      });
      talentRootsRef.current = [];
    };
  }, [renderedContent, worldSystem, isUser, message.streaming, messageHtmlRef]);

  // ─── 生图按钮 Portal ────────────────────────
  const inlineImageEnabled = useImageStore((s) => s.config.inlineImageEnabled);

  useEffect(() => {
    imageGenRootsRef.current.forEach(root => {
      try { root.unmount(); } catch { /* ignore */ }
    });
    imageGenRootsRef.current = [];

    if (!messageHtmlRef.current || isUser || !inlineImageEnabled || message.streaming) return;

    const placeholders = messageHtmlRef.current.querySelectorAll('.inline-image-gen-placeholder');
    if (placeholders.length === 0) return;

    const mountImageButtons = async () => {
      const { default: InlineImageGenButtonComponent } = await import('../InlineImageGenButton');

      placeholders.forEach(el => {
        const promptText = el.getAttribute('data-prompt') || '';
        if (!promptText.trim()) return;
        const container = document.createElement('div');
        el.replaceWith(container);
        const root = createRoot(container);
        root.render(<InlineImageGenButtonComponent prompt={promptText.trim()} msgId={message.id} />);
        imageGenRootsRef.current.push(root);
      });
    };

    mountImageButtons();

    return () => {
      imageGenRootsRef.current.forEach(root => {
        try { root.unmount(); } catch { /* ignore */ }
      });
      imageGenRootsRef.current = [];
    };
  }, [renderedContent, inlineImageEnabled, isUser, message.streaming, message.id, messageHtmlRef]);
}
