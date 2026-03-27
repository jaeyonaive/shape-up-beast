import { useRef, useEffect } from 'react';
import { type Landmark, drawPose } from '@/lib/pose-detection';

interface CameraOverlayProps {
  stream: MediaStream | null;
  landmarks: Landmark[] | null;
}

export function CameraOverlay({ stream, landmarks }: CameraOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    return () => { video.srcObject = null; };
  }, [stream]);

  // Draw AR skeleton overlay
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

  if (!stream) return null;

  return (
    <div className="relative w-full h-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ transform: 'scaleX(-1)' }}
      />
    </div>
  );
}
