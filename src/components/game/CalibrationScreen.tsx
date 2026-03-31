import { type Landmark, drawPose } from '@/lib/pose-detection';
import { useRef, useEffect, useState, type CSSProperties } from 'react';

interface CalibrationScreenProps {
  stream: MediaStream | null;
  landmarks: Landmark[] | null;
  feedback: string;
  calibrationProgress: number;
  formQuality: 'good' | 'needs_work' | 'neutral';
  bodyDetected: boolean;
  isLoading: boolean;
  cameraActive?: boolean;
  error?: string | null;
}

export function CalibrationScreen({
  stream,
  landmarks,
  feedback,
  calibrationProgress,
  bodyDetected,
  isLoading,
  cameraActive,
  error,
}: CalibrationScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLandscape, setIsLandscape] = useState(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [videoReady, setVideoReady] = useState(false);

  // Debug status
  const debugStatus = error
    ? `Camera failed: ${error}`
    : isLoading
    ? 'Camera starting…'
    : !stream
    ? 'Requesting camera permission…'
    : !videoReady
    ? 'Attaching camera stream…'
    : cameraActive
    ? 'Camera active'
    : 'Camera starting…';

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      setVideoReady(false);
      return;
    }
    // Always re-attach stream
    video.srcObject = stream;
    video.play().then(() => {
      setVideoReady(true);
      console.log('[Fitnasia] CalibrationScreen video playing:', video.videoWidth, 'x', video.videoHeight);
    }).catch((e) => {
      console.error('[Fitnasia] CalibrationScreen video play failed:', e);
      // Retry after a short delay
      setTimeout(() => {
        video.play().then(() => setVideoReady(true)).catch(() => {});
      }, 500);
    });
    return () => {
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
    };

    video.addEventListener('loadedmetadata', updateRect);
    video.addEventListener('resize', updateRect);
    window.addEventListener('resize', updateRect);
    const interval = setInterval(updateRect, 500);

    return () => {
      video.removeEventListener('loadedmetadata', updateRect);
      video.removeEventListener('resize', updateRect);
      window.removeEventListener('resize', updateRect);
      clearInterval(interval);
    };
  }, [stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !landmarks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 1280;
    drawPose(ctx, landmarks, canvas.width, canvas.height);
  }, [landmarks]);

  const renderWidth = isLandscape ? `${viewport.height}px` : '100vw';
  const renderHeight = isLandscape ? `${viewport.width}px` : '100vh';

  const sharedCameraStyle: CSSProperties = {
    position: 'fixed',
    top: '50%',
    left: '50%',
    width: renderWidth,
    height: renderHeight,
    objectFit: 'contain',
    background: '#000',
    transform: isLandscape
      ? 'translate(-50%, -50%) rotate(90deg) scaleX(-1)'
      : 'translate(-50%, -50%) scaleX(-1)',
    transformOrigin: 'center center',
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 50, background: '#000' }}>
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
        }}
      />

      {/* Debug status + calibration overlay */}
      <div style={{ position: 'fixed', bottom: 32, left: 16, right: 16, zIndex: 10 }}>
        <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
          {/* Debug camera status */}
          <p className="font-pixel text-[8px] text-muted-foreground mb-1 tracking-wider opacity-70">
            {debugStatus}
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

      {/* Loading state */}
      {(isLoading || !stream) && !error && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} className="flex items-center justify-center bg-black/60">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-spin">⏳</div>
            <p className="font-pixel text-xs text-foreground">
              {!stream ? 'Requesting camera…' : 'Starting camera…'}
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} className="flex items-center justify-center bg-black/80">
          <div className="text-center px-4">
            <div className="text-4xl mb-4">❌</div>
            <p className="font-pixel text-xs text-destructive mb-2">Camera Failed</p>
            <p className="font-body text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}