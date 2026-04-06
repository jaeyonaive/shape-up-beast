import { useRef, useEffect, useState, useMemo } from 'react';
import { type Landmark, drawPose } from '@/lib/pose-detection';

interface CameraOverlayProps {
  stream: MediaStream | null;
  landmarks: Landmark[] | null;
}

export function CameraOverlay({ stream, landmarks }: CameraOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoRect, setVideoRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [isLandscapeVideo, setIsLandscapeVideo] = useState(false);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // Match canvas to the visible contained video area so the camera feels zoomed out without cropping
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateRect = () => {
      if (!video.videoWidth || !video.videoHeight) return;

      const landscape = video.videoWidth > video.videoHeight;
      setIsLandscapeVideo(landscape);

      // Use post-rotation dimensions for rect calculation when video is landscape
      const vw = landscape ? video.videoHeight : video.videoWidth;
      const vh = landscape ? video.videoWidth : video.videoHeight;
      const containerW = video.clientWidth;
      const containerH = video.clientHeight;
      const videoAspect = vw / vh;
      const containerAspect = containerW / containerH;

      let renderW: number;
      let renderH: number;
      let offsetX: number;
      let offsetY: number;

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

  // If camera returns landscape video, rotate it -90° so it displays portrait.
  // Swap width/height in CSS so the rotated video fills the container correctly.
  const videoStyle = useMemo(() => {
    if (isLandscapeVideo) {
      return {
        position: 'absolute' as const,
        top: '50%',
        left: '50%',
        width: '100%',
        height: '100%',
        objectFit: 'contain' as const,
        transform: 'translate(-50%, -50%) rotate(-90deg) scaleX(-1)',
        transformOrigin: 'center center',
        maxWidth: 'none',
        maxHeight: 'none',
      };
    }
    return { transform: 'scaleX(-1)' };
  }, [isLandscapeVideo]);

  if (!stream) return null;

  return (
    <div className="relative w-full h-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        className={isLandscapeVideo ? 'bg-black' : 'w-full h-full object-contain bg-black'}
        autoPlay
        playsInline
        muted
        style={videoStyle}
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
    </div>
  );
}
