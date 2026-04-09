import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type Landmark } from '@/lib/pose-detection';

// ── Skeleton drawing ──────────────────────────────────────────────────────────

const CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];
const KEY_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

/**
 * Draw the pose skeleton onto the canvas at positions given by toX/toY.
 * Coordinates are in canvas-pixel space (not normalised 0-1).
 */
function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  toX: (lm: Landmark) => number,
  toY: (lm: Landmark) => number,
) {
  ctx.save();

  ctx.strokeStyle = 'hsl(200, 85%, 55%)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';

  for (const [i, j] of CONNECTIONS) {
    const s = landmarks[i];
    const e = landmarks[j];
    if (s && e) {
      ctx.beginPath();
      ctx.moveTo(toX(s), toY(s));
      ctx.lineTo(toX(e), toY(e));
      ctx.stroke();
    }
  }

  for (const idx of KEY_POINTS) {
    const lm = landmarks[idx];
    if (lm) {
      ctx.beginPath();
      ctx.arc(toX(lm), toY(lm), 6, 0, 2 * Math.PI);
      ctx.fillStyle = 'hsl(145, 80%, 50%)';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CalibrationScreenProps {
  /** Ref to the hidden video element managed by usePoseDetection. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  landmarks: Landmark[] | null;
  feedback: string;
  calibrationProgress: number;
  formQuality: 'good' | 'needs_work' | 'neutral';
  bodyDetected: boolean;
  isLoading: boolean;
  cameraActive?: boolean;
  cameraStatus?: 'idle' | 'requesting-permission' | 'starting-camera' | 'camera-active' | 'camera-failed';
  error?: string | null;
  onRetry?: () => void;
}

export function CalibrationScreen({
  videoRef,
  landmarks,
  feedback,
  calibrationProgress,
  bodyDetected,
  isLoading,
  cameraActive,
  cameraStatus = 'idle',
  error,
  onRetry,
}: CalibrationScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep the latest landmarks in a ref so the RAF loop can read them without
  // restarting the loop every time landmarks change.
  const landmarksRef = useRef<Landmark[] | null>(null);
  useEffect(() => { landmarksRef.current = landmarks; }, [landmarks]);

  // Signal that the canvas has drawn its first frame (used to hide the spinner).
  const canvasReadyRef = useRef(false);
  const [canvasReady, setCanvasReady] = useState(false);

  // ── Canvas render loop ────────────────────────────────────────────────────
  //
  // This is the key fix for iOS Safari: CSS transforms on <video> elements are
  // unreliable — WebKit sometimes renders the video at its native orientation
  // regardless of the transform property.  Drawing the video into a <canvas>
  // via ctx.drawImage() with explicit ctx.rotate() / ctx.scale() is 100%
  // reliable across all browsers.
  //
  // The loop runs once per animation frame.  It reads from the same hidden
  // video element that MediaPipe uses (shared via videoRef), so there is only
  // ONE video element consuming the stream — avoiding iOS double-decode issues.

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId: number;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;

      const video = videoRef.current;

      if (
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;

        // Use CSS pixels so the canvas matches the visible viewport exactly.
        const W = window.innerWidth;
        const H = window.innerHeight;

        if (canvas.width !== W || canvas.height !== H) {
          canvas.width = W;
          canvas.height = H;
        }

        if (!canvasReadyRef.current) {
          canvasReadyRef.current = true;
          setCanvasReady(true);
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) { rafId = requestAnimationFrame(draw); return; }

        ctx.clearRect(0, 0, W, H);

        const lmk = landmarksRef.current;

        // Rotate only when the video is landscape AND the screen is portrait.
        // This covers iOS (front camera always delivers a landscape frame when
        // the phone is held upright).  Desktop cameras in landscape screens
        // are intentionally NOT rotated.
        const needsRotation = vw > vh && W < H;

        if (needsRotation) {
          // ── Landscape video → portrait screen ──────────────────────────
          //
          // Strategy:
          //   1. Rotate the canvas context -90° (CCW).
          //   2. Mirror horizontally (selfie view).
          //   3. Scale the video to COVER the portrait canvas.
          //
          // After the -90° rotation the video's effective visual size becomes
          // vh × vw (width × height), so we derive the cover scale relative to
          // those swapped dimensions.
          const scale = Math.max(W / vh, H / vw);
          const drawW = vw * scale;   // video's long edge, maps to canvas height
          const drawH = vh * scale;   // video's short edge, maps to canvas width

          ctx.save();
          ctx.translate(W / 2, H / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.scale(-1, 1);           // selfie mirror
          ctx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();

          // ── Landmark coordinate transform (landscape → portrait canvas) ──
          //
          // Derivation (applying scale→rotate→translate in that order to a
          // video-space point at local coords (lx, ly) = (lm.x·drawW − drawW/2,
          //                                               lm.y·drawH − drawH/2)):
          //
          //   scale(-1,1): (-lx, ly)
          //   rotate(-π/2): (ly, lx)            [note: −(−lx) = lx]
          //   translate(W/2,H/2): (ly+W/2, lx+H/2)
          //
          // Substituting back:
          //   canvas_x = lm.y · drawH + (W − drawH) / 2
          //   canvas_y = lm.x · drawW + (H − drawW) / 2
          if (lmk) {
            const ox = (W - drawH) / 2;
            const oy = (H - drawW) / 2;
            drawSkeleton(ctx, lmk,
              (lm) => lm.y * drawH + ox,
              (lm) => lm.x * drawW + oy,
            );
          }
        } else {
          // ── Portrait video (or landscape video in landscape screen) ─────
          //
          // Just scale to COVER and mirror horizontally.
          const scale = Math.max(W / vw, H / vh);
          const drawW = vw * scale;
          const drawH = vh * scale;

          ctx.save();
          ctx.translate(W / 2, H / 2);
          ctx.scale(-1, 1);           // selfie mirror
          ctx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();

          // ── Landmark coordinate transform (portrait canvas, mirrored) ───
          //
          // Derivation for scale(-1,1) + translate(W/2,H/2):
          //   canvas_x = (1 − lm.x) · drawW + (W − drawW) / 2
          //   canvas_y =       lm.y  · drawH + (H − drawH) / 2
          if (lmk) {
            const ox = (W - drawW) / 2;
            const oy = (H - drawH) / 2;
            drawSkeleton(ctx, lmk,
              (lm) => (1 - lm.x) * drawW + ox,
              (lm) => lm.y * drawH + oy,
            );
          }
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => { cancelled = true; cancelAnimationFrame(rafId); };
  }, [videoRef]);   // videoRef object is stable; .current is read each frame

  // ── UI strings ────────────────────────────────────────────────────────────

  const cameraMessage = error
    ? 'Camera failed to start'
    : cameraActive && canvasReady
      ? 'Camera active'
      : cameraStatus === 'requesting-permission'
        ? 'Requesting camera permission…'
        : 'Camera starting…';

  const bodyMessage = bodyDetected ? 'Body detected' : 'Body not detected';

  const showLoading = !error && !canvasReady && (
    isLoading ||
    cameraStatus === 'requesting-permission' ||
    cameraStatus === 'starting-camera'
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Camera + skeleton layer: a single canvas replaces the <video> element.
          Canvas 2D transforms are reliable on iOS; CSS transforms on <video>
          are not — that is why we use this approach. */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          display: 'block',
          zIndex: 50,
          background: '#000',
        }}
      />

      {/* HUD layer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 51,
          pointerEvents: 'none',
        }}
      >
        <div style={{ position: 'absolute', bottom: 32, left: 16, right: 16, pointerEvents: 'auto' }}>
          <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
            <p className="font-pixel text-[8px] text-muted-foreground mb-1 tracking-wider opacity-70">
              {cameraMessage}
            </p>
            <p className="font-pixel text-[10px] text-primary mb-1.5 tracking-widest">
              {bodyMessage.toUpperCase()}
            </p>
            <p className="font-body text-sm text-foreground">{feedback}</p>
            <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${calibrationProgress}%` }}
              />
            </div>
          </div>
        </div>

        {showLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/40"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="text-center px-4">
              <div className="text-4xl mb-4 animate-spin">⏳</div>
              <p className="font-pixel text-xs text-foreground">{cameraMessage}</p>
            </div>
          </div>
        )}

        {error && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/70"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="text-center px-4 max-w-xs">
              <div className="text-4xl mb-4">❌</div>
              <p className="font-pixel text-xs text-destructive mb-2">Camera access required</p>
              <p className="font-body text-sm text-foreground mb-4">{error}</p>
              {onRetry && (
                <Button onClick={onRetry} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Retry
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
