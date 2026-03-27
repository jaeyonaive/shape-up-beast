import { RefObject, useEffect, useState } from 'react';

interface CameraViewProps {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
}

export function CameraView({ videoRef, canvasRef }: CameraViewProps) {
  const [videoRect, setVideoRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateRect = () => {
      if (!video.videoWidth || !video.videoHeight) return;

      const containerW = video.clientWidth;
      const containerH = video.clientHeight;
      const videoAspect = video.videoWidth / video.videoHeight;
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

  return (
    <div className="absolute inset-0 z-0 bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-cover mirror"
        autoPlay
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
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
