/**
 * 物资账本（游戏界面右侧抽屉）。
 * 只渲染资源模块给出的界面数据，所有操作回调到 useResourceActions。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import {
  AlertTriangle, ArrowLeft, Clock, Dna, Hammer, Hourglass, Leaf, Lock, ScrollText, Sparkle, Trash2, Wrench, X, Zap, HeartPulse, ChevronDown,
} from 'lucide-react';
import type { ResourcesViewModel } from '../../../domains/resources/viewModel';
import { resourceGlyph } from './resourceGlyph';
import '../../../ui/screens/module-ledger.css';

interface ResourcesLedgerProps {
  open: boolean;
  view: ResourcesViewModel;
  onClose: () => void;
  onGather?: (resourceId: string) => void;
  onCraft?: (recipeId: string) => void;
  onUnlock?: (recipeId: string) => void;
  onDeleteRecipe?: (recipeId: string) => void;
}

function signed(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

export default function ResourcesLedger({ open, view, onClose, onGather, onCraft, onUnlock, onDeleteRecipe }: ResourcesLedgerProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => setAnimating(true));
      return;
    }
    setAnimating(false);
    const timer = setTimeout(() => { setVisible(false); setExpanded(null); }, 250);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!visible) return null;

  return (
    <>
      <div className={`game-journey__nested-overlay game-journey__nested-overlay--contained ml-veil${animating ? ' is-open' : ''}`} onClick={onClose} />
      <aside className={`game-journey__nested-panel game-journey__nested-panel--side ml-drawer is-narrow${animating ? ' is-open' : ''}`} aria-label={view.title}>
        <header className="ml-bar">
          <button type="button" className="ml-bar__btn" onClick={onClose} aria-label="返回"><ArrowLeft /></button>
          <div className="ml-bar__title">
            <small>物资账本</small>
            <h2>{view.title}</h2>
          </div>
          <button type="button" className="ml-bar__btn is-ghost" onClick={onClose} aria-label="关闭"><X /></button>
        </header>

        <div className="ml-body">
          {view.alerts.length > 0 && (
            <section className="ml-alerts" role="status">
              {view.alerts.map(alert => <p key={alert}><AlertTriangle />{alert}</p>)}
            </section>
          )}

          {(view.description || view.rulesText) && (
            <section className="ml-card">
              <h3 className="ml-card__title"><Leaf />生存规则</h3>
              {view.description && <p className="ml-prose">{view.description}</p>}
              <p className="ml-note"><Hourglass />{view.cycleLabel}{view.rulesText ? `：${view.rulesText}` : ''}</p>
            </section>
          )}

          <section>
            <h3 className="ml-heading">物资<span>{view.resources.length}</span></h3>
            <div className="ml-meta">
              {view.worldTime && <span><Clock />{view.worldTime}</span>}
              <span><Zap />体力 {Math.max(0, view.stamina)}</span>
            </div>
            <div className="ml-stack">
              {view.resources.map((row, index) => {
                const Glyph = resourceGlyph(row);
                const isOpen = expanded === row.id;
                const hasDetail = Boolean(row.description || row.gatherText || row.usageText);
                const tone = row.tone === 'empty' ? 'is-empty' : row.tone === 'low' ? 'is-critical' : row.tone === 'scarce' ? 'is-scarce' : '';
                return (
                  <article key={row.id} className={`ml-resource ${tone}`} style={{ '--fill': row.fill, animationDelay: `${Math.min(index, 8) * 30}ms` } as CSSProperties}>
                    <button type="button" className="ml-resource__head" onClick={() => setExpanded(isOpen ? null : row.id)}
                      aria-expanded={hasDetail ? isOpen : undefined} disabled={!hasDetail}>
                      <span className="ml-glyph"><Glyph /></span>
                      <span className="ml-resource__name">
                        <strong>{row.name}</strong>
                        <em className="ml-tag is-mute">{row.kindLabel}</em>
                        {row.tone === 'low' && <em className="ml-tag is-ember"><AlertTriangle />告急</em>}
                        {row.tone === 'empty' && <em className="ml-tag is-ember">已耗尽</em>}
                        {row.tone === 'scarce' && <em className="ml-tag is-amber">稀缺</em>}
                      </span>
                      <span className="ml-resource__count"><b>{row.amount}</b>/{row.max}</span>
                      {hasDetail && <ChevronDown className="ml-chevron" />}
                    </button>
                    <span className="ml-meter" aria-hidden="true"><i /></span>
                    {(row.upkeepLabel || row.remainingLabel) && (
                      <p className="ml-resource__sub">
                        {row.upkeepLabel && <span>{row.upkeepLabel}</span>}
                        {row.remainingLabel && <span className={row.tone === 'empty' || row.tone === 'low' ? 'is-loss' : ''}>{row.remainingLabel}</span>}
                      </p>
                    )}
                    {onGather && row.gather && (
                      <button type="button" className="ml-action" onClick={() => onGather(row.id)} disabled={Boolean(row.gather.blocked)}>
                        <Sparkle />
                        {row.gather.blocked
                          ? row.gather.blocked
                          : <>采集 <b>+{row.gather.amount}</b><span>· {row.gather.minutes} 分钟 · -{row.gather.stamina} 体力</span></>}
                      </button>
                    )}
                    {isOpen && (
                      <div className="ml-detail">
                        {row.description && <p>{row.description}</p>}
                        {row.gatherText && <span><Zap />采集：{row.gatherText}</span>}
                        {row.usageText && <span><Clock />用途：{row.usageText}</span>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {view.statuses.length > 0 && (
            <section className="ml-card">
              <h3 className="ml-card__title"><HeartPulse />身体状态<span>{view.statuses.length}</span></h3>
              <div className="ml-stack is-tight">
                {view.statuses.map(status => (
                  <div key={status.id} className={`ml-status is-${status.severity}`}>
                    <strong>{status.name}</strong>
                    <span>{status.effect}</span>
                    {status.description && <small>{status.description}</small>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="ml-card">
            <h3 className="ml-card__title"><Hammer />制作台<span>{view.recipes.length}</span></h3>
            {view.recipes.length === 0 ? (
              <p className="ml-empty-line">暂无配方。可以在右侧物资卡里描述想做的东西，让 AI 按现有物资设计配方。</p>
            ) : (
              <div className="ml-stack is-tight">
                {view.recipes.map(recipe => (
                  <div key={recipe.id} className={`ml-recipe${recipe.craftable ? ' is-ready' : ''}`}>
                    <div className="ml-recipe__head">
                      <strong>{recipe.name}</strong>
                      <span>→ {recipe.outputs.map(output => `${output.label}×${output.amount}`).join('、')}</span>
                    </div>
                    {recipe.description && <p className="ml-recipe__desc">{recipe.description}</p>}
                    <div className="ml-recipe__inputs">
                      {recipe.inputs.map(input => <span key={input.key} className={input.enough ? 'is-enough' : 'is-short'}>{input.label} {input.have}/{input.need}</span>)}
                      {recipe.tool && <span className={recipe.tool.owned ? 'is-enough' : 'is-short'}><Wrench />{recipe.tool.name}</span>}
                    </div>
                    <p className="ml-recipe__meta">
                      {recipe.minutes > 0 && <span><Clock />{recipe.minutes} 分钟</span>}
                      {recipe.stamina > 0 && <span><Zap />体力 -{recipe.stamina}</span>}
                      {!recipe.locked && recipe.blocked && <span className="is-loss">{recipe.blocked}</span>}
                    </p>
                    {recipe.locked && <p className="ml-recipe__lock"><Lock />需要解锁{recipe.unlockHint ? ` · ${recipe.unlockHint}` : ''}</p>}
                    <div className="ml-recipe__actions">
                      {recipe.locked
                        ? onUnlock && <button type="button" className="pk-btn pk-btn--secondary pk-btn--sm" onClick={() => onUnlock(recipe.id)} disabled={!recipe.canUnlock}><Lock />解锁</button>
                        : onCraft && <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" onClick={() => onCraft(recipe.id)} disabled={!recipe.craftable}><Hammer />制作</button>}
                      {recipe.custom && onDeleteRecipe && (
                        <button type="button" className="ml-icon-btn is-danger" onClick={() => onDeleteRecipe(recipe.id)} title="删除配方" aria-label={`删除配方 ${recipe.name}`}><Trash2 /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {view.evolution.length > 0 && (
            <section className="ml-card">
              <h3 className="ml-card__title"><Dna />局势演变</h3>
              <ol className="ml-timeline">
                {view.evolution.map((step, index) => (
                  <li key={step.id} className={`ml-timeline__step${step.done ? ' is-done' : ''}`}>
                    <span className="ml-timeline__dot">{index + 1}</span>
                    <div className="ml-timeline__body">
                      <strong>{step.done ? '已发生' : '可能发生'}：{step.result}</strong>
                      <small>触发：{step.trigger}</small>
                      {step.done && step.hint && <q>{step.hint}</q>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {view.ledger.length > 0 && (
            <section className="ml-card">
              <h3 className="ml-card__title"><ScrollText />账本</h3>
              <div className="ml-log">
                {view.ledger.map(entry => (
                  <div key={entry.key} className="ml-log__entry">
                    <small className="ml-log__reason">第 {entry.turn} 回合 · {entry.reason}</small>
                    {entry.changes.map(change => {
                      const Glyph = resourceGlyph({ name: change.label });
                      return (
                        <div key={change.id} className={`ml-log__row ${change.delta < 0 ? 'is-loss' : 'is-gain'}`}>
                          <Glyph />
                          <span>{change.label}</span>
                          <b>{signed(change.delta)}</b>
                          <small>余 {change.after}</small>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
