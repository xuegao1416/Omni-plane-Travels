import { useEffect, useState } from 'react';
import UpdateLogOverlay from './UpdateLogOverlay';

interface MainMenuViewProps {
  onStartWizard: () => void;
  title: string;
  subtitle: string;
}

export default function MainMenuView({ onStartWizard, title, subtitle }: MainMenuViewProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <main
      className="entry-home"
      tabIndex={0}
      onClick={onStartWizard}
      onKeyDown={event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) onStartWizard();
      }}
    >
      <img className="entry-home-loop-art" src="/art/theme/entry/home-loop-master.png" alt="" aria-hidden="true" />
      <div className="entry-loop-layer entry-loop-layer--a" aria-hidden="true" />
      <div className="entry-loop-layer entry-loop-layer--b" aria-hidden="true" />
      <div className="entry-home-wash" aria-hidden="true" />

      <section className={`entry-home-content${ready ? ' is-ready' : ''}`} aria-labelledby="entry-home-title">
        <div className="entry-home-brandline">OMNI · PLANE TRAVELS</div>
        <img
          className="entry-home-title-art"
          src="/art/theme/entry/world-wanderer-title.png"
          alt={title}
        />
        <h1 id="entry-home-title" className="entry-sr-only">{title}</h1>
        <p className="entry-home-motto">{subtitle}</p>
        <button
          type="button"
          className="entry-start-hint"
          aria-label="点击任意处开始"
          onClick={event => { event.stopPropagation(); onStartWizard(); }}
        >
          点击任意处开始
        </button>
      </section>

      <div className="entry-home-footer" aria-label="版本">
        <span>v2.8.0</span>
      </div>
      <UpdateLogOverlay />
    </main>
  );
}
