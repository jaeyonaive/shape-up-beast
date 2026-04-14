import bgMusicSrc from '@/assets/bg-music.mp3';

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

// One-time touchstart on document primes the AudioContext on iOS.
// Guarded so it never throws if document.body isn't ready.
if (typeof document !== 'undefined' && document.body) {
  document.body.addEventListener('touchstart', () => {
    try {
      const a = getAudio();
      a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
    } catch (_) { /* non-fatal */ }
  }, { once: true });
}

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
