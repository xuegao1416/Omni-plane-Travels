import { useEffect,useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowLeft,ArrowRight,ExternalLink,Pencil,Trash2 } from 'lucide-react';
import type { WorldDef } from '../../../data/worldLoader';
import OverlayPortal from '../../shared/OverlayPortal';
import { resolveWorldIcon } from '../../shared/worldIcons';
import { difficultyLabel,getWorldVisual } from './worldVisuals';
import WorldDossier from './WorldDossier';
import { useEntryLexicon } from '../../../ui/dawn/entryLexicon';

interface WorldDetailOverlayProps {
  world: WorldDef;
  code: string;
  origin: { x: number; y: number; radius: number };
  isCustom: boolean;
  onClose: () => void;
  onStart: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Diving into a plane: the lens expands into a full-bleed view of the world. */
export default function WorldDetailOverlay({ world, code, origin, isCustom, onClose, onStart, onEdit, onDelete }: WorldDetailOverlayProps) {
  const lex = useEntryLexicon();
  const [phase, setPhase] = useState<'opening' | 'open' | 'closing'>('opening');
  const visual = getWorldVisual(world);
  const Icon = resolveWorldIcon(world.icon);

  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
    return () => cancelAnimationFrame(frame);
  }, []);

  const close = () => {
    if (phase === 'closing') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    setPhase('closing');
    window.setTimeout(onClose, 420);
  };

  const style = {
    '--ox': `${origin.x}px`,
    '--oy': `${origin.y}px`,
    '--or': `${origin.radius}px`,
    '--accent': visual.accent,
    '--fx': `${visual.focalX * 100}%`,
    '--fy': `${visual.focalY * 100}%`,
  } as CSSProperties;

  return (
    <OverlayPortal className={`pl-dive is-${phase}`} ariaLabelledBy="pl-dive-title" onClose={close} closeOnBackdrop={false}>
      <div className="pl-dive__scene" style={style} aria-hidden="true">
        <img src={visual.scene} alt="" />
        <span className="pl-dive__grade" />
      </div>
      <div className="pl-dive__frame" style={style}>
        <header className="pl-dive__top">
          <button type="button" className="pl-chip pl-back" aria-label={lex.back} onClick={close}><ArrowLeft size={14} aria-hidden="true" /><span className="pl-back__text">{lex.back}</span></button>
          <span className="pl-dive__code">{code} · {world.id.slice(0, 18).toUpperCase()}</span>
        </header>

        <div className="pl-dive__body">
          <section className="pl-dive__hero">
            <span className="pl-kicker"><Icon size={13} aria-hidden="true" /> 位面档案</span>
            <h2 id="pl-dive-title">{world.name}</h2>
            <p>{world.description || '一枚尚未写完的世界碎片，等待你的角色进入其中。'}</p>
            <div className="pl-tags">
              <span className="pl-tag is-accent">危险度 · {difficultyLabel(world.difficulty)}</span>
              {world.tags?.map(tag => <span key={tag} className="pl-tag">{tag}</span>)}
              {world.source === 'external' && <span className="pl-tag"><ExternalLink size={11} aria-hidden="true" /> 外部</span>}
              {world.matureContent && <span className="pl-tag is-warn">成人内容</span>}
            </div>
            <div className="pl-dive__cta">
              <button type="button" className="pl-button pl-button--primary pl-button--lg" onClick={onStart}>
                降临此界<ArrowRight size={18} aria-hidden="true" />
              </button>
              {isCustom && <button type="button" className="pl-button" onClick={onEdit}><Pencil size={15} aria-hidden="true" />编辑世界</button>}
              {isCustom && <button type="button" className="pl-button pl-button--danger entry-detail-delete-world" onClick={onDelete}><Trash2 size={15} aria-hidden="true" />删除世界定义</button>}
            </div>
          </section>

          <WorldDossier world={world} />
        </div>
      </div>
    </OverlayPortal>
  );
}
