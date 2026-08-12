import { useEffect, useState } from 'react';
import { Compass } from 'lucide-react';
import { EntrySlicedProgress } from './EntrySurface';

export default function EntryTransition({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const startedAt = performance.now();
    let frame = 0;
    let completed = false;
    const tick = (now: number) => {
      const next = Math.min(1, (now - startedAt) / 2000);
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
      else if (!completed) {
        completed = true;
        window.setTimeout(onComplete, 120);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      completed = true;
    };
  }, [onComplete]);

  return (
    <main className="entry-transition" aria-label="正在进入世界大厅">
      <div className="entry-transition__worlds" aria-hidden="true" />
      <div className="entry-transition__veil" aria-hidden="true" />
      <div className="entry-transition__fold" aria-hidden="true">
        <span className="entry-transition__fold-ring entry-transition__fold-ring--outer" />
        <span className="entry-transition__fold-ring entry-transition__fold-ring--inner" />
        <span className="entry-transition__fold-core" />
      </div>
      <section className="entry-transition__content">
        <div className="entry-transition__kicker"><Compass size={14} /> 晶界接通</div>
        <p className="entry-transition__quote">“每一枚碎片，都保留着一个可以抵达的世界。”</p>
        <div className="entry-transition__progress-wrap">
          <EntrySlicedProgress value={progress} />
          <div className="entry-transition__progress-meta">
            <span>正在展开通往大厅的航线</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
        </div>
      </section>
    </main>
  );
}
