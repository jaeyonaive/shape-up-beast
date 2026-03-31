import { type Landmark, drawPose } from '@/lib/pose-detection';
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
  const [videoRect, setVideoRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [isLandscape, setIsLandscape] = useState(false);

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

      // Detect if camera feed is landscape (wider than tall)
      const feedIsLandscape = video.videoWidth > video.videoHeight;
      setIsLandscape(feedIsLandscape);

      // If landscape feed, we rotate it 90deg so it appears portrait.
      // The effective dimensions after rotation swap.
      const effectiveW = feedIsLandscape ? video.videoHeight : video.videoWidth;
      const effectiveH = feedIsLandscape ? video.videoWidth : video.videoHeight;

      const screenW = window.innerWidth;
      const screenH = window.innerHeight;
      const feedAspect = effectiveW / effectiveH;
      const screenAspect = screenW / screenH;

      let rW: number, rH: number, oX: number, oY: number;
      if (feedAspect > screenAspect) {
        rW = screenW;
        rH = screenW / feedAspect;
        oX = 0;
        oY = (screenH - rH) / 2;
      } else {
        rH = screenH;
        rW = screenH * feedAspect;
        oX = (screenW - rW) / 2;
        oY = 0;
      }
      setVideoRect({ top: oY, left: oX, width: rW, height: rH });
    };
    video.addEventListener('loadedmetadata', updateRect);
    window.addEventListener('resize', updateRect);
    const interval = setInterval(updateRect, 500);
    return () => {
      video.removeEventListener('loadedmetadata', updateRect);
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

  // Build transform: mirror + optional 90deg rotation for landscape feeds
  const videoTransform = isLandscape
    ? 'scaleX(-1) rotate(90deg)'
    : 'scaleX(-1)';
  const canvasTransform = isLandscape
    ? 'scaleX(-1) rotate(90deg)'
    : 'scaleX(-1)';

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 50, background: '#000' }}>
      {/* Full-screen camera: position fixed, object-contain, no container */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          objectFit: 'contain',
          background: '#000',
          transform: videoTransform,
        }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          top: videoRect?.top ?? 0,
          left: videoRect?.left ?? 0,
          width: videoRect?.width ?? '100vw',
          height: videoRect?.height ?? '100vh',
          transform: canvasTransform,
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
