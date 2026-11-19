// ============================================================
//  事件卡浮层：展示事件导演队列里的第一张卡（队列在存档里，读档、刷新后仍在）。
//  选择经事件模块结算（效果、检定、后续事件一次完成），结果先在卡上展示，再继续下一张。
//  可以先收起，稍后从顶部的提示条重新打开；跳过需要二次确认。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronRight, Dices, Image as ImageIcon, MessageCircle, Minimize2, ScrollText, Sparkles, X } from 'lucide-react';
import { eventBus, EVENTS } from '../../engine/eventBus';
import type { ApiConfig } from '../../api/types';
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { CustomModuleChoiceEvent } from '../../custom-modules/context';
import type { NarrativeDecisionRecord } from '../../gameplay/narrativeDecision';
import type { PlayerCommandEngine } from '../../core/playerCommands';
import { generateDynamicChoices } from '../../modules/dynamicChoiceGenerator';
import { useSaveStore } from '../../stores/saveStore';
import { onEventCatalogChange } from '../../events/catalog';
import { buildEventCardView, describeOptions } from '../../events/viewModel';
import { dismissEventCard, resolveEventChoice, triggerEventCard } from '../../events/playerActions';
import { sanitizeDynamicOptions } from '../../events/resolve';
import type { CardBlock, CardOptionModel } from '../../events/cards';
import type { CardOptionSpec } from '../../events/types';
import JourneyCardShell from '../game/shared/JourneyCardShell';
import '../../ui/screens/event-card.css';

interface Props {
  engine: PlayerCommandEngine;
  world?: WorldDef;
  gameState?: GameState;
  apiConfig?: ApiConfig | null;
  onChoice?: (event: CustomModuleChoiceEvent) => Promise<void> | void;
  /** 提交选择后的状态（游戏界面负责存盘、接续战斗）；未提供时直接提交给引擎。 */
  onDecisionApplied?: (state: GameState, record?: NarrativeDecisionRecord) => Promise<void> | void;
  onNotify?: (message: string | null) => void;
}

interface DynamicOptions {
  key: string;
  loading: boolean;
  options: CardOptionSpec[];
  note?: string;
}

interface ResolvedCard {
  title: string;
  label?: string;
  summary?: string;
  success?: boolean;
  next?: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function CardOverlay({ engine, world, gameState, apiConfig, onChoice, onDecisionApplied, onNotify }: Props) {
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [minimizedKey, setMinimizedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [resolved, setResolved] = useState<ResolvedCard | null>(null);
  const [dynamic, setDynamic] = useState<DynamicOptions | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ engine, world, gameState, apiConfig, onNotify });
  latest.current = { engine, world, gameState, apiConfig, onNotify };

  useEffect(() => onEventCatalogChange(() => setCatalogVersion(version => version + 1)), []);
  useEffect(() => eventBus.on(EVENTS.EVENT_CARD_OPEN, () => setMinimizedKey(null)), []);

