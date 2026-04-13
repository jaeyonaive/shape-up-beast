import bgMusicSrc from '@/assets/bg-music.mpeg';

// Module-level singleton — survives React navigation (but not full page reloads).
// Audio must be started inside a real user gesture (tap/click) to satisfy
// iOS Safari autoplay policy.
let audio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(bgMusicSrc);
    audio.loop = true;
    audio.volume = 0.3;
  }
  return audio;
}

export function startBgMusic() {
  const a = getAudio();
  if (a.paused) {
    a.currentTime = 0;
    a.play().catch(() => {});
  }
}

export function stopBgMusic() {
  if (audio && !audio.paused) {
    audio.pause();
    audio.currentTime = 0;
  }
}
