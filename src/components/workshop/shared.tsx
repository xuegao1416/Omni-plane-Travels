/**
 * 创意工坊界面共用的小部件：类型标签、星级、行内确认、状态提示、格式化。
 * 不使用原生弹窗；需要确认的操作都在原位展开确认条。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, BookOpen, CalendarDays, CheckCircle2, Compass, Globe, Info, Loader, Palette, Puzzle, Star, Workflow, type LucideIcon } from 'lucide-react';
import type { PublicWorkshopType } from '../../workshopCatalog';
import { describeWorkshopError } from '../../workshop/api';

export const TYPE_META: Record<PublicWorkshopType, { label: string; icon: LucideIcon; hint: string }> = {
  world_package: { label: '世界包', icon: Globe, hint: '完整的世界设定，可附带玩法模块与事件' },
  npc_template: { label: 'NPC 模板', icon: BookOpen, hint: '可导入任意世界的角色' },
  gameplay_module: { label: '玩法模块', icon: Puzzle, hint: '为世界增加规则与数值玩法' },
  event_pack: { label: '事件包', icon: CalendarDays, hint: '事件卡与规则' },
  workflow_pack: { label: '工作流包', icon: Workflow, hint: '节点工作流驱动的事件' },
  adventure_pack: { label: '冒险包', icon: Compass, hint: '由场景串成的剧情冒险，安装后作为事件卡出现' },
  visual_theme: { label: '视觉主题', icon: Palette, hint: '替换界面色板，夜色与晨光主题都适用' },
};

export function typeMeta(type: string) {
  return (TYPE_META as Record<string, (typeof TYPE_META)[PublicWorkshopType]>)[type] ?? { label: type, icon: Puzzle, hint: '' };
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatCount(value: number): string {
  return value >= 10_000 ? `${(value / 10_000).toFixed(1)} 万` : String(value);
}

interface StarsProps {
  value: number | null;
  count?: number;
  /** 传入时星星可点（1–5）。 */
  onRate?: (score: number) => void;
  /** 当前用户自己的评分（高亮显示）。 */
  mine?: number | null;
  disabled?: boolean;
  size?: number;
}

export function Stars({ value, count, onRate, mine, disabled, size = 14 }: StarsProps) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? mine ?? value ?? 0;
  const label = value === null ? '暂无评分' : `${value.toFixed(1)} 分${count !== undefined ? `，${count} 人评分` : ''}`;
  return (
    <span className={`ws-stars${onRate ? ' is-interactive' : ''}`} aria-label={onRate ? undefined : label} role={onRate ? 'radiogroup' : 'img'}>
      {[1, 2, 3, 4, 5].map(score => {
        const fill = shown >= score ? 'is-full' : shown >= score - 0.5 ? 'is-half' : '';
        return onRate ? (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={mine === score}
            aria-label={`${score} 星`}
            className={`ws-star ${fill}`}
            disabled={disabled}
            onMouseEnter={() => setHover(score)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(score)}
            onBlur={() => setHover(null)}
            onClick={() => onRate(score)}
          >
            <Star size={size} aria-hidden="true" />
          </button>
        ) : <Star key={score} size={size} className={`ws-star ${fill}`} aria-hidden="true" />;
      })}
      {!onRate && <small>{value === null ? '暂无评分' : `${value.toFixed(1)}${count !== undefined ? ` · ${count}` : ''}`}</small>}
    </span>
  );
}

export function Notice({ tone, children, onDismiss }: { tone: 'ok' | 'error' | 'info'; children: ReactNode; onDismiss?: () => void }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'error' ? AlertTriangle : Info;
  return (
    <div className={`ws-notice is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={15} aria-hidden="true" />
      <div className="ws-notice__body">{children}</div>
      {onDismiss && <button type="button" className="ws-notice__close" onClick={onDismiss} aria-label="关闭提示">×</button>}
    </div>
  );
}

interface InlineConfirmProps {
  message: ReactNode;
  confirmText: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 原位确认条：替代原生 confirm。 */
export function InlineConfirm({ message, confirmText, danger, busy, onConfirm, onCancel }: InlineConfirmProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirmRef.current?.focus(); }, []);
  return (
    <div className={`ws-confirm${danger ? ' is-danger' : ''}`} role="alertdialog" aria-live="polite">
      <div className="ws-confirm__message">{message}</div>
      <div className="ws-confirm__actions">
        <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" onClick={onCancel} disabled={busy}>取消</button>
        <button ref={confirmRef} type="button" className={`pk-btn pk-btn--sm ${danger ? 'ws-btn-danger' : 'pk-btn--primary'}`} onClick={onConfirm} disabled={busy}>
          {busy && <Loader size={14} className="animate-spin" aria-hidden="true" />}{confirmText}
        </button>
      </div>
    </div>
  );
}

export interface ActionFeedback {
  tone: 'ok' | 'error';
  message: string;
  details?: string[];
}

/** 一次只跑一个异步操作，并把结果变成可展示的提示。 */
export function useWorkshopAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const run = useCallback(async <T,>(key: string, action: () => Promise<T>, success?: (result: T) => string | ActionFeedback | undefined): Promise<T | undefined> => {
    setBusy(key);
    setFeedback(null);
    try {
      const result = await action();
      const message = success?.(result);
      if (mounted.current && message) setFeedback(typeof message === 'string' ? { tone: 'ok', message } : message);
      return result;
    } catch (error) {
      if (mounted.current) setFeedback({ tone: 'error', message: describeWorkshopError(error) });
      return undefined;
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, []);
  return { busy, feedback, setFeedback, run };
}

export function FeedbackNotice({ feedback, onDismiss }: { feedback: ActionFeedback | null; onDismiss: () => void }) {
  if (!feedback) return null;
  return (
    <Notice tone={feedback.tone} onDismiss={onDismiss}>
      <p>{feedback.message}</p>
      {feedback.details?.length ? <ul>{feedback.details.map(detail => <li key={detail}>{detail}</li>)}</ul> : null}
    </Notice>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="registry-assets-empty ws-empty">
      <Icon size={40} aria-hidden="true" />
      <p>{title}</p>
      {children}
    </div>
  );
}

export function Spinner({ label = '加载中…' }: { label?: string }) {
  return <div className="registry-assets-loading ws-loading"><Loader size={18} className="animate-spin" aria-hidden="true" /><span>{label}</span></div>;
}
