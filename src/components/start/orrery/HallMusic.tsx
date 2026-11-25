import { useEffect,useRef,useState } from 'react';
import { Volume2,VolumeX } from 'lucide-react';
import { STORAGE_KEYS } from '../../../config/storageKeys';
import { trySetItem } from '../../../storage/safeStorage';
import { useEntryLexicon } from '../../../ui/dawn/entryLexicon';
import { useUITheme } from '../../../hooks/useUITheme';
import type { UITheme } from '../../../stores/configStore';

/** One ambience track per interface theme: 星仪夜色 / 晨雾琉璃. */
const HALL_MUSIC: Record<UITheme, string> = {
  night: '/audio/omni-hall-night.mp3',
  dawn: '/audio/omni-hall-dawn.mp3',
};
const HALL_VOLUME = 0.4;

/** Hall ambience. Plays only while the orrery hall is mounted. */
export default function HallMusic() {
  const lex = useEntryLexicon();
  const theme = useUITheme();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(() => typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEYS.HALL_MUSIC_MUTED) === 'true');
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // 主题切换时换曲：各自独立的主题音乐，从头开始播放。
  useEffect(() => {
    const audio = new Audio(HALL_MUSIC[theme]);
    audio.loop = true;
    audio.volume = mutedRef.current ? 0 : HALL_VOLUME;
    audioRef.current = audio;
    if (!mutedRef.current) void audio.play().catch(() => { /* autoplay blocked until a gesture */ });
    return () => { audio.pause(); audio.src = ''; audioRef.current = null; };
  }, [theme]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = muted ? 0 : HALL_VOLUME;
      if (!muted && audio.paused) void audio.play().catch(() => undefined);
    }
    trySetItem(STORAGE_KEYS.HALL_MUSIC_MUTED, String(muted));
  }, [muted]);

  return (
    <button
      type="button"
      className={`pl-chip pl-chip--icon${muted ? '' : ' is-on'}`}
      onClick={() => setMuted(value => !value)}
      aria-label={muted ? lex.musicOn : lex.musicOff}
      aria-pressed={!muted}
      title={muted ? '音乐已静音' : '音乐播放中'}
    >
      {muted ? <VolumeX size={16} strokeWidth={1.6} aria-hidden="true" /> : <Volume2 size={16} strokeWidth={1.6} aria-hidden="true" />}
      {!muted && <span className="pl-chip__eq" aria-hidden="true"><i /><i /><i /></span>}
    </button>
  );
}
