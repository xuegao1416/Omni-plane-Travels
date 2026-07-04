import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import s from './ZoomButton.module.css';

export function ZoomButton({ onClick, title, children }: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button className={s.btn} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function ZoomControls({
  scale, onZoomIn, onZoomOut, onReset,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className={s.controls}>
      <ZoomButton onClick={onZoomOut} title="缩小"><ZoomOut size={14} /></ZoomButton>
      <span className={s.scaleLabel}>{Math.round(scale * 100)}%</span>
      <ZoomButton onClick={onZoomIn} title="放大"><ZoomIn size={14} /></ZoomButton>
      <ZoomButton onClick={onReset} title="重置视图"><Maximize2 size={14} /></ZoomButton>
    </div>
  );
}
