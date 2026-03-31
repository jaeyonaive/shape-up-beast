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
  formQuality,
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
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Full-screen camera */}
      <div className="relative flex-1">
        <video
          ref={videoRef}
          className="w-full h-full object-contain bg-black"
          autoPlay playsInline muted
          style={{ transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          className="pointer-events-none"
          style={{
            position: 'absolute',
            top: videoRect?.top ?? 0,
            left: videoRect?.left ?? 0,
            width: videoRect?.width ?? '100%',
            height: videoRect?.height ?? '100%',
            transform: 'scaleX(-1)',
          }}
        />

        {/* Body outline guide when body not detected */}
        {!bodyDetected && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-40 h-72 border-2 border-dashed border-primary/50 rounded-3xl flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full border-2 border-primary/50 mx-auto mb-2" />
                <div className="w-8 h-20 border-2 border-primary/50 mx-auto rounded-lg mb-1" />
                <div className="flex gap-4 justify-center">
                  <div className="w-3 h-16 border-2 border-primary/50 rounded" />
                  <div className="w-3 h-16 border-2 border-primary/50 rounded" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="text-center">
              <div className="text-4xl mb-4 animate-spin">⏳</div>
              <p className="font-pixel text-xs text-foreground">Starting camera…</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom calibration panel */}
      <div className="bg-background/95 backdrop-blur-sm px-4 py-5 safe-area-bottom">
        <div className="max-w-sm mx-auto">
          <div className={`p-4 rounded-xl border-2 text-center ${
            formQuality === 'good' ? 'border-primary bg-primary/10' :
            formQuality === 'needs_work' ? 'border-accent bg-accent/10' :
            'border-border bg-muted/50'
          }`}>
            <p className="font-pixel text-[10px] text-primary mb-2 tracking-widest">CALIBRATING</p>
            <p className="font-body text-sm text-foreground mb-3">{feedback}</p>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${calibrationProgress}%` }}
              />
            </div>
            <p className="font-body text-xs text-muted-foreground mt-2">
              {calibrationProgress}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
