import bgMusicSrc from '@/assets/bg-music.mpeg';

// Module-level singleton — survives React SPA navigation (not full reloads).
let audio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(bgMusicSrc);
    audio.loop = true;
    audio.volume = 0.3;
    audio.preload = 'auto'; // FIX 2: ensure file is ready before play() is called
  }
  return audio;
}

// FIX 3: One-time touchstart on document primes the AudioContext on iOS.
// A silent play→pause "unlocks" the audio element so a later play() succeeds
// even if it happens a few ms after the gesture.
document.body.addEventListener('touchstart', () => {
  const a = getAudio();
  a.play()
    .then(() => { a.pause(); a.currentTime = 0; })
    .catch(() => {});
}, { once: true });

// FIX 1: call this directly inside an onClick/onTap handler.
// iOS Safari only allows play() when the call stack originates from a gesture.
export function startBgMusic() {
  const a = getAudio();
  a.currentTime = 0;
  const promise = a.play();
  if (promise !== undefined) promise.catch(() => {});
}

export function stopBgMusic() {
  if (audio && !audio.paused) {
    audio.pause();
    audio.currentTime = 0;
  }
}
