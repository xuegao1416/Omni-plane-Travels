import { useEffect,useRef,useState } from 'react';
import { Volume2,VolumeX } from 'lucide-react';
import { STORAGE_KEYS } from '../../../config/storageKeys';
import { trySetItem } from '../../../storage/safeStorage';
import { useEntryLexicon } from '../../../ui/dawn/entryLexicon';

const HALL_MUSIC = '/audio/omni-hall-dawn-original.mp3';

/** Hall ambience. Plays only while the orrery hall is mounted. */
export default function HallMusic() {
  const lex = useEntryLexicon();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(() => typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEYS.HALL_MUSIC_MUTED) === 'true');

  useEffect(() => {
    const audio = new Audio(HALL_MUSIC);
    audio.loop = true;
    audio.volume = 0;
    audioRef.current = audio;
    void audio.play().catch(() => { /* autoplay blocked until a gesture */ });
    return () => { audio.pause(); audio.src = ''; audioRef.current = null; };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = muted ? 0 : 0.4;
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
