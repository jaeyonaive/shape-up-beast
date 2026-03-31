import { useRef, useEffect, useState, type CSSProperties } from 'react';
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
  const [isLandscape, setIsLandscape] = useState(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      setVideoReady(false);
      return;
    }

    let cancelled = false;
    const attachStream = async () => {
      try {
        video.srcObject = stream;
        await video.play();
        if (!cancelled) {
          setVideoReady(true);
          console.log('[Fitnasia] Calibration preview active:', video.videoWidth, 'x', video.videoHeight);
        }
      } catch (attachError) {
        console.error('[Fitnasia] Calibration preview failed:', attachError);
        if (!cancelled) {
          setVideoReady(false);
        }
      }
    };

    attachStream();

    return () => {
      cancelled = true;
      video.srcObject = null;
      setVideoReady(false);
    };
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateRect = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      setIsLandscape(video.videoWidth > video.videoHeight);
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setVideoReady(video.readyState >= 2);
    };

    video.addEventListener('loadedmetadata', updateRect);
    video.addEventListener('canplay', updateRect);
    video.addEventListener('resize', updateRect);
    window.addEventListener('resize', updateRect);
    const interval = setInterval(updateRect, 500);

    return () => {
      video.removeEventListener('loadedmetadata', updateRect);
      video.removeEventListener('canplay', updateRect);
      video.removeEventListener('resize', updateRect);
      window.removeEventListener('resize', updateRect);
      clearInterval(interval);
    };
  }, [stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!landmarks || !video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    drawPose(ctx, landmarks, canvas.width, canvas.height);
  }, [landmarks, videoReady]);

  const renderWidth = isLandscape ? `${viewport.height}px` : '100vw';
  const renderHeight = isLandscape ? `${viewport.width}px` : '100vh';

  const sharedCameraStyle: CSSProperties = {
    position: 'fixed',
    top: '50%',
    left: '50%',
    width: renderWidth,
    height: renderHeight,
    objectFit: 'contain',
    transform: isLandscape
      ? 'translate(-50%, -50%) rotate(90deg) scaleX(-1)'
      : 'translate(-50%, -50%) scaleX(-1)',
    transformOrigin: 'center center',
  };

  const cameraMessage = error
    ? 'Camera failed to start'
    : cameraStatus === 'requesting-permission'
      ? 'Requesting camera permission…'
      : cameraStatus === 'starting-camera'
        ? 'Camera starting…'
        : cameraActive && videoReady
          ? 'Camera active'
          : isLoading
            ? 'Camera starting…'
            : 'Requesting camera permission…';

  const showLoadingOverlay = !error && !videoReady && (cameraStatus === 'requesting-permission' || cameraStatus === 'starting-camera' || !stream);

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 50, background: '#000' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={sharedCameraStyle}
      />
      <canvas
        ref={canvasRef}
        style={{
          ...sharedCameraStyle,
          pointerEvents: 'none',
          background: 'transparent',
        }}
      />

      <div style={{ position: 'fixed', bottom: 32, left: 16, right: 16, zIndex: 10 }}>
        <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
          <p className="font-pixel text-[8px] text-muted-foreground mb-1 tracking-wider opacity-70">
            {cameraMessage}
          </p>
          <p className="font-pixel text-[10px] text-primary mb-1.5 tracking-widest">
            {bodyDetected ? 'BODY DETECTED' : 'CALIBRATING'}
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

      {showLoadingOverlay && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} className="flex items-center justify-center bg-black/40">
          <div className="text-center px-4">
            <div className="text-4xl mb-4 animate-spin">⏳</div>
            <p className="font-pixel text-xs text-foreground">{cameraMessage}</p>
          </div>
        </div>
      )}

      {error && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} className="flex items-center justify-center bg-black/70">
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
  );
}