  const view = useMemo(() => buildEventCardView(gameState, world),
    // catalogVersion：事件包加载完成后重新取卡片内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState, world, catalogVersion]);
  const entryKey = view ? `${view.entry.key}@${view.entry.turn}` : '';
  const card = view?.card;

  // 换卡时重置界面状态。
  useEffect(() => {
    setSelected(null);
    setError(null);
    setConfirmSkip(false);
  }, [entryKey]);

  // 动态选项：每张卡只生成一次；没有 API 或生成失败时用预设选项。
  const generation = useRef<{ key: string; controller: AbortController } | null>(null);
  useEffect(() => {
    if (!card?.dynamic || !entryKey || generation.current?.key === entryKey) return;
    generation.current?.controller.abort();
    const controller = new AbortController();
    generation.current = { key: entryKey, controller };
    const key = entryKey;
    const settle = (next: DynamicOptions) => { if (generation.current?.key === key && !controller.signal.aborted) setDynamic(next); };
    const fallback = card.dynamic.fallbackChoices.length ? card.dynamic.fallbackChoices : card.specs;
    const { apiConfig: config, gameState: state, world: activeWorld } = latest.current;
    if (!config || !state) {
      settle({ key, loading: false, options: fallback, note: '未配置模型接口，使用预设选项' });
      return;
    }
    settle({ key, loading: true, options: [] });
    const narrative = card.blocks.map(block => block.text || block.title || '').filter(Boolean).join('\n');
    generateDynamicChoices(card.dynamic.config, state, narrative, config, {
      worldName: activeWorld?.name, gameTime: state.世界?.时间系统?.当前时间,
    }, controller.signal).then(generated => {
      const options = sanitizeDynamicOptions(generated);
      settle(options.length
        ? { key, loading: false, options }
        : { key, loading: false, options: fallback, note: '选项生成失败，使用预设选项' });
    }).catch(() => settle({ key, loading: false, options: fallback, note: '选项生成失败，使用预设选项' }));
  }, [card, entryKey]);
  useEffect(() => () => generation.current?.controller.abort(), []);

  // 旧接口：EVENT_CARD 广播（编辑器试玩、旧自创模块）→ 放进待处理队列。
  useEffect(() => eventBus.on(EVENTS.EVENT_CARD, (payload: { cardId?: string; eventPackId?: string } | undefined) => {
    if (!payload?.cardId) return;
    const { engine: activeEngine, world: activeWorld, onNotify: notify } = latest.current;
    const result = triggerEventCard(activeEngine, activeWorld, payload.cardId, payload.eventPackId);
    if (!result.ok) notify?.(result.feedback);
  }), []);

  const open = Boolean(view) && minimizedKey !== view?.entry.key && !resolved;
  useEffect(() => {
    if (open || resolved) dialogRef.current?.focus();
  }, [open, resolved, entryKey]);

  const isDynamic = Boolean(card?.dynamic);
  const dynamicReady = !isDynamic || (dynamic?.key === entryKey && !dynamic.loading);
  const specs: CardOptionSpec[] = isDynamic ? (dynamic?.key === entryKey ? dynamic.options : []) : card?.specs ?? [];
  const options: CardOptionModel[] = useMemo(() => {
    if (!card) return [];
    if (!isDynamic) return card.options;
    const hints = gameState ? describeOptions(gameState, world, specs) : [];
    return specs.map((spec, index) => ({ index, label: spec.label, hint: hints[index] ?? '', available: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, isDynamic, specs]);

  const choose = useCallback(async (index: number) => {
    if (!view?.card || busy || !dynamicReady) return;
    const option = options[index];
    if (options.length > 0 && (!option || !option.available)) return;
    const saveId = useSaveStore.getState().currentSaveId ?? 'default';
    setBusy(true);
    setSelected(index);
    setError(null);
    const result = resolveEventChoice(engine, world, {
      key: view.entry.key, option: options.length ? index : -1, saveId,
      ...(isDynamic ? { dynamic: specs } : {}),
    });
    if (!result.ok || !result.state) {
      setBusy(false);
      setSelected(null);
      setError(result.feedback);
      return;
    }
    // 先切到结果页再提交，避免提交后队首换卡造成闪烁；提交失败时退回卡片并提示。
    const history = result.state.eventDirector?.history.at(-1);
    const nextKey = result.state.eventDirector?.queue[0]?.key;
    setResolved({
      title: view.card.title,
      ...(option?.label ? { label: option.label } : {}),
      ...(history?.summary ? { summary: history.summary } : {}),
      ...(history?.success !== undefined ? { success: history.success } : {}),
      ...(nextKey && nextKey !== view.entry.key ? { next: '还有后续' } : {}),
    });
    try {
      if (onDecisionApplied) await onDecisionApplied(result.state, result.record);
      else if (!engine.commitPlayerState(result.state)) throw new Error('当前回合正在处理，请稍后再选');
    } catch (failure) {
      setResolved(null);
      setBusy(false);
      setSelected(null);
      setError(`保存失败，卡片已保留，可以重试：${errorText(failure)}`);
      return;
    }
    setBusy(false);
    setSelected(null);
    if (option) {
      try {
        void Promise.resolve(onChoice?.({
          type: 'choice', eventPackId: view.entry.packId, cardId: view.entry.eventId,
          blockId: 'choice-0', selectedIndex: index, label: option.label,
        })).catch(failure => console.warn('[custom-modules] onChoice failed after the event choice was applied', failure));
      } catch (failure) {
        console.warn('[custom-modules] onChoice failed after the event choice was applied', failure);
      }
    }
  }, [view, busy, dynamicReady, options, engine, world, isDynamic, specs, onDecisionApplied, onChoice]);

  const skip = useCallback(() => {
    if (!view || busy) return;
    if (!confirmSkip) { setConfirmSkip(true); return; }
    const result = dismissEventCard(engine, world, view.entry.key);
    setConfirmSkip(false);
    if (!result.ok) setError(result.feedback);
    else onNotify?.(result.feedback);
  }, [view, busy, confirmSkip, engine, world, onNotify]);

  const minimize = useCallback(() => {
    if (view) setMinimizedKey(view.entry.key);
    setConfirmSkip(false);
  }, [view]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (resolved) setResolved(null);
      else minimize();
      return;
    }
    if (resolved && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      setResolved(null);
      return;
    }
    const digit = Number(event.key);
    if (!resolved && Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
      event.preventDefault();
      void choose(digit - 1);
    }
  }, [resolved, minimize, options.length, choose]);

  if (resolved) {
    return (
      <div className="ev-veil" onClick={() => setResolved(null)}>
        <JourneyCardShell mode="panel" className="game-journey-card--event ev-card" label="事件结果">
          <div ref={dialogRef} className="event-fade-in game-journey-card__event-content" role="dialog" aria-modal="true" aria-labelledby="ev-result-title" tabIndex={-1}
            onClick={event => event.stopPropagation()} onKeyDown={onKeyDown}>
            <header className="ev-head">
              <div className="ev-head__title"><small>事件结果</small><h2 id="ev-result-title">{resolved.title}</h2></div>
            </header>
            <div className={`ev-result${resolved.success === true ? ' is-success' : resolved.success === false ? ' is-failure' : ''}`} role="status">
              {resolved.label && <p className="ev-result__choice"><Check size={14} />{resolved.label}</p>}
              {resolved.success !== undefined && <p className="ev-result__check"><Dices size={14} />{resolved.success ? '检定成功' : '检定失败'}</p>}
              <p className="ev-result__text">{resolved.summary || '选择已记下，会在下一段正文中承接。'}</p>
            </div>
            <footer className="ev-foot">
              <span className="ev-foot__hint">下一段正文会承接这个选择</span>
              <button type="button" className="ev-primary" onClick={() => setResolved(null)}>
                {resolved.next ? '继续' : '回到旅程'}<ChevronRight size={14} />
              </button>
            </footer>
          </div>
        </JourneyCardShell>
      </div>
    );
  }

  if (!view) return null;

  if (!open) {
    const title = view.card?.title ?? '待处理事件';
    return (
      <button type="button" className="ev-pill" onClick={() => setMinimizedKey(null)} aria-label={`打开待处理事件：${title}`}>
        <Sparkles size={14} />
        <span className="ev-pill__label">事件待处理</span>
        <strong>{title}</strong>
        {view.waiting > 0 && <span className="ev-pill__count">+{view.waiting}</span>}
        <ChevronRight size={14} />
      </button>
    );
  }

  return (
    <div className="ev-veil" onClick={minimize}>
      <JourneyCardShell mode="panel" className="game-journey-card--event ev-card" label="事件卡">
        <div ref={dialogRef} className="event-fade-in game-journey-card__event-content" role="dialog" aria-modal="true" aria-labelledby="ev-card-title" tabIndex={-1}
          onClick={event => event.stopPropagation()} onKeyDown={onKeyDown}>
          <header className="ev-head">
            <div className="ev-head__title">
              <small>{view.entry.reason === '随机事件' ? '旅途偶遇' : '事件'}{view.waiting > 0 ? ` · 还有 ${view.waiting} 张` : ''}</small>
              <h2 id="ev-card-title">{card?.title ?? '无法显示的事件'}</h2>
            </div>
            <button type="button" className="ev-icon-btn" onClick={minimize} aria-label="先收起，稍后处理" title="先收起（Esc）">
              <Minimize2 size={15} />
            </button>
          </header>

          {view.unavailable && <p className="ev-warning" role="alert">{view.unavailable}</p>}
          {card && card.blocks.filter(block => !(block.type === 'title' && block.title === card.title)).map((block, index) => <NarrativeBlock key={index} block={block} />)}

          {card && isDynamic && !dynamicReady && <p className="ev-muted ev-loading" role="status"><Sparkles size={13} />正在根据当前处境生成选项…</p>}
          {card && dynamic?.key === entryKey && dynamic.note && <p className="ev-muted">{dynamic.note}</p>}

          {card && dynamicReady && options.length > 0 && (
            <div className="ev-options" role="group" aria-label="选项">
              {options.map(option => (
                <button key={option.index} type="button"
                  className={`ev-option${selected === option.index ? ' is-selected' : ''}`}
                  disabled={busy || !option.available}
                  onClick={() => void choose(option.index)}>
                  <span className="ev-option__key" aria-hidden="true">{option.index + 1}</span>
                  <span className="ev-option__main">
                    <span className="ev-option__label">{option.label}</span>
                    {option.hint && <span className="ev-option__hint">{option.hint}</span>}
                    {option.check && (
                      <span className="ev-option__check">
                        <Dices size={12} />{option.check.label}检定 · 难度 {option.check.dc} · 成功率约 {option.check.chance}%
                      </span>
                    )}
                    {!option.available && option.reason && <span className="ev-option__reason">{option.reason}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="ev-warning" role="alert">{error}</p>}

          <footer className="ev-foot">
            {confirmSkip ? (
              <span className="ev-confirm">
                跳过后这张卡不会再结算。
                <button type="button" className="ev-link is-danger" onClick={skip} disabled={busy}>确定跳过</button>
                <button type="button" className="ev-link" onClick={() => setConfirmSkip(false)}>取消</button>
              </span>
            ) : (
              <button type="button" className="ev-link" onClick={skip} disabled={busy}>
                <X size={13} />{view.unavailable ? '移除这张卡' : '跳过此事件'}
              </button>
            )}
            {card && dynamicReady && options.length === 0 && (
              <button type="button" className="ev-primary" onClick={() => void choose(-1)} disabled={busy}>知道了<ChevronRight size={14} /></button>
            )}
          </footer>
        </div>
      </JourneyCardShell>
    </div>
  );
}

const EMOTIONS: Record<string, string> = {
  friendly: '友善', happy: '开心', angry: '愤怒', sad: '难过', fear: '惊恐', afraid: '惊恐', surprised: '惊讶', shy: '害羞', worried: '担忧', cold: '冷淡',
};

function emotionLabel(value?: string): string {
  if (!value || value === 'neutral') return '';
  return EMOTIONS[value] ?? (/[\p{Script=Han}]/u.test(value) ? value : '');
}

function NarrativeBlock({ block }: { block: CardBlock }) {
  switch (block.type) {
    case 'title':
      return block.title ? <h3 className="ev-block ev-block--title">{block.title}</h3> : null;
    case 'text':
      return block.text ? <p className="ev-block ev-block--text"><ScrollText size={13} aria-hidden="true" />{block.text}</p> : null;
    case 'image':
      return (
        <figure className="ev-block ev-block--image">
          {block.imageUrl ? <img src={block.imageUrl} alt={block.text ?? ''} /> : <ImageIcon size={18} aria-hidden="true" />}
          {block.text && <figcaption>{block.text}</figcaption>}
        </figure>
      );
    case 'dialog':
      return (
        <blockquote className="ev-block ev-block--dialog">
          <cite><MessageCircle size={13} aria-hidden="true" />{block.npcName || '某人'}{emotionLabel(block.npcEmotion) ? ` · ${emotionLabel(block.npcEmotion)}` : ''}</cite>
          <p>{block.text}</p>
        </blockquote>
      );
    default:
      return null;
  }
}
