import { useState, useEffect, useRef } from 'react';
import monsterTutorial from '@/assets/monster-tutorial.png';
import monsterBoss from '@/assets/monster-boss.png';

import defeatVideoSrc from '@/assets/DEFATED ANIMATION.mp4';

const monsterImages: Record<string, string> = {
  'monster-tutorial': monsterTutorial,
  'monster-boss':     monsterBoss,
};

interface MonsterDisplayProps {
  imageKey:   string;
  isHit:      boolean;
  hpPercent:  number;
  isCrit:     boolean;
  isDefeated: boolean;
}

type DefeatStage = 'none' | 'impact' | 'video' | 'fall';

const IMPACT_MS = 200;

export function MonsterDisplay({ imageKey, isHit, hpPercent, isCrit, isDefeated }: MonsterDisplayProps) {
  const [hitAnim,     setHitAnim]     = useState(false);
  const [critAnim,    setCritAnim]    = useState(false);
  const [defeatStage, setDefeatStage] = useState<DefeatStage>('none');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // ── Regular hit / crit ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isDefeated) return;
    if (!isHit) return;
    if (isCrit) {
      setCritAnim(true);
      const t = setTimeout(() => setCritAnim(false), 400);
      return () => clearTimeout(t);
    } else {
      setHitAnim(true);
      const t = setTimeout(() => setHitAnim(false), 300);
      return () => clearTimeout(t);
    }
  }, [isHit, isCrit, isDefeated]);

  // ── Defeat sequence ─────────────────────────────────────────────────────────
  //
  //  impact (200ms)  →  video plays  →  fall (700ms CSS)
  //
  //  The video element is always mounted (display:none when not playing) so it
  //  can be preloaded and avoids a flash of the old frame on first play.
  useEffect(() => {
    if (!isDefeated) {
      setDefeatStage('none');
      return;
    }

    setDefeatStage('impact');

    const t = setTimeout(() => {
      setDefeatStage('video');
      // Restart from the beginning in case the monster was defeated before
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {/* autoplay blocked — fall through */});
      }
    }, IMPACT_MS);

    return () => clearTimeout(t);
  }, [isDefeated]);

  // ── Animation class for the sprite ────────────────────────────────────────
  const idleClass = hpPercent < 30 ? 'monster-low-hp' : 'monster-float';

  let spriteClass: string;
  if      (defeatStage === 'impact') spriteClass = 'monster-defeat-impact';
  else if (defeatStage === 'video')  spriteClass = 'opacity-0 pointer-events-none';
  else if (defeatStage === 'fall')   spriteClass = 'monster-defeat-fall';
  else if (critAnim)                 spriteClass = 'monster-crit';
  else if (hitAnim)                  spriteClass = 'monster-hit';
  else                               spriteClass = idleClass;

  // Scale up the whole monster during the defeat moment for visual emphasis
  const wrapperStyle: React.CSSProperties =
    defeatStage !== 'none'
      ? { transform: 'scale(1.15)', transition: 'transform 0.15s ease-out' }
      : { transition: 'transform 0.3s ease-in' };

  return (
    <div className="pointer-events-none relative flex items-center justify-center" style={wrapperStyle}>
      {/* Monster sprite */}
      <img
        src={monsterImages[imageKey]}
        alt="Monster"
        className={`w-80 h-80 object-contain drop-shadow-2xl ${spriteClass}`}
      />

      {/* Defeat video
          mix-blend-mode: multiply removes the white background by blending
          white areas with whatever is behind — the forest background shows through.
          "true" fix = a video with alpha channel (WebM/APNG).               */}
      <video
        ref={videoRef}
        src={defeatVideoSrc}
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          display:      defeatStage === 'video' ? 'block' : 'none',
          mixBlendMode: 'multiply',
          background:   'transparent',
        }}
        onEnded={() => setDefeatStage('fall')}
      />
    </div>
  );
}
