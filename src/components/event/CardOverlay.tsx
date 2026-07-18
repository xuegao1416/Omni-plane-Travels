// ============================================================
// 卡片浮层 — 订阅 EVENT_CARD 事件，按 eventPackId 取 schema/card.json，
//   找到对应卡片 block 用 CardRenderer 渲染成居中浮层（带关闭按钮，点遮罩/关闭消失）。
//   Web 端 getWebEvent 取不到卡片时静默降级（不崩）。
// ============================================================
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { eventBus, EVENTS } from '../../engine/eventBus';
import { getWebEvent } from '../../modules/eventDb';
import type { CardFile, EventPackFile } from '../../modules/schema';
import { flattenEventPack } from '../../modules/schema';
import CardRenderer, { cardFileToBlocks, type CardBlockView } from './CardRenderer';
import { useSaveStore } from '../../stores/saveStore';
import { selectChoice } from '../../modules/eventChoiceState';
import type { GameState } from '../../schema/variables';

interface CardEvent {
  cardId: string;
  eventPackId: string;
}

interface Props {
  /** 实时 GameState（用于读取选中那一刻的属性基准值做预览） */
  gameState?: GameState;
}

export default function CardOverlay({ gameState }: Props) {
  const [blocks, setBlocks] = useState<CardBlockView[] | null>(null);
  const [title, setTitle] = useState('');
  const [current, setCurrent] = useState<CardEvent | null>(null);
  // 每选择块独立维护单选状态（blockId → 选项 index / 基准值）
  const [selectedByBlock, setSelectedByBlock] = useState<Record<string, number>>({});
  const [baseByBlock, setBaseByBlock] = useState<Record<string, number>>({});

  useEffect(() => {
    const offCard = eventBus.on(EVENTS.EVENT_CARD, (evt: CardEvent) => {
      void openCard(evt);
    });
    const offOverride = eventBus.on(EVENTS.EVENT_CARD_OVERRIDE, (evt: { cardId: string; patch: Record<string, unknown>; eventPackId: string }) => {
      // 当前正在展示的卡片被覆盖：按 patch 更新 block props
      if (!current || !blocks) return;
      if (current.cardId !== evt.cardId && current.eventPackId !== evt.eventPackId) return;
      setBlocks(prev => {
        if (!prev) return prev;
        return prev.map(block => {
          if (block.id === evt.cardId) {
            return { ...block, props: { ...block.props, ...evt.patch } };
          }
          return block;
        });
      });
    });
    return () => { offCard(); offOverride(); };
  }, [current, blocks]);

  async function openCard(evt: CardEvent): Promise<void> {
    try {
      const rec = await getWebEvent(evt.eventPackId).catch(() => undefined);
      if (!rec) return;

      // 优先按事件 ID 读取该事件独立的画布文件（schema/event-<eventId>.json）
      if (evt.cardId) {
        const eventCanvas = rec.files[`schema/event-${evt.cardId}.json`];
        if (typeof eventCanvas === 'string') {
          const file = JSON.parse(eventCanvas) as CardFile;
          const view = cardFileToBlocks(file);
          if (view.length > 0) {
            setTitle(rec.manifest?.name ?? '事件');
            setCurrent(evt);
            setSelectedByBlock({});
            setBaseByBlock({});
            setBlocks(view);
            return;
          }
        }
      }

      // 回退：读 events.json，展平取所有卡片
      const evRaw = rec.files['schema/events.json'];
      if (typeof evRaw !== 'string') return;
      const evFile = JSON.parse(evRaw) as EventPackFile;
      const flat = flattenEventPack(evFile);
      const file: CardFile = { version: evFile.version, puck: { root: { props: {} }, components: {} }, cards: flat.cards };
      let view = cardFileToBlocks(file);
      // 命中指定卡片 id 时只渲染该 block；否则整卡预览
      if (evt.cardId) {
        const hit = view.filter((b) => b.id === evt.cardId);
        if (hit.length > 0) view = hit;
      }
      if (view.length === 0) return;
      setTitle(rec.manifest?.name ?? '事件');
      setCurrent(evt);
      setSelectedByBlock({});
      setBaseByBlock({});
      setBlocks(view);
    } catch {
      /* 静默降级，不崩 */
    }
  }

  const close = () => {
    setBlocks(null);
    setCurrent(null);
  };

  // 单选：选中/切换 → 覆盖同 key 待选记录（天然非累加）；已是选中 → 无操作
  const handleSelect = (blockId: string, index: number) => {
    if (!blocks || !current) return;
    if (selectedByBlock[blockId] === index) return; // 已是选中 → 无操作
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    const raw = Array.isArray(block.props.choices) ? (block.props.choices as unknown[]) : [];
    const o = raw[index] as Record<string, unknown> | string | undefined;
    const obj = typeof o === 'string' ? { label: o } : (o as Record<string, unknown> | undefined);
    const effect = obj && typeof obj === 'object' && obj.effect && typeof obj.effect === 'object'
      ? (obj.effect as { statId?: string; delta?: number })
      : undefined;
    const aiNote = obj && typeof obj === 'object' && typeof obj.aiNote === 'string'
      ? (obj.aiNote as string)
      : undefined;

    // 捕获选中那一刻的属性基准值（预览 = base + delta，绝不累加）
    let base = 0;
    const statId = effect?.statId;
    if (statId && gameState) {
      const stats = (gameState as { 玩家?: { 生存状态?: Record<string, number> } }).玩家?.生存状态;
      if (stats && statId in stats) base = Number(stats[statId] ?? 0);
    }

    setSelectedByBlock((prev) => ({ ...prev, [blockId]: index }));
    setBaseByBlock((prev) => ({ ...prev, [blockId]: base }));

    const saveId = useSaveStore.getState().currentSaveId ?? 'default';
    selectChoice({
      saveId,
      eventPackId: current.eventPackId,
      cardId: current.cardId,
      blockId,
      selectedIndex: index,
      effect: effect ? { statId: String(effect.statId ?? ''), delta: Number(effect.delta ?? 0) } : undefined,
      aiNote,
      baseStatValue: base,
    });
  };

  if (!blocks) return null;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 120,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div
        className="event-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 92vw)', maxHeight: '82vh', overflow: 'auto',
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: 'var(--space-5)', color: 'var(--text-primary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          <span style={{ flex: 1, fontWeight: 600, fontFamily: 'var(--font-display)' }}>{title}</span>
          <button className="btn-ghost btn-sm" onClick={close} aria-label="关闭"><X size={16} /></button>
        </div>
        <CardRenderer
          blocks={blocks}
          onChoice={handleSelect}
          selectedByBlock={selectedByBlock}
          baseByBlock={baseByBlock}
        />
      </div>
    </div>
  );
}
