import { RefObject, useEffect, useState, useMemo } from 'react';

interface CameraViewProps {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
}

export function CameraView({ videoRef, canvasRef }: CameraViewProps) {
  const [videoRect, setVideoRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [isLandscapeVideo, setIsLandscapeVideo] = useState(false);

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

      let renderW: number, renderH: number, offsetX: number, offsetY: number;

      if (videoAspect > containerAspect) {
        // Video wider than container — letterbox top/bottom
        renderW = containerW;
        renderH = containerW / videoAspect;
        offsetX = 0;
        offsetY = (containerH - renderH) / 2;
      } else {
        // Video taller — pillarbox left/right
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
    // Also poll briefly in case events are missed
    const interval = setInterval(updateRect, 500);

    return () => {
      video.removeEventListener('loadedmetadata', updateRect);
      video.removeEventListener('resize', updateRect);
      window.removeEventListener('resize', updateRect);
      clearInterval(interval);
    };
  }, [videoRef]);

  // If camera returns landscape video, rotate it so it displays portrait.
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

  return (
    <div className="absolute inset-0 z-0 bg-black">
      <video
        ref={videoRef}
        className={isLandscapeVideo ? 'bg-black' : 'w-full h-full object-contain'}
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
        }}
      />
      {/* Dark overlay for readability */}
      <div className="absolute inset-0" style={{ background: 'hsl(var(--game-overlay))' }} />
    </div>
  );
}
