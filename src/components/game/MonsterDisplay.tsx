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
}

export function MonsterDisplay({ imageKey, isHit }: MonsterDisplayProps) {
  const [hitAnim, setHitAnim] = useState(false);

  useEffect(() => {
    if (isHit) {
      setHitAnim(true);
      const timeout = setTimeout(() => setHitAnim(false), 300);
      return () => clearTimeout(timeout);
    }
  }, [isHit]);

  return (
    <div className="pointer-events-none">
      <img
        src={monsterImages[imageKey]}
        alt="Monster"
        className={`w-80 h-80 object-contain drop-shadow-2xl ${
          hitAnim ? 'monster-hit' : 'monster-float'
        }`}
      />
    </div>
  );
}
