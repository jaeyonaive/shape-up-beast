import { useRef, useEffect, useState, useMemo, type CSSProperties } from 'react';
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
  const [isLandscapeVideo, setIsLandscapeVideo] = useState(false);
  const [videoRect, setVideoRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

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
          setVideoReady(video.readyState >= 2);
        }
      } catch (attachError) {
        console.error('[Fitnasia] Calibration preview failed:', attachError);
        if (!cancelled) setVideoReady(false);
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

    const updateMetrics = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      setVideoReady(video.readyState >= 2);

      const landscape = video.videoWidth > video.videoHeight;
      setIsLandscapeVideo(landscape);

      // Compute actual rendered video area so the canvas can align to it.
      // When landscape video is rotated 90° via CSS the rendered dimensions swap,
      // so we use the post-rotation virtual width/height for the calculation.
      const vw = landscape ? video.videoHeight : video.videoWidth;
      const vh = landscape ? video.videoWidth : video.videoHeight;
      const containerW = window.innerWidth;
      const containerH = window.innerHeight;
      const videoAspect = vw / vh;
      const containerAspect = containerW / containerH;

      let renderW: number, renderH: number, offsetX: number, offsetY: number;
      if (videoAspect > containerAspect) {
        renderW = containerW;
        renderH = containerW / videoAspect;
        offsetX = 0;
        offsetY = (containerH - renderH) / 2;
      } else {
        renderH = containerH;
        renderW = containerH * videoAspect;
        offsetX = (containerW - renderW) / 2;
        offsetY = 0;
      }
      setVideoRect({ top: offsetY, left: offsetX, width: renderW, height: renderH });
    };

    video.addEventListener('loadedmetadata', updateMetrics);
    video.addEventListener('canplay', updateMetrics);
    video.addEventListener('resize', updateMetrics);
    window.addEventListener('resize', updateMetrics);
    const interval = setInterval(updateMetrics, 300);

    return () => {
      video.removeEventListener('loadedmetadata', updateMetrics);
      video.removeEventListener('canplay', updateMetrics);
      video.removeEventListener('resize', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      clearInterval(interval);
    };
  }, [stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (landmarks) {
      drawPose(ctx, landmarks, canvas.width, canvas.height);
    }
  }, [landmarks, videoReady]);

  // Portrait video (normal): fill the fixed full-screen container with contain + mirror.
  // Landscape video (fallback): CSS width/height are swapped before a 90° rotation so
  // that after the turn the visual box fills the portrait viewport exactly.
  const videoStyle: CSSProperties = useMemo<CSSProperties>(() => {
    if (isLandscapeVideo) {
      return {
        position: 'absolute',
        top: '50%',
        left: '50%',
        // CSS width becomes visual height after rotation, and vice-versa.
        width: '100vh',
        height: '100vw',
        objectFit: 'contain',
        objectPosition: 'center center',
        transform: 'translate(-50%, -50%) rotate(-90deg) scaleX(-1)',
        transformOrigin: 'center center',
        maxWidth: 'none',
        maxHeight: 'none',
        background: 'transparent',
      };
    }
    return {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      objectPosition: 'center center',
      transform: 'scaleX(-1)',
    };
  }, [isLandscapeVideo]);

  const cameraMessage = error
    ? 'Camera failed to start'
    : cameraActive && videoReady
      ? 'Camera active'
      : cameraStatus === 'requesting-permission'
        ? 'Requesting camera permission…'
        : 'Camera starting…';

  const bodyMessage = bodyDetected ? 'Body detected' : 'Body not detected';
  const showLoading = !error && !videoReady && (isLoading || cameraStatus === 'requesting-permission' || cameraStatus === 'starting-camera');

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          zIndex: 50,
          background: 'hsl(0 0% 0%)',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={videoStyle}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: videoRect?.top ?? 0,
            left: videoRect?.left ?? 0,
            width: videoRect?.width ?? '100%',
            height: videoRect?.height ?? '100%',
            transform: 'scaleX(-1)',
            pointerEvents: 'none',
          }}
        />
      </div>

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
          <div className="absolute inset-0 flex items-center justify-center bg-black/40" style={{ pointerEvents: 'auto' }}>
            <div className="text-center px-4">
              <div className="text-4xl mb-4 animate-spin">⏳</div>
              <p className="font-pixel text-xs text-foreground">{cameraMessage}</p>
            </div>
          </div>
        )}

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
