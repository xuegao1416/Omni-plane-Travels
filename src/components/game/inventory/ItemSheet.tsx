import { useId, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import OverlayPortal from '../../shared/OverlayPortal';
import { qualityStyle } from './ItemGlyph';
import '../../../ui/screens/game-equipment.css';

export interface SheetAction {
  key: string;
  label: string;
  tone?: 'primary' | 'secondary' | 'danger' | 'ghost';
  onClick: () => void;
  disabled?: boolean;
  /** 需要二次确认时的提示（第一次点击只展开确认）。 */
  confirm?: string;
}

/**
 * 物品 / 部位详情浮层：挂到 body 上，不受卷宗抽屉与手机卷宗的动画容器影响；
 * 手机上从底部弹出，桌面居中。Escape 只关闭最上层。
 */
export function ItemSheet({ title, quality, glyph, meta, children, actions = [], onClose }: {
  title: string;
  quality?: string;
  glyph?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  actions?: SheetAction[];
  onClose: () => void;
}) {
  const titleId = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  const pending = actions.find(action => action.key === confirming);
  return (
    <OverlayPortal className="game-journey__nested-overlay eq-sheet-overlay" ariaLabelledBy={titleId} onClose={onClose}>
      <section className="game-journey__nested-panel eq-sheet" style={qualityStyle(quality)}>
        <header className="eq-sheet__head">
          {glyph}
          <div>
            <h3 id={titleId}>{title}</h3>
            {meta && <p>{meta}</p>}
          </div>
          <button type="button" className="eq-sheet__close" onClick={onClose} aria-label="关闭"><X size={15} /></button>
        </header>
        {children && <div className="eq-sheet__body">{children}</div>}
        {actions.length > 0 && (
          <footer className="eq-sheet__actions">
            {pending ? (
              <>
                <p className="eq-sheet__confirm" role="alert">{pending.confirm}</p>
                <button type="button" className={`pk-btn pk-btn--sm pk-btn--${pending.tone ?? 'danger'}`} onClick={() => { setConfirming(null); pending.onClick(); }}>确认{pending.label}</button>
                <button type="button" className="pk-btn pk-btn--sm pk-btn--ghost" onClick={() => setConfirming(null)}>取消</button>
              </>
            ) : actions.map(action => (
              <button
                key={action.key}
                type="button"
                className={`pk-btn pk-btn--sm pk-btn--${action.tone ?? 'secondary'}`}
                disabled={action.disabled}
                onClick={() => (action.confirm ? setConfirming(action.key) : action.onClick())}
              >{action.label}</button>
            ))}
          </footer>
        )}
      </section>
    </OverlayPortal>
  );
}

/** 详情里的字段表。 */
export function SheetRows({ rows }: { rows: Array<[string, ReactNode]> }) {
  const visible = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!visible.length) return null;
  return (
    <dl className="eq-sheet__rows">
      {visible.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

export function SheetBlock({ title, children }: { title: string; children: ReactNode }) {
  return <div className="eq-sheet__block"><span className="eq-sheet__label">{title}</span>{children}</div>;
}
