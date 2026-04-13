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
const FALL_MS   = 600;

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
  //  impact (200ms) → video plays → CSS fall (600ms) → onDefeatEnd fires
  useEffect(() => {
    if (!isDefeated) {
      setDefeatStage('none');
      return;
    }
    setDefeatStage('impact');
    const t = setTimeout(() => setDefeatStage('video'), IMPACT_MS);
    return () => clearTimeout(t);
  }, [isDefeated]);

  // Play video after React mounts the video element (defeatStage just became 'video')
  useEffect(() => {
    if (defeatStage !== 'video' || !videoRef.current) return;
    const v = videoRef.current;
    v.playbackRate = 0.75;
    v.play().catch(() => {
      // Autoplay blocked or format unsupported — fall back to CSS animation
      setDefeatStage('fall');
      setTimeout(() => onDefeatEndRef.current?.(), FALL_MS);
    });
  }, [defeatStage]);

  const handleVideoEnded = useCallback(() => {
    setDefeatStage('fall');
    setTimeout(() => onDefeatEndRef.current?.(), FALL_MS);
  }, []);

  // ── Sprite class for the monster image ────────────────────────────────────
  const idleClass = hpPercent < 30 ? 'monster-low-hp' : 'monster-float';
  let spriteClass: string;
  if      (defeatStage === 'impact') spriteClass = 'monster-defeat-impact';
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

      {/*
        Monster sprite — only rendered when NOT playing the defeat video.
        Conditional rendering (not opacity/display tricks) ensures there is
        never a stacking conflict with the video element.
      */}
      {defeatStage !== 'video' && (
        <img
          src={monsterImages[imageKey]}
          alt="Monster"
          className={`w-80 h-80 object-contain drop-shadow-2xl ${spriteClass}`}
        />
      )}

      {/*
        Defeat video — only mounted during playback, removed from DOM immediately
        after (React conditional rendering).

        mix-blend-mode:screen is required for iOS Safari: Safari does not support
        WebM alpha-channel transparency and renders transparent areas as black.
        Screen blend makes black pixels invisible against the coloured background,
        effectively restoring the transparency. On browsers with native alpha
        support the transparent pixels have alpha=0 and are already invisible,
        so screen blend does not affect them.
      */}
      {defeatStage === 'video' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <video
            ref={videoRef}
            src={defeatVideoSrc}
            muted
            playsInline
            style={{
              maxHeight:    '68vh',
              maxWidth:     '88vw',
              objectFit:    'contain',
              background:   'transparent',
              mixBlendMode: 'screen',
            }}
            onEnded={handleVideoEnded}
          />
        </div>
      )}
    </div>
  );
}
