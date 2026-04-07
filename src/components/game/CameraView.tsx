import { RefObject, useEffect, useRef, useState, useMemo } from 'react';

interface CameraViewProps {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
}

export function CameraView({ videoRef, canvasRef }: CameraViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoRect, setVideoRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [isLandscapeVideo, setIsLandscapeVideo] = useState(false);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateRect = () => {
      if (!video.videoWidth || !video.videoHeight) return;

      const landscape = video.videoWidth > video.videoHeight;
      setIsLandscapeVideo(landscape);

      // Container dimensions — prefer the actual container element over the video element
      // so the measurement isn't affected by the video's own CSS transform.
      const containerW = containerRef.current?.clientWidth ?? video.clientWidth;
      const containerH = containerRef.current?.clientHeight ?? video.clientHeight;
      setContainerSize({ w: containerW, h: containerH });

      // After a 90° rotation the effective display dimensions swap,
      // so use post-rotation virtual dimensions for the canvas rect calculation.
      const vw = landscape ? video.videoHeight : video.videoWidth;
      const vh = landscape ? video.videoWidth : video.videoHeight;
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
  }, [videoRef]);

  // Portrait video (normal case): fill container with contain, mirror horizontally.
  // Landscape video (fallback): swap CSS width/height before rotating 90° so that
  // after the rotation the visual box exactly fills the portrait container.
  const videoStyle = useMemo(() => {
    if (isLandscapeVideo) {
      // Landscape frame displayed in portrait container:
      // Swap viewport dimensions so the element is physically taller than wide,
      // then rotate -90° to make it fill the portrait viewport correctly.
      // scaleX(-1) mirrors (selfie cam flip).
      return {
        position: 'absolute' as const,
        top: '50%',
        left: '50%',
        width: '100vh',   // becomes visual height after -90° rotation
        height: '100vw',  // becomes visual width after -90° rotation
        objectFit: 'cover' as const,
        transform: 'translate(-50%, -50%) rotate(-90deg) scaleX(-1)',
        transformOrigin: 'center center',
        maxWidth: 'none',
        maxHeight: 'none',
      };
    }
    return {
      width: '100%',
      height: '100%',
      objectFit: 'contain' as const,
      objectPosition: 'center center',
      transform: 'scaleX(-1)',
    };
  }, [isLandscapeVideo]);

  return (
    <div ref={containerRef} className="absolute inset-0 z-0 bg-black">
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
        }}
      />
      {/* Dark overlay for readability */}
      <div className="absolute inset-0" style={{ background: 'hsl(var(--game-overlay))' }} />
    </div>
  );
}
