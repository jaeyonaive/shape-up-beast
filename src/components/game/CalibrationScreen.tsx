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
      const cW = video.clientWidth;
      const cH = video.clientHeight;
      const vA = video.videoWidth / video.videoHeight;
      const cA = cW / cH;
      let rW: number, rH: number, oX: number, oY: number;
      if (vA > cA) { rW = cW; rH = cW / vA; oX = 0; oY = (cH - rH) / 2; }
      else { rH = cH; rW = cH * vA; oX = (cW - rW) / 2; oY = 0; }
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

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Full-screen camera — NO container, NO cropping */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay playsInline muted
        style={{ transform: 'scaleX(-1)' }}
      />
      <canvas
        ref={canvasRef}
        className="absolute pointer-events-none"
        style={{
          top: videoRect?.top ?? 0,
          left: videoRect?.left ?? 0,
          width: videoRect?.width ?? '100%',
          height: videoRect?.height ?? '100%',
          transform: 'scaleX(-1)',
        }}
      />

      {/* Minimal overlay text only */}
      <div className="absolute bottom-8 left-4 right-4 z-10">
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-spin">⏳</div>
            <p className="font-pixel text-xs text-foreground">Starting camera…</p>
          </div>
        </div>
      )}
    </div>
  );
}
