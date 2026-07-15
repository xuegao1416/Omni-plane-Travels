import { useRef, useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useAudioStore } from '../stores/audioStore';

const MUSIC_SRC = '/scarborough-fair.mp3';

export default function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const muted = useAudioStore((s) => s.bgmMuted);
  const setBgmMuted = useAudioStore((s) => s.setBgmMuted);

  // 创建 Audio 元素并尝试自动播放
  useEffect(() => {
    const audio = new Audio(MUSIC_SRC);
    audio.loop = true;
    audio.volume = 0.4;
    audio.muted = muted;
    audioRef.current = audio;

    // 尝试自动播放，失败则等待首次交互
    if (!muted) {
      audio.play().catch(() => {
        const tryPlay = () => {
          audio.play().catch(() => {});
          document.removeEventListener('click', tryPlay);
          document.removeEventListener('keydown', tryPlay);
        };
        document.addEventListener('click', tryPlay, { once: true });
        document.addEventListener('keydown', tryPlay, { once: true });
      });
    }

    return () => { audio.pause(); audio.src = ''; };
  }, []);

  // 同步静音状态
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  const toggle = () => {
    const next = !muted;
    setBgmMuted(next);
    if (audioRef.current) {
      if (next) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch(() => {});
      }
    }
  };

  return (
    <button
      onClick={toggle}
      title={muted ? '开启音乐' : '静音'}
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 9999,
        width: '36px',
        height: '36px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        color: 'var(--accent)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.5,
        transition: 'opacity 0.2s, box-shadow 0.2s',
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.opacity = '1';
        e.currentTarget.style.boxShadow = 'var(--shadow-glow)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.opacity = '0.5';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
    </button>
  );
}
