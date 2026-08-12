import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

const PARTICLE_COUNT = 48;

function makeParticle(index: number, scale: number) {
  const x = (index * 47 + 13) % 101;
  const y = (index * 71 + 19) % 97;
  const size = (1.8 + ((index * 17) % 11) * 0.22) / scale;
  const delay = -((index * 1.73) % 18);
  const duration = 15 + ((index * 13) % 15);
  const drift = ((index % 2 === 0 ? 1 : -1) * (4 + (index % 7))).toFixed(1);

  return {
    x,
    y,
    size,
    delay,
    duration,
    drift,
  };
}

export default function AmbientParticleLayer() {
  const [isHidden, setIsHidden] = useState(false);
  const [dpr, setDpr] = useState(1);

  useEffect(() => {
    const onVisibilityChange = () => setIsHidden(document.hidden);
    const cappedDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    setDpr(cappedDpr);
    setIsHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const particles = useMemo(
    () => Array.from({ length: PARTICLE_COUNT }, (_, index) => makeParticle(index, dpr)),
    [dpr],
  );

  return (
    <div
      className={`ambient-particle-layer${isHidden ? ' is-paused' : ''}`}
      aria-hidden="true"
    >
      {particles.map((particle, index) => (
        <span
          key={index}
          className="ambient-particle"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            animationDelay: `${particle.delay}s`,
            animationDuration: `${particle.duration}s`,
            '--particle-drift': `${particle.drift}px`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
