import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { type Landmark, drawPose } from '@/lib/pose-detection';

interface CalibrationScreenProps {
  stream: MediaStream | null;
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
  stream,
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [needsRotation, setNeedsRotation] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      setVideoReady(false);
      return;
    }

    let cancelled = false;
    video.srcObject = stream;
    video.play().then(() => {
      if (!cancelled) setVideoReady(true);
    }).catch(() => {
      // retry once
      setTimeout(() => {
        video.play().then(() => { if (!cancelled) setVideoReady(true); }).catch(() => {});
      }, 500);
    });

    return () => {
      cancelled = true;
      video.srcObject = null;
      setVideoReady(false);
    };
  }, [stream]);

  // Detect if feed is landscape and needs rotation
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const check = () => {
      if (video.videoWidth && video.videoHeight) {
        setNeedsRotation(video.videoWidth > video.videoHeight);
      }
    };

    video.addEventListener('loadedmetadata', check);
    video.addEventListener('resize', check);
    const interval = setInterval(check, 500);

    return () => {
      video.removeEventListener('loadedmetadata', check);
      video.removeEventListener('resize', check);
      clearInterval(interval);
    };
  }, [stream]);

  // Draw pose skeleton on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (landmarks) drawPose(ctx, landmarks, canvas.width, canvas.height);
  }, [landmarks, videoReady]);

  const cameraMessage = error
    ? 'Camera failed to start'
    : cameraActive && videoReady
      ? 'Camera active'
      : cameraStatus === 'requesting-permission'
        ? 'Requesting camera permission…'
        : 'Camera starting…';

  const showLoading = !error && !videoReady && !cameraActive;

  // The rotation transform: if the camera feed is landscape, rotate 90deg
  // so it appears portrait. Also mirror for selfie view.
  const rotation = needsRotation
    ? 'rotate(90deg) scaleX(-1)'
    : 'scaleX(-1)';

  return (
    <>
      {/* ── Camera container: fixed, fills entire viewport ── */}
      <div
        id="camera-container"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          zIndex: 50,
          background: '#000',
        }}
      >
        {/* Video feed: 100% of container, object-fit contain */}
        <video
          ref={videoRef}
          id="camera-feed"
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center center',
            transform: rotation,
          }}
        />

        {/* Canvas overlay for pose skeleton: same size & transform as video */}
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center center',
            transform: rotation,
            pointerEvents: 'none',
            background: 'transparent',
          }}
        />
      </div>

      {/* ── UI overlay: on top of camera ── */}
      <div
        id="ui-overlay"
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
        {/* Bottom calibration bar */}
        <div style={{ position: 'absolute', bottom: 32, left: 16, right: 16, pointerEvents: 'auto' }}>
          <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
            <p className="font-pixel text-[8px] text-muted-foreground mb-1 tracking-wider opacity-70">
              {cameraMessage}
            </p>
            <p className="font-pixel text-[10px] text-primary mb-1.5 tracking-widest">
              {bodyDetected ? 'BODY DETECTED' : 'BODY NOT DETECTED'}
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

        {/* Loading spinner */}
        {showLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40" style={{ pointerEvents: 'auto' }}>
            <div className="text-center px-4">
              <div className="text-4xl mb-4 animate-spin">⏳</div>
              <p className="font-pixel text-xs text-foreground">{cameraMessage}</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70" style={{ pointerEvents: 'auto' }}>
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
