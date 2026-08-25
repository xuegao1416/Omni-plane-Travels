// ============================================================
//  卡片浮层 v2 — 执行 CardWorkflowDefinition 工作流
//  订阅 EVENT_CARD 事件，加载工作流定义，执行 DAG，渲染结果
// ============================================================
import { useEffect, useState, useCallback, useRef } from 'react';
import { X, FileText, ScrollText, MessageCircle, Image, ListChecks, Sparkles, Filter, Dice5 } from 'lucide-react';
import { eventBus, EVENTS } from '../../engine/eventBus';
import { getWebEvent } from '../../modules/eventDb';
import { getRuntimePack } from '../../modules/eventApi';
import type { CardWorkflowDefinition, CardNodeExecutionResult, CardExecutionContext } from '../../modules/schema';
import { readCanonicalEventPack } from '../../modules/eventPackFormat';
import { executeCardWorkflow, type CardWorkflowExecutionResult } from '../../modules/cardWorkflowEngine';
import { useSaveStore } from '../../stores/saveStore';
import type { GameState } from '../../schema/variables';
import type { CustomModuleChoiceEvent } from '../../custom-modules/context';
import { applyNarrativeDecision, createNarrativeDecisionRecord, normalizeNarrativeDecisionAction, type NarrativeDecisionEffect, type NarrativeDecisionRecord } from '../../gameplay/narrativeDecision';
import JourneyCardShell from '../game/shared/JourneyCardShell';

interface CardEvent {
  cardId: string;
  eventPackId: string;
}

interface Props {
  gameState?: GameState;
  onChoice?: (event: CustomModuleChoiceEvent) => Promise<void> | void;
  onDecisionApplied?: (state: GameState, record: NarrativeDecisionRecord) => Promise<void> | void;
}

export default function CardOverlay({ gameState, onChoice, onDecisionApplied }: Props) {
  const [result, setResult] = useState<CardWorkflowExecutionResult | null>(null);
  const [title, setTitle] = useState('');
  const [current, setCurrent] = useState<CardEvent | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const decisionIdRef = useRef<string | null>(null);

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

      setTitle(workflow.name || worldName);
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
    decisionIdRef.current = null;
  }, []);

  const handleSelectChoice = useCallback(async (index: number) => {
    if (!result?.choices || !current) return;
    if (selectedChoice === index || decisionIdRef.current) return; // 已选中或正在原子提交

    const choice = result.choices[index];
    if (!choice) return;

    const saveId = useSaveStore.getState().currentSaveId ?? 'default';
    if (!gameState) return;
    decisionIdRef.current = `${saveId}:${current.eventPackId}:${current.cardId}:choice-0:${Date.now()}`;

    const effects: NarrativeDecisionEffect[] = [];
    if (choice.effect) {
      effects.push({
        type: 'delta',
        effect: { statId: choice.effect.statId, resourcePath: choice.effect.resourcePath, delta: choice.effect.delta },
      });
    }
    for (const pending of result.pendingEffects ?? []) {
      if (pending.statId || pending.resourcePath) {
        effects.push({ type: 'delta', effect: { statId: pending.statId, resourcePath: pending.resourcePath, delta: pending.delta ?? 0 } });
      }
      if (pending.flagPath && pending.value !== undefined) {
        if (typeof pending.value === 'string' || typeof pending.value === 'number' || typeof pending.value === 'boolean' || pending.value === null) {
          effects.push({ type: 'flag', path: pending.flagPath, value: pending.value });
        }
      }
    }

    const record = createNarrativeDecisionRecord({
      id: decisionIdRef.current,
      saveId,
      eventPackId: current.eventPackId,
      cardId: current.cardId,
      blockId: 'choice-0',
      selectedIndex: index,
      action: normalizeNarrativeDecisionAction(choice.action)
        ?? (effects.length > 0 ? { type: 'apply_effects', effects } : { type: 'narrative', instruction: choice.label }),
      aiNote: `事件「${title || current.cardId}」中，玩家选择了「${choice.label}」。${choice.aiNote ?? ''}`.trim(),
    });
    const applied = applyNarrativeDecision(gameState, record);
    if (!applied.applied) return;
    try {
      await onDecisionApplied?.(applied.state, applied.record);
      if (record.action.type === 'start_combat') {
        eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, record);
      }
    } catch (error) {
      decisionIdRef.current = null;
      console.warn('[CardOverlay] 事件选择保存失败，保留卡片等待重试:', error);
      return;
    }
    setSelectedChoice(index);

    // 延迟关闭，让玩家看到选中效果
    setTimeout(close, 600);

    try {
      const lifecycle = onChoice?.({
        type: 'choice', eventPackId: current.eventPackId, cardId: current.cardId,
        blockId: 'choice-0', selectedIndex: index, label: choice.label,
      });
      void Promise.resolve(lifecycle).catch((error) => {
        console.warn('[custom-modules] onChoice failed after the event choice was applied', error);
      });
    } catch (error) {
      console.warn('[custom-modules] onChoice failed after the event choice was applied', error);
    }
  }, [result, current, selectedChoice, close, gameState, onChoice, onDecisionApplied, title]);

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
      <JourneyCardShell mode="panel" className="game-journey-card--event" label="事件卡">
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
