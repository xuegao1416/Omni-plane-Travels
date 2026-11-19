import { useEffect,useRef } from 'react';

interface Star {
  /** Polar position around the field centre, so the whole sky can turn. */
  r: number;
  a: number;
  size: number;
  base: number;
  phase: number;
  speed: number;
  hue: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface StarfieldProps {
  /** 0 = calm drift, 1 = full warp (radial streaks). Animated smoothly. */
  warp?: number;
  /** Degrees per second the sky turns around its centre. */
  spin?: number;
  density?: number;
  meteors?: boolean;
  className?: string;
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Canvas sky shared by the home screen and the hall. It turns slowly around
 * the screen centre (the orrery's axis) and can "warp" for transitions.
 */
export default function Starfield({ warp = 0, spin = 0.6, density = 1, meteors = true, className = '' }: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const warpTarget = useRef(warp);
  warpTarget.current = warp;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    const reduced = prefersReducedMotion();
    let stars: Star[] = [];
    let meteorList: Meteor[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = performance.now();
    let rotation = 0;
    let warpLevel = warpTarget.current;
    let nextMeteor = last + 2500 + Math.random() * 4000;

    const seed = () => {
      const maxR = Math.hypot(width, height) / 2 + 40;
      const count = Math.round(Math.min(900, (width * height) / 2300) * density);
      stars = Array.from({ length: count }, () => {
        const near = Math.random();
        return {
          r: Math.sqrt(Math.random()) * maxR,
          a: Math.random() * Math.PI * 2,
          size: near > .985 ? 1.6 + Math.random() * 1.1 : .35 + Math.random() * .9,
          base: .25 + Math.random() * .65,
          phase: Math.random() * Math.PI * 2,
          speed: .4 + Math.random() * 1.6,
          hue: Math.random() < .14 ? 38 : Math.random() < .2 ? 195 : 220,
        };
      });
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduced) draw(0, performance.now());
    };

    const draw = (dt: number, now: number) => {
      warpLevel += (warpTarget.current - warpLevel) * Math.min(1, dt * 3.2);
      rotation += (spin * Math.PI / 180) * dt * (1 + warpLevel * 6);
      const cx = width / 2;
      const cy = height / 2;
      ctx.globalCompositeOperation = 'source-over';
      // Warp leaves trails by fading instead of clearing.
      ctx.fillStyle = warpLevel > .02 ? `rgba(4, 6, 13, ${0.5 - warpLevel * 0.32})` : 'rgba(4, 6, 13, 1)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      for (const star of stars) {
        if (warpLevel > .02) {
          star.r += dt * (40 + star.r * 2.4) * warpLevel * star.speed;
          if (star.r > Math.hypot(width, height) / 2 + 60) { star.r = Math.random() * 40; star.a = Math.random() * Math.PI * 2; }
        }
        const angle = star.a + rotation;
        const x = cx + Math.cos(angle) * star.r;
        const y = cy + Math.sin(angle) * star.r;
        if (x < -10 || y < -10 || x > width + 10 || y > height + 10) continue;
        const twinkle = reduced ? 1 : .6 + .4 * Math.sin(now / 1000 * star.speed + star.phase);
        const alpha = star.base * twinkle;
        const light = star.hue === 38 ? '255, 220, 160' : star.hue === 195 ? '170, 230, 240' : '215, 225, 255';
        if (warpLevel > .05) {
          const len = star.r * .09 * warpLevel * star.speed;
          ctx.strokeStyle = `rgba(${light}, ${Math.min(1, alpha + warpLevel * .4)})`;
          ctx.lineWidth = star.size;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - Math.cos(angle) * len, y - Math.sin(angle) * len);
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(${light}, ${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, star.size, 0, Math.PI * 2);
          ctx.fill();
          if (star.size > 1.5) {
            const glow = ctx.createRadialGradient(x, y, 0, x, y, star.size * 5);
            glow.addColorStop(0, `rgba(${light}, ${alpha * .35})`);
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(x - star.size * 5, y - star.size * 5, star.size * 10, star.size * 10);
          }
        }
      }
      if (meteors && !reduced && warpLevel < .1) {
        if (now > nextMeteor) {
          const fromLeft = Math.random() < .5;
          meteorList.push({
            x: fromLeft ? Math.random() * width * .5 : width * .5 + Math.random() * width * .5,
            y: Math.random() * height * .35,
            vx: (fromLeft ? 1 : -1) * (380 + Math.random() * 260),
            vy: 160 + Math.random() * 140,
            life: 1,
          });
          nextMeteor = now + 4500 + Math.random() * 7000;
        }
        meteorList = meteorList.filter(m => m.life > 0);
        for (const m of meteorList) {
          m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt * .9;
          const tail = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * .18, m.y - m.vy * .18);
          tail.addColorStop(0, `rgba(255, 236, 200, ${m.life * .9})`);
          tail.addColorStop(1, 'rgba(255, 236, 200, 0)');
          ctx.strokeStyle = tail;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(m.x - m.vx * .18, m.y - m.vy * .18);
          ctx.stroke();
        }
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(.05, (now - last) / 1000);
      last = now;
      if (!document.hidden) draw(dt, now);
      frame = requestAnimationFrame(loop);
    };

    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    if (!reduced) frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [density, meteors, spin]);

  return <canvas ref={canvasRef} className={`pl-starfield ${className}`} aria-hidden="true" />;
}
