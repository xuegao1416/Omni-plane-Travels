import { useEffect,useState } from 'react';
import { PenLine } from 'lucide-react';
import UpdateLogOverlay from './UpdateLogOverlay';
import Astrolabe from './orrery/Astrolabe';
import DawnStartPlaque from '../../ui/dawn/DawnStartPlaque';
import DawnTitle from '../../ui/dawn/DawnTitle';
import { useEntryLexicon } from '../../ui/dawn/entryLexicon';
import { useUITheme } from '../../hooks/useUITheme';
import { APP_VERSION } from '../../config/version';

interface MainMenuViewProps {
  onStartWizard: () => void;
  onResumeCreation?: () => void;
  title: string;
  subtitle: string;
  /** True while the warp jump into the hall is playing. */
  departing?: boolean;
}

/**
 * Title screen. Night: the navigator astrolabe at rest. Dawn: a gilded title
 * and a crystal start plaque over the 3D rotunda (DawnScene). Any click starts the jump.
 */
export default function MainMenuView({ onStartWizard, title, subtitle, onResumeCreation, departing = false }: MainMenuViewProps) {
  const [ready, setReady] = useState(false);
  const uiTheme = useUITheme();
  const lex = useEntryLexicon();
  const dawn = uiTheme === 'dawn';

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const start = () => { if (!departing) onStartWizard(); };

  return (
    <main
      className={`pl-home${ready ? ' is-ready' : ''}${departing ? ' is-departing' : ''}`}
      tabIndex={0}
      onClick={start}
      onKeyDown={event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); start(); }
      }}
      aria-labelledby="pl-home-title"
    >
      <div className="pl-home__nebula" aria-hidden="true" />
      {!dawn && <div className="pl-home__astro" aria-hidden="true"><Astrolabe variant="home" /></div>}
      <div className="pl-home__veil" aria-hidden="true" />

      {dawn ? <DawnTitle eyebrow={lex.eyebrow} title={title} subtitle={subtitle} /> : (
        <section className="pl-home__title">
          <span className="pl-home__eyebrow">{lex.eyebrow}</span>
          <h1 id="pl-home-title">
            <span className="pl-home__latin">OMNI<i aria-hidden="true" />PLANE</span>
            <span className="pl-home__latin pl-home__latin--sub">TRAVELS</span>
          </h1>
          <span className="pl-home__rule" aria-hidden="true"><span /></span>
          <p className="pl-home__cn">{title}</p>
          <p className="pl-home__motto">{subtitle}</p>
        </section>
      )}

      <div className="pl-home__actions">
        {dawn ? <DawnStartPlaque label={lex.start} onStart={start} /> : (
          <button type="button" className="pl-home__start" onClick={event => { event.stopPropagation(); start(); }}>
            <span className="pl-home__start-ring" aria-hidden="true" />
            <span>{lex.start}</span>
          </button>
        )}
        {onResumeCreation && (
          <button type="button" className="pl-chip" onClick={event => { event.stopPropagation(); onResumeCreation(); }}>
            <PenLine size={14} aria-hidden="true" />继续创建角色
          </button>
        )}
      </div>

      <footer className="pl-home__footer" onClick={event => event.stopPropagation()}>
        <span className="pl-home__version">v{APP_VERSION}</span>
        <UpdateLogOverlay />
      </footer>
    </main>
  );
}
