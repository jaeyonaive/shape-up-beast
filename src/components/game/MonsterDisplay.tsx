import { useState, useEffect, useRef, useCallback } from 'react';
import monsterTutorial from '@/assets/monster-tutorial.png';
import monsterBoss from '@/assets/monster-boss.png';

import defeatVideoSrc from '@/assets/DEFEATED ANIMATION.webm';

const monsterImages: Record<string, string> = {
  'monster-tutorial': monsterTutorial,
  'monster-boss':     monsterBoss,
};

interface MonsterDisplayProps {
  imageKey:     string;
  isHit:        boolean;
  hpPercent:    number;
  isCrit:       boolean;
  isDefeated:   boolean;
  onDefeatEnd?: () => void; // called when defeat video finishes playing
}

type DefeatStage = 'none' | 'impact' | 'video' | 'fall';

const IMPACT_MS  = 200;
const FALL_MS    = 700;

export function MonsterDisplay({ imageKey, isHit, hpPercent, isCrit, isDefeated, onDefeatEnd }: MonsterDisplayProps) {
  const [hitAnim,     setHitAnim]     = useState(false);
  const [critAnim,    setCritAnim]    = useState(false);
  const [defeatStage, setDefeatStage] = useState<DefeatStage>('none');
  const videoRef      = useRef<HTMLVideoElement | null>(null);
  const onDefeatEndRef = useRef(onDefeatEnd);
  onDefeatEndRef.current = onDefeatEnd;

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
  //  impact (200ms) → video plays → CSS fall (700ms) → onDefeatEnd fires
  //
  useEffect(() => {
    if (!isDefeated) {
      setDefeatStage('none');
      return;
    }

    setDefeatStage('impact');

    const t = setTimeout(() => {
      setDefeatStage('video');
      // play() is triggered by the defeatStage effect below, after the re-render
    }, IMPACT_MS);

    return () => clearTimeout(t);
  }, [isDefeated]);

  // Play the video once the DOM has rendered it visible (defeatStage === 'video')
  useEffect(() => {
    if (defeatStage !== 'video' || !videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current.play().catch(() => {
      // Autoplay blocked or format unsupported — fall through to CSS animation
      setDefeatStage('fall');
      setTimeout(() => onDefeatEndRef.current?.(), FALL_MS);
    });
  }, [defeatStage]);

  // Called when the video finishes naturally
  const handleVideoEnded = useCallback(() => {
    setDefeatStage('fall');
    // Notify parent after CSS fall completes so it can schedule respawn
    setTimeout(() => onDefeatEndRef.current?.(), FALL_MS);
  }, []);

  // ── Animation class for the sprite ────────────────────────────────────────
  const idleClass = hpPercent < 30 ? 'monster-low-hp' : 'monster-float';

  let spriteClass: string;
  if      (defeatStage === 'impact') spriteClass = 'monster-defeat-impact';
  else if (defeatStage === 'video')  spriteClass = 'opacity-0 pointer-events-none';
  else if (defeatStage === 'fall')   spriteClass = 'monster-defeat-fall';
  else if (critAnim)                 spriteClass = 'monster-crit';
  else if (hitAnim)                  spriteClass = 'monster-hit';
  else                               spriteClass = idleClass;

  // Scale up slightly during defeat for visual emphasis
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

      {/* Defeat video — WebM with alpha channel, always mounted for reliable preload + play */}
      <video
        ref={videoRef}
        src={defeatVideoSrc}
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 w-full h-full object-contain"
        style={{
          opacity:       defeatStage === 'video' ? 1 : 0,
          pointerEvents: 'none',
        }}
        onEnded={handleVideoEnded}
      />
    </div>
  );
}
