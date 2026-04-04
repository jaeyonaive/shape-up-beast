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
  const [videoReady, setVideoReady] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState<{ w: number; h: number } | null>(null);

  // Attach stream to visible calibration video element
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

        // Wait for metadata before playing
        if (video.readyState < 1) {
          await new Promise<void>((resolve, reject) => {
            const onMeta = () => { video.removeEventListener('loadedmetadata', onMeta); resolve(); };
            video.addEventListener('loadedmetadata', onMeta);
            setTimeout(() => { video.removeEventListener('loadedmetadata', onMeta); reject(new Error('metadata timeout')); }, 5000);
          });
        }

        await video.play();
        if (!cancelled) {
          setVideoReady(true);
          console.log('[Calibration] Video playing:', video.videoWidth, 'x', video.videoHeight);
        }
      } catch (attachError) {
        console.error('[Calibration] Preview attach failed:', attachError);
        // Retry once with muted (autoplay policy)
        if (!cancelled) {
          try {
            video.muted = true;
            await video.play();
            setVideoReady(true);
          } catch {
            setVideoReady(false);
          }
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

  // Track video dimensions for canvas sizing
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateDimensions = () => {
      if (video.videoWidth && video.videoHeight) {
        setVideoDimensions({ w: video.videoWidth, h: video.videoHeight });
        setVideoReady(video.readyState >= 2);
      }
    };

    video.addEventListener('loadedmetadata', updateDimensions);
    video.addEventListener('canplay', updateDimensions);
    video.addEventListener('resize', updateDimensions);
    window.addEventListener('resize', updateDimensions);
    const interval = setInterval(updateDimensions, 300);

    return () => {
      video.removeEventListener('loadedmetadata', updateDimensions);
      video.removeEventListener('canplay', updateDimensions);
      video.removeEventListener('resize', updateDimensions);
      window.removeEventListener('resize', updateDimensions);
      clearInterval(interval);
    };
  }, [stream]);

  // Draw pose skeleton on canvas — aligned to the contain-fit video area
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !videoDimensions) return;

    // Set canvas resolution to match video
    canvas.width = videoDimensions.w;
    canvas.height = videoDimensions.h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (landmarks) {
      drawPose(ctx, landmarks, canvas.width, canvas.height);
    }
  }, [landmarks, videoDimensions]);

  // Full-screen portrait camera: object-fit contain shows the full body (head to feet)
  // scaleX(-1) mirrors so the user sees a natural reflection
  const fullScreenMediaStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    // contain: never crops the body — user always sees head to toe
    objectFit: 'contain',
    objectPosition: 'center center',
    transform: 'scaleX(-1)',
    transformOrigin: 'center center',
    background: '#000',
  };

  const cameraMessage = error
    ? 'Camera failed to start'
    : cameraActive && videoReady
      ? 'Camera active'
      : cameraStatus === 'requesting-permission'
        ? 'Requesting camera permission…'
        : 'Camera starting…';

  const bodyMessage = bodyDetected ? '✓ Body detected' : 'Body not detected';
  const showLoading = !error && !videoReady && (isLoading || cameraStatus === 'requesting-permission' || cameraStatus === 'starting-camera');

  return (
    <>
      {/* Camera layer — full screen, z-50 */}
      <div
        style={{
          position: 'fixed',
          top: 0, left: 0,
          width: '100vw', height: '100vh',
          overflow: 'hidden',
          zIndex: 50,
          background: '#000',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={fullScreenMediaStyle}
        />
        {/* Skeleton overlay canvas — same contain-fit dimensions */}
        <canvas
          ref={canvasRef}
          style={{
            ...fullScreenMediaStyle,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* UI overlay layer — z-51, pointer-events only on interactive elements */}
      <div
        style={{
          position: 'fixed',
          top: 0, left: 0,
          width: '100vw', height: '100vh',
          zIndex: 51,
          pointerEvents: 'none',
        }}
      >
        {/* Status panel — bottom of screen, always visible */}
        <div style={{ position: 'absolute', bottom: 32, left: 16, right: 16, pointerEvents: 'auto' }}>
          <div className="bg-black/70 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
            <p className="font-pixel text-[8px] text-muted-foreground mb-1 tracking-wider opacity-70">
              {cameraMessage}
            </p>
            <p className={`font-pixel text-[10px] mb-1.5 tracking-widest ${bodyDetected ? 'text-primary' : 'text-muted-foreground'}`}>
              {bodyMessage.toUpperCase()}
            </p>
            <p className="font-body text-sm text-foreground">{feedback}</p>
            {/* Calibration progress bar */}
            <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${calibrationProgress}%` }}
              />
            </div>
            <p className="font-pixel text-[8px] text-muted-foreground mt-1 opacity-60">
              {calibrationProgress}% calibrated
            </p>
          </div>
        </div>

        {/* Loading spinner */}
        {showLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50" style={{ pointerEvents: 'auto' }}>
            <div className="text-center px-4">
              <div className="text-4xl mb-4 animate-spin">⏳</div>
              <p className="font-pixel text-xs text-foreground">{cameraMessage}</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80" style={{ pointerEvents: 'auto' }}>
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
