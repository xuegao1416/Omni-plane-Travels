const HALL_SOUND_SOURCES = {
  crystalSelect: '/audio/sfx-crystal-select.mp3',
  confirm: '/audio/sfx-ui-confirm.mp3',
  back: '/audio/sfx-ui-back.mp3',
} as const;

const HALL_SOUND_VOLUMES: Record<keyof typeof HALL_SOUND_SOURCES, number> = {
  crystalSelect: .24,
  confirm: .18,
  back: .18,
};

const activeSounds = new Set<HTMLAudioElement>();

export type HallSound = keyof typeof HALL_SOUND_SOURCES;

export function playHallSound(sound: HallSound) {
  if (typeof window === 'undefined' || localStorage.getItem('omni.hall.musicMuted') === 'true') return;

  const audio = new Audio(HALL_SOUND_SOURCES[sound]);
  audio.volume = HALL_SOUND_VOLUMES[sound];
  audio.preload = 'auto';
  activeSounds.add(audio);

  const release = () => {
    audio.pause();
    activeSounds.delete(audio);
  };

  audio.addEventListener('ended', release, { once: true });
  audio.addEventListener('error', release, { once: true });
  void audio.play().catch(release);
}
