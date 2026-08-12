import { X } from 'lucide-react';

interface LoadingViewProps {
  title: string;
  subtitle: string;
  spinnerMessage: string;
  onClose: () => void;
}

export function LoadingView({ title, subtitle, spinnerMessage, onClose }: LoadingViewProps) {
  return (
    <section className="guided-choice-panel guided-choice-panel--loading" aria-label={title}>
      <div className="guided-choice-header">
        <button className="guided-choice-close" onClick={onClose} aria-label="关闭世界织构推演"><X size={16} /></button>
        <div className="guided-choice-heading">
          <span className="world-weave-kicker">STEP 02 · WORLD WEAVE</span>
          <h2>世界织构推演</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="guided-choice-loading">
        <img src="/art/theme/ui-kit/dawn-v4/ritual/talent-astrolabe-v1.png" alt="" aria-hidden="true" />
        <strong>{title}</strong>
        <span>{spinnerMessage}</span>
      </div>
    </section>
  );
}
