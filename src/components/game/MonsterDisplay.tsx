import { useState, useEffect } from 'react';
import monsterTutorial from '@/assets/monster-tutorial.png';
import monsterBoss from '@/assets/monster-boss.png';

// ─── Defeat video ─────────────────────────────────────────────────────────────
import defeatVideoSrc from '@/assets/DEFATED ANIMATION.mp4';
const defeatVideo: string = defeatVideoSrc;
// ─────────────────────────────────────────────────────────────────────────────

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

type DefeatStage = 'none' | 'impact' | 'fall';

const IMPACT_MS = 200;

export function MonsterDisplay({ imageKey, isHit, hpPercent, isCrit, isDefeated }: MonsterDisplayProps) {
  const [hitAnim,     setHitAnim]     = useState(false);
  const [critAnim,    setCritAnim]    = useState(false);
  const [defeatStage, setDefeatStage] = useState<DefeatStage>('none');
  const [showVideo,   setShowVideo]   = useState(false);

  // ── Regular hit / crit ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isDefeated) return; // defeat sequence takes priority
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
  //   200 ms  →  impact flash + hard shake
  //   then    →  video (if available) OR CSS collapse fall
  useEffect(() => {
    if (!isDefeated) {
      setDefeatStage('none');
      setShowVideo(false);
      return;
    }

    setDefeatStage('impact');

    const t = setTimeout(() => {
      if (defeatVideo) {
        setShowVideo(true);
        setDefeatStage('none'); // hide sprite while video plays
      } else {
        setDefeatStage('fall');
      }
    }, IMPACT_MS);

    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDefeated]);

  // ── Animation class ────────────────────────────────────────────────────────
  const idleClass = hpPercent < 30 ? 'monster-low-hp' : 'monster-float';

  let animClass: string;
  if      (defeatStage === 'impact') animClass = 'monster-defeat-impact';
  else if (defeatStage === 'fall')   animClass = 'monster-defeat-fall';
  else if (showVideo)                animClass = 'opacity-0 pointer-events-none';
  else if (critAnim)                 animClass = 'monster-crit';
  else if (hitAnim)                  animClass = 'monster-hit';
  else                               animClass = idleClass;

  return (
    <div className="pointer-events-none relative flex items-center justify-center">
      <img
        src={monsterImages[imageKey]}
        alt="Monster"
        className={`w-80 h-80 object-contain drop-shadow-2xl ${animClass}`}
      />

      {/* Defeat video — activates automatically once the asset is imported above */}
      {defeatVideo && showVideo && (
        <video
          key="defeat"
          src={defeatVideo}
          autoPlay
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-contain"
          onEnded={() => setShowVideo(false)}
        />
      )}
    </div>
  );
}
