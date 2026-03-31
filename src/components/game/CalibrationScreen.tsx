import { type CSSProperties, type Landmark, drawPose } from '@/lib/pose-detection';
import { useRef, useEffect, useState } from 'react';

interface CalibrationScreenProps {
  stream: MediaStream | null;
  landmarks: Landmark[] | null;
  feedback: string;
  calibrationProgress: number;
  formQuality: 'good' | 'needs_work' | 'neutral';
  bodyDetected: boolean;
  isLoading: boolean;
}

export function CalibrationScreen({
  stream,
  landmarks,
  feedback,
  calibrationProgress,
  bodyDetected,
  isLoading,
}: CalibrationScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLandscape, setIsLandscape] = useState(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    return () => { video.srcObject = null; };
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

      {/* Minimal overlay */}
      <div style={{ position: 'fixed', bottom: 32, left: 16, right: 16, zIndex: 10 }}>
        <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
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
      {isLoading && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} className="flex items-center justify-center bg-black/60">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-spin">⏳</div>
            <p className="font-pixel text-xs text-foreground">Starting camera…</p>
          </div>
        </div>
      )}
    </div>
  );
}
