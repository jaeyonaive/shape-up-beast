import { useState, useEffect, useRef, useCallback } from 'react';
import monsterTutorial from '@/assets/monster-tutorial.png';
import monsterBoss from '@/assets/monster-boss.png';
import defeatVideoSrc from '@/assets/monster-defeat.webm';

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
  onDefeatEnd?: () => void;
}

type DefeatStage = 'none' | 'impact' | 'video' | 'fall';

const IMPACT_MS = 200;
const FALL_MS   = 700;

export function MonsterDisplay({ imageKey, isHit, hpPercent, isCrit, isDefeated, onDefeatEnd }: MonsterDisplayProps) {
  const [hitAnim,     setHitAnim]     = useState(false);
  const [critAnim,    setCritAnim]    = useState(false);
  const [defeatStage, setDefeatStage] = useState<DefeatStage>('none');
  const videoRef       = useRef<HTMLVideoElement | null>(null);
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
  //  impact (200ms) → transparent video plays → CSS fall (700ms) → onDefeatEnd
  useEffect(() => {
    if (!isDefeated) {
      setDefeatStage('none');
      return;
    }
    setDefeatStage('impact');
    const t = setTimeout(() => setDefeatStage('video'), IMPACT_MS);
    return () => clearTimeout(t);
  }, [isDefeated]);

  // Play the video after React has rendered defeatStage='video' (avoids display:none race)
  useEffect(() => {
    if (defeatStage !== 'video' || !videoRef.current) return;
    const v = videoRef.current;
    v.currentTime  = 0;
    v.playbackRate = 0.75;
    v.play().catch(() => {
      // Autoplay blocked or format unsupported — skip to CSS fall
      setDefeatStage('fall');
      setTimeout(() => onDefeatEndRef.current?.(), FALL_MS);
    });
  }, [defeatStage]);

  // Called when video finishes naturally
  const handleVideoEnded = useCallback(() => {
    setDefeatStage('fall');
    setTimeout(() => onDefeatEndRef.current?.(), FALL_MS);
  }, []);

  // ── Sprite class ───────────────────────────────────────────────────────────
  const idleClass = hpPercent < 30 ? 'monster-low-hp' : 'monster-float';

  let spriteClass: string;
  if      (defeatStage === 'impact') spriteClass = 'monster-defeat-impact';
  else if (defeatStage === 'video')  spriteClass = 'opacity-0 pointer-events-none';
  else if (defeatStage === 'fall')   spriteClass = 'monster-defeat-fall';
  else if (critAnim)                 spriteClass = 'monster-crit';
  else if (hitAnim)                  spriteClass = 'monster-hit';
  else                               spriteClass = idleClass;

  const wrapperStyle: React.CSSProperties =
    defeatStage !== 'none'
      ? { transform: 'scale(1.15)', transition: 'transform 0.15s ease-out' }
      : { transition: 'transform 0.3s ease-in' };

  return (
    <div className="pointer-events-none relative flex items-center justify-center" style={wrapperStyle}>
      {/* Monster sprite — hidden during video, restored on fall/none */}
      <img
        src={monsterImages[imageKey]}
        alt="Monster"
        className={`w-80 h-80 object-contain drop-shadow-2xl ${spriteClass}`}
      />

      {/* Defeat video — transparent WebM, no blend modes, no filters */}
      <video
        ref={videoRef}
        src={defeatVideoSrc}
        muted
        playsInline
        preload="auto"
        style={{
          position:  'absolute',
          left:      '50%',
          top:       '50%',
          transform: 'translate(-50%, -50%) scale(1.2)',
          maxHeight: '68vh',
          maxWidth:  '88vw',
          objectFit: 'contain',
          background: 'transparent',
          zIndex:    defeatStage === 'video' ? 50 : -1,
          opacity:   defeatStage === 'video' ? 1 : 0,
          pointerEvents: 'none',
        }}
        onEnded={handleVideoEnded}
      />
    </div>
  );
}
