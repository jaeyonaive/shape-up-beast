import { RefObject } from 'react';

interface CameraViewProps {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
}

export function CameraView({ videoRef, canvasRef }: CameraViewProps) {
  return (
    <div className="absolute inset-0 z-0 bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-contain mirror"
        autoPlay
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain"
        style={{ transform: 'scaleX(-1)' }}
      />
      {/* Dark overlay for readability */}
      <div className="absolute inset-0" style={{ background: 'hsl(var(--game-overlay))' }} />
    </div>
  );
}
