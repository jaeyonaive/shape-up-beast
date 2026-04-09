import { useState, useEffect } from 'react';
import monsterTutorial from '@/assets/monster-tutorial.png';
import monsterBoss from '@/assets/monster-boss.png';

const monsterImages: Record<string, string> = {
  'monster-tutorial': monsterTutorial,
  'monster-boss': monsterBoss,
};

interface MonsterDisplayProps {
  imageKey: string;
  isHit: boolean;
  hpPercent: number;
  isCrit: boolean;
}

export function MonsterDisplay({ imageKey, isHit, hpPercent, isCrit }: MonsterDisplayProps) {
  const [hitAnim, setHitAnim] = useState(false);
  const [critAnim, setCritAnim] = useState(false);

  useEffect(() => {
    if (isHit) {
      if (isCrit) {
        setCritAnim(true);
        const timeout = setTimeout(() => setCritAnim(false), 400);
        return () => clearTimeout(timeout);
      } else {
        setHitAnim(true);
        const timeout = setTimeout(() => setHitAnim(false), 300);
        return () => clearTimeout(timeout);
      }
    }
  }, [isHit, isCrit]);

  const idleClass = hpPercent < 30 ? 'monster-low-hp' : 'monster-float';
  const animClass = critAnim ? 'monster-crit' : hitAnim ? 'monster-hit' : idleClass;

  return (
    <div className="pointer-events-none">
      <img
        src={monsterImages[imageKey]}
        alt="Monster"
        className={`w-80 h-80 object-contain drop-shadow-2xl ${animClass}`}
      />
    </div>
  );
}
