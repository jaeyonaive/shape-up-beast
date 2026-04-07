import { useRef, useEffect, useState, useMemo, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { type Landmark, drawPose } from '@/lib/pose-detection';

interface CalibrationScreenProps {
  stream: MediaStream | null;
  landmarks: Landmark[] | null;
  feedback: string;
  calibrationProgress: number;
  formQuality: 'good' | 'needs_work' | 'neutral';
  bodyDetected: boolean;
  isLoading: boolean;
  cameraActive?: boolean;
  cameraStatus?: 'idle' | 'requesting-permission' | 'starting-camera' | 'camera-active' | 'camera-failed';
  error?: string | null;
  onRetry?: () => void;
}

export function CalibrationScreen({
  stream,
  landmarks,
  feedback,
  calibrationProgress,
  bodyDetected,
  isLoading,
  cameraActive,
  cameraStatus = 'idle',
  error,
  onRetry,
}: CalibrationScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [isLandscapeVideo, setIsLandscapeVideo] = useState(false);

  // ── Step 1: Detect landscape orientation from track settings immediately ──
  // MediaStreamTrack.getSettings() is available as soon as the stream exists,
  // unlike video.videoWidth which can return 0 indefinitely on iOS Safari.
  useEffect(() => {
    if (!stream) {
      setIsLandscapeVideo(false);
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (track) {
      const settings = track.getSettings();
      if (settings.width && settings.height) {
        const landscape = settings.width > settings.height;
        console.log(`[Calibration] Track: ${settings.width}x${settings.height} → ${landscape ? 'landscape' : 'portrait'}`);
        setIsLandscapeVideo(landscape);
      } else {
        // iOS sometimes omits dimensions from getSettings() — fall back to screen
        // orientation: if the phone is portrait the camera delivers landscape frames.
        const phoneIsPortrait = window.innerWidth < window.innerHeight;
        console.log(`[Calibration] No track dimensions; screen portrait=${phoneIsPortrait}`);
        setIsLandscapeVideo(phoneIsPortrait);
      }
    }
  }, [stream]);

  // ── Step 2: Attach stream to the (hidden) video element ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) {
      setVideoReady(false);
      return;
    }
    let cancelled = false;
    const attach = async () => {
      try {
        video.srcObject = stream;
        await video.play();
        if (!cancelled) setVideoReady(video.readyState >= 2);
      } catch (e) {
        console.error('[Calibration] Video attach failed:', e);
        if (!cancelled) setVideoReady(false);
      }
    };
    attach();

    // Confirm readiness when video starts decoding (belt-and-suspenders for iOS)
    const onReady = () => { if (!cancelled) setVideoReady(true); };
    video.addEventListener('canplay', onReady);
    // Also re-confirm landscape detection once video dimensions are available
    const onMeta = () => {
      if (cancelled || !video.videoWidth || !video.videoHeight) return;
      const landscape = video.videoWidth > video.videoHeight;
      setIsLandscapeVideo(landscape);
    };
    video.addEventListener('loadedmetadata', onMeta);

    return () => {
      cancelled = true;
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('loadedmetadata', onMeta);
      video.srcObject = null;
      setVideoReady(false);
    };
  }, [stream]);

  // ── Step 3: Draw skeleton overlay canvas ──
  // Use track settings for dimensions when the display video hasn't decoded yet.
  // This ensures the canvas matches the actual video resolution from frame 1.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Prefer live video dimensions → track settings → safe defaults (in that order)
    const video = videoRef.current;
    const settings = stream?.getVideoTracks()[0]?.getSettings();
    const vw = (video?.videoWidth  > 0 ? video.videoWidth  : null)
            ?? settings?.width
            ?? 640;
    const vh = (video?.videoHeight > 0 ? video.videoHeight : null)
            ?? settings?.height
            ?? 480;

    canvas.width  = vw;
    canvas.height = vh;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, vw, vh);
    if (landmarks) {
      drawPose(ctx, landmarks, vw, vh);
    }
  }, [landmarks, videoReady, stream]);

  // ── Video + canvas style ──
  // Landscape video (iOS): pre-rotate element so CSS width becomes visual height.
  //   width: 100vh (becomes visual height after -90° rotation)
  //   height: 100vw (becomes visual width after -90° rotation)
  //   objectFit: cover — fills the portrait screen without black bars
  //   scaleX(-1) — mirrors for selfie
  //
  // Portrait video (desktop / explicit portrait stream): simple mirror.
  const rotatedStyle: CSSProperties = useMemo(() => ({
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '100vh',
    height: '100vw',
    objectFit: 'cover',
    transform: 'translate(-50%, -50%) rotate(-90deg) scaleX(-1)',
    transformOrigin: 'center center',
    maxWidth: 'none',
    maxHeight: 'none',
  }), []);

  const portraitStyle: CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: 'scaleX(-1)',
  }), []);

  const videoStyle = isLandscapeVideo ? rotatedStyle : portraitStyle;
  // Canvas uses the same transform so the skeleton overlay aligns with the video
  const canvasStyle: CSSProperties = isLandscapeVideo
    ? {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: '100vh',
        height: '100vw',
        transform: 'translate(-50%, -50%) rotate(-90deg) scaleX(-1)',
        transformOrigin: 'center center',
        maxWidth: 'none',
        maxHeight: 'none',
        pointerEvents: 'none',
      }
    : {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        transform: 'scaleX(-1)',
        pointerEvents: 'none',
      };

  const cameraMessage = error
    ? 'Camera failed to start'
    : cameraActive && videoReady
      ? 'Camera active'
      : cameraStatus === 'requesting-permission'
        ? 'Requesting camera permission…'
        : 'Camera starting…';

  const bodyMessage = bodyDetected ? 'Body detected' : 'Body not detected';
  const showLoading = !error && !videoReady && (
    isLoading || cameraStatus === 'requesting-permission' || cameraStatus === 'starting-camera'
  );

  return (
    <>
      {/* Camera layer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          zIndex: 50,
          background: '#000',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={videoStyle}
        />
        <canvas
          ref={canvasRef}
          style={canvasStyle}
        />
      </div>

      {/* HUD layer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 51,
          pointerEvents: 'none',
        }}
      >
        <div style={{ position: 'absolute', bottom: 32, left: 16, right: 16, pointerEvents: 'auto' }}>
          <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
            <p className="font-pixel text-[8px] text-muted-foreground mb-1 tracking-wider opacity-70">
              {cameraMessage}
            </p>
            <p className="font-pixel text-[10px] text-primary mb-1.5 tracking-widest">
              {bodyMessage.toUpperCase()}
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

        {showLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/40"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="text-center px-4">
              <div className="text-4xl mb-4 animate-spin">⏳</div>
              <p className="font-pixel text-xs text-foreground">{cameraMessage}</p>
            </div>
          </div>
        )}

        {error && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/70"
            style={{ pointerEvents: 'auto' }}
          >
            <div className="text-center px-4 max-w-xs">
              <div className="text-4xl mb-4">❌</div>
              <p className="font-pixel text-xs text-destructive mb-2">Camera access required</p>
              <p className="font-body text-sm text-foreground mb-4">{error}</p>
              {onRetry && (
                <Button onClick={onRetry} className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Retry
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
