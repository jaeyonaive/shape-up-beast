import { useState, useEffect, useRef } from 'react';
import monsterTutorial from '@/assets/monster-tutorial.png';
import monsterBoss from '@/assets/monster-boss.png';
import defeatGifSrc from '@/assets/defeated-bunny.gif';

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

// Hold the GIF for 2600 ms — long enough to feel slower and more impactful
const DEFEAT_MS = 2600;

export function MonsterDisplay({ imageKey, isHit, hpPercent, isCrit, isDefeated, onDefeatEnd }: MonsterDisplayProps) {
  const [hitAnim,  setHitAnim]  = useState(false);
  const [critAnim, setCritAnim] = useState(false);
  const onDefeatEndRef = useRef(onDefeatEnd);
  onDefeatEndRef.current = onDefeatEnd;

  // ── Regular hit / crit ────────────────────────────────────────────────────
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

  // ── Defeat: GIF plays for DEFEAT_MS then notify parent ────────────────────
  useEffect(() => {
    if (!isDefeated) return;
    const t = setTimeout(() => onDefeatEndRef.current?.(), DEFEAT_MS);
    return () => clearTimeout(t);
  }, [isDefeated]);

  // ── Defeated state: show GIF only ────────────────────────────────────────
  if (isDefeated) {
    return (
      <div
        className="pointer-events-none relative flex items-center justify-center"
        style={{ transform: 'scale(1.2)', transition: 'transform 0.4s ease-out' }}
      >
        <img
          src={defeatGifSrc}
          alt="Monster defeated"
          className="w-80 h-80 object-contain"
          style={{ display: 'block', background: 'transparent' }}
        />
      </div>
    );
  }

  // ── Normal state: idle / hit / crit animations ────────────────────────────
  const idleClass = hpPercent < 30 ? 'monster-low-hp' : 'monster-float';
  let spriteClass: string;
  if      (critAnim) spriteClass = 'monster-crit';
  else if (hitAnim)  spriteClass = 'monster-hit';
  else               spriteClass = idleClass;

  return (
    <div className="pointer-events-none relative flex items-center justify-center">
      <img
        src={monsterImages[imageKey]}
        alt="Monster"
        className={`w-80 h-80 object-contain drop-shadow-2xl ${spriteClass}`}
      />
    </div>
  );
}
