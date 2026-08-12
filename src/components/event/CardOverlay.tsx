// ============================================================
//  卡片浮层 v2 — 执行 CardWorkflowDefinition 工作流
//  订阅 EVENT_CARD 事件，加载工作流定义，执行 DAG，渲染结果
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { X, FileText, ScrollText, MessageCircle, Image, ListChecks, Sparkles, Filter, Dice5 } from 'lucide-react';
import { eventBus, EVENTS } from '../../engine/eventBus';
import { getWebEvent } from '../../modules/eventDb';
import { getRuntimePack } from '../../modules/eventApi';
import type { CardWorkflowDefinition, CardNodeExecutionResult, CardExecutionContext } from '../../modules/schema';
import { readCanonicalEventPack } from '../../modules/eventPackFormat';
import { executeCardWorkflow, type CardWorkflowExecutionResult } from '../../modules/cardWorkflowEngine';
import { useSaveStore } from '../../stores/saveStore';
import { selectChoice, applyEffectTarget } from '../../modules/eventChoiceState';
import type { GameState } from '../../schema/variables';
import JourneyCardShell from '../game/shared/JourneyCardShell';

interface CardEvent {
  cardId: string;
  eventPackId: string;
}

interface Props {
  gameState?: GameState;
}

export default function CardOverlay({ gameState }: Props) {
  const [result, setResult] = useState<CardWorkflowExecutionResult | null>(null);
  const [title, setTitle] = useState('');
  const [current, setCurrent] = useState<CardEvent | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);

  useEffect(() => {
    const offCard = eventBus.on(EVENTS.EVENT_CARD, (evt: CardEvent) => {
      void openCard(evt);
    });
    return () => { offCard(); };
  }, []);

  const openCard = useCallback(async (evt: CardEvent) => {
    try {
      const rec = await getRuntimePack(evt.eventPackId).catch(() => undefined);
      if (!rec) return;

      const worldName = rec.manifest?.name ?? '事件';

      const pack = readCanonicalEventPack(rec.files);
      const workflow = pack.workflowByEventId.get(evt.cardId);
      if (!workflow) throw new Error(`事件包中不存在工作流：${evt.cardId}`);

      // 执行工作流
      const ctx: CardExecutionContext = {
        tick: 0,
        events: [],
        permissions: ['modify_world_state', 'add_card'],
        gameState: (gameState ?? {}) as Record<string, unknown>,
      };

      const execResult = executeCardWorkflow(workflow, ctx);

      setTitle(worldName);
      setCurrent(evt);
      setSelectedChoice(null);
      setResult(execResult);
    } catch (err) {
      console.error('[CardOverlay] 卡片加载失败:', evt, err);
    }
  }, [gameState]);

  const close = useCallback(() => {
    setResult(null);
    setCurrent(null);
    setSelectedChoice(null);
  }, []);

  const handleSelectChoice = useCallback((index: number) => {
    if (!result?.choices || !current) return;
    if (selectedChoice === index) return; // 已选中

    const choice = result.choices[index];
    if (!choice) return;

    setSelectedChoice(index);

    const saveId = useSaveStore.getState().currentSaveId ?? 'default';
    selectChoice({
      saveId,
      eventPackId: current.eventPackId,
      cardId: current.cardId,
      blockId: 'choice-0',
      selectedIndex: index,
      effect: choice.effect ? { statId: choice.effect.statId ?? '', resourcePath: choice.effect.resourcePath, delta: choice.effect.delta } : undefined,
      aiNote: choice.aiNote,
      baseStatValue: 0,
    });

    // 立即应用工作流中的 pendingEffects（不等下一 tick）
    if (result.pendingEffects && result.pendingEffects.length > 0 && gameState) {
      for (const pe of result.pendingEffects) {
        if (pe.statId || pe.resourcePath) {
          applyEffectTarget(gameState as unknown as import('../../schema/variables').GameState, {
            statId: pe.statId,
            resourcePath: pe.resourcePath,
            delta: pe.delta ?? 0,
          });
        }
        // 标记效果：直接写入 gameState
        if (pe.flagPath && pe.value !== undefined) {
          const parts = pe.flagPath.split('.');
          let cur: Record<string, unknown> = gameState as unknown as Record<string, unknown>;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
            cur = cur[parts[i]] as Record<string, unknown>;
          }
          cur[parts[parts.length - 1]] = pe.value;
        }
      }
    }

    // 延迟关闭，让玩家看到选中效果
    setTimeout(close, 600);
  }, [result, current, selectedChoice, close, gameState]);

  if (!result || !current) return null;

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
      <JourneyCardShell mode="panel" className="game-journey-card--event" label="浜嬩欢鍗?">
        <div
          className="event-fade-in game-journey-card__event-content"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(460px, 92vw)', maxHeight: '82vh', overflow: 'auto',
            padding: 'var(--space-5)', color: 'var(--text-primary)',
          }}
        >
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          <span style={{ flex: 1, fontWeight: 600, fontFamily: 'var(--font-display)' }}>{title}</span>
          <button className="btn-ghost btn-sm" onClick={close} aria-label="关闭"><X size={16} /></button>
        </div>

        {/* 叙事内容 */}
        {result.renderData.map((r, i) => (
          <NarrativeBlock key={i} data={r} />
        ))}

        {/* 选项 */}
        {result.choices && result.choices.length > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {result.choices.map((choice, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectChoice(i)}
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                    background: selectedChoice === i ? 'var(--accent)' : 'var(--bg-primary)',
                    color: selectedChoice === i ? '#fff' : 'var(--text-primary)',
                    border: `1px solid ${selectedChoice === i ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 'var(--font-size-sm)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ fontWeight: 500 }}>{choice.label}</div>
                  {choice.effect && (
                    <div style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7, marginTop: 2 }}>
                      {choice.effect.statId ?? choice.effect.resourcePath} {choice.effect.delta >= 0 ? '+' : ''}{choice.effect.delta}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 警告 */}
        {result.warnings.length > 0 && (
          <div style={{
            marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)',
            background: 'var(--bg-warning, #fef3c7)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-warning, #92400e)', fontSize: 'var(--font-size-xs)',
          }}>
            {result.warnings.join(', ')}
          </div>
        )}
        </div>
      </JourneyCardShell>
    </div>
  );
}

// ─── 叙事块渲染 ───

function NarrativeBlock({ data }: { data: CardNodeExecutionResult['renderData'] }) {
  if (!data) return null;

  switch (data.type) {
    case 'title':
      return (
        <div style={{
          marginBottom: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <FileText size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>标题</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)', fontFamily: 'var(--font-display)' }}>
            {data.title}
          </div>
        </div>
      );

    case 'text':
      return (
        <div style={{
          marginBottom: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <ScrollText size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>叙事</span>
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {data.text}
          </div>
        </div>
      );

    case 'image':
      return (
        <div style={{
          marginBottom: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Image size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>图片</span>
          </div>
          {data.imageUrl && (
            <img src={data.imageUrl} alt={data.text ?? ''} style={{ maxWidth: '100%', borderRadius: 'var(--radius-sm)', marginBottom: 4 }} />
          )}
          {data.text && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{data.text}</div>
          )}
        </div>
      );

    case 'dialog':
      return (
        <div style={{
          marginBottom: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <MessageCircle size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>对话</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: 'var(--accent)', marginBottom: 4 }}>
            {data.npcName}
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6, fontStyle: 'italic' }}>
            "{data.text}"
          </div>
        </div>
      );

    default:
      return null;
  }
}
