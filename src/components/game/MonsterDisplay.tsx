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

// ── Canvas-based GIF renderer ──────────────────────────────────────────────
// Draws each animated GIF frame onto a canvas, replacing exact-black pixels
// (the baked-in background of the GIF) with transparency.  The bunny's dark
// blue/coloured pixels are NOT near-black so they are preserved intact.
//
// The source <img> must stay visible (not display:none) so iOS Safari
// continues advancing the GIF animation; we hide it with opacity:0.
function DefeatGif({ src }: { src: string }) {
  const imgRef    = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef    = useRef<HTMLCanvasElement | null>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const img    = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    offRef.current = document.createElement('canvas');
    const off    = offRef.current;
    const offCtx = off.getContext('2d')!;
    const visCtx = canvas.getContext('2d')!;

    const processFrame = () => {
      if (!img.complete || img.naturalWidth === 0) {
        rafRef.current = requestAnimationFrame(processFrame);
        return;
      }

      // Sync canvas dimensions to the GIF's natural size
      if (off.width !== img.naturalWidth || off.height !== img.naturalHeight) {
        off.width  = img.naturalWidth;
        off.height = img.naturalHeight;
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }

      // Draw current GIF frame to offscreen canvas
      offCtx.clearRect(0, 0, off.width, off.height);
      offCtx.drawImage(img, 0, 0);

      // Replace near-black pixels (background) with transparent
      const imageData = offCtx.getImageData(0, 0, off.width, off.height);
      const px = imageData.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] < 20 && px[i + 1] < 20 && px[i + 2] < 20) {
          px[i + 3] = 0; // fully transparent
        }
      }
      offCtx.putImageData(imageData, 0, 0);

      // Paint processed frame to visible canvas
      visCtx.clearRect(0, 0, canvas.width, canvas.height);
      visCtx.drawImage(off, 0, 0);

      rafRef.current = requestAnimationFrame(processFrame);
    };

    if (img.complete && img.naturalWidth > 0) {
      processFrame();
    } else {
      img.onload = processFrame;
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      img.onload = null;
    };
  }, []);

  return (
    <div style={{ position: 'relative', maxHeight: '68vh', maxWidth: '88vw' }}>
      {/* Source img drives the GIF animation — must be in layout (not display:none) */}
      <img
        ref={imgRef}
        src={src}
        alt=""
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: '100%',
          height: '100%',
        }}
      />
      {/* Canvas shows the processed frame with black background removed */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          maxHeight: '68vh',
          maxWidth: '88vw',
          width: 'auto',
          height: 'auto',
        }}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

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

      {/* Defeat GIF — canvas-processed to remove black background */}
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
          <DefeatGif src={defeatGifSrc} />
        </div>
      )}
    </div>
  );
}
