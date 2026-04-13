import { useState, useEffect, useRef, useCallback } from 'react';
import monsterTutorial from '@/assets/monster-tutorial.png';
import monsterBoss from '@/assets/monster-boss.png';
import defeatGifSrc from '@/assets/monster-defeat.gif';

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

type DefeatStage = 'none' | 'impact' | 'gif' | 'fall';

const IMPACT_MS = 200;
const GIF_MS    = 2200; // one full loop of monster-defeat.gif (22 frames × 100ms)
const FALL_MS   = 600;

export function MonsterDisplay({ imageKey, isHit, hpPercent, isCrit, isDefeated, onDefeatEnd }: MonsterDisplayProps) {
  const [hitAnim,     setHitAnim]     = useState(false);
  const [critAnim,    setCritAnim]    = useState(false);
  const [defeatStage, setDefeatStage] = useState<DefeatStage>('none');
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
  //  impact (200ms) → GIF plays (2200ms) → CSS fall (600ms) → onDefeatEnd fires
  useEffect(() => {
    if (!isDefeated) {
      setDefeatStage('none');
      return;
    }
    setDefeatStage('impact');
    const t = setTimeout(() => setDefeatStage('gif'), IMPACT_MS);
    return () => clearTimeout(t);
  }, [isDefeated]);

  // Advance to fall stage after one full GIF loop
  useEffect(() => {
    if (defeatStage !== 'gif') return;
    const t = setTimeout(() => {
      setDefeatStage('fall');
      setTimeout(() => onDefeatEndRef.current?.(), FALL_MS);
    }, GIF_MS);
    return () => clearTimeout(t);
  }, [defeatStage]);

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

      {/* Monster sprite — hidden while GIF plays, restored after */}
      {defeatStage !== 'gif' && (
        <img
          src={monsterImages[imageKey]}
          alt="Monster"
          className={`w-80 h-80 object-contain drop-shadow-2xl ${spriteClass}`}
        />
      )}

      {/*
        Defeat GIF — only mounted during playback.
        GIF transparency works natively on all browsers including iOS Safari —
        no blend modes or filters needed.
      */}
      {defeatStage === 'gif' && (
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
          <img
            src={defeatGifSrc}
            alt=""
            style={{
              maxHeight:    '68vh',
              maxWidth:     '88vw',
              objectFit:    'contain',
              // The GIF's first frame has no transparency flag; its background
              // colour index maps to RGB(0,0,0). mix-blend-mode:screen makes
              // pure-black pixels invisible against the coloured game background,
              // effectively restoring transparency without re-encoding the file.
              mixBlendMode: 'screen',
            }}
          />
        </div>
      )}
    </div>
  );
}
