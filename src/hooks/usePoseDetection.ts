import { useRef, useEffect, useState, useCallback } from 'react';
import { type Landmark, drawPose } from '@/lib/pose-detection';
// @ts-ignore - mediapipe tasks-vision types
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export function usePoseDetection() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const activeRef = useRef(false);
  const lastTimestampRef = useRef(-1);

  const startCamera = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Create hidden video and canvas elements programmatically
      if (!videoRef.current) {
        const video = document.createElement('video');
        video.setAttribute('autoplay', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('muted', '');
        video.muted = true;
        video.style.position = 'fixed';
        video.style.top = '-9999px';
        video.style.left = '-9999px';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.opacity = '0';
        video.style.pointerEvents = 'none';
        document.body.appendChild(video);
        videoRef.current = video;
      }

      if (!canvasRef.current) {
        const canvas = document.createElement('canvas');
        canvas.style.display = 'none';
        document.body.appendChild(canvas);
        canvasRef.current = canvas;
      }

      // Get camera
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 1280 }, aspectRatio: { ideal: 9/16 } },
        audio: false,
      });
      streamRef.current = cameraStream;
      setStream(cameraStream);

      const video = videoRef.current;
      const canvas = canvasRef.current;

      video.srcObject = stream;
      await video.play();
      console.log('[FitMon] Camera started:', video.videoWidth, 'x', video.videoHeight);

      // Initialize MediaPipe Tasks Vision PoseLandmarker
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
      );

      const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      console.log('[FitMon] PoseLandmarker (heavy model) initialized');
      landmarkerRef.current = poseLandmarker;
      activeRef.current = true;
      setCameraActive(true);
      setIsLoading(false);
      lastTimestampRef.current = -1;

      // Detection loop
      const processFrame = () => {
        if (!activeRef.current || !landmarkerRef.current) return;
        if (!video || video.readyState < 2) {
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }

        const now = performance.now();
        if (now <= lastTimestampRef.current) {
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }
        lastTimestampRef.current = now;

        try {
          const result = landmarkerRef.current.detectForVideo(video, now);

          if (result.landmarks && result.landmarks.length > 0) {
            const poseLandmarks: Landmark[] = result.landmarks[0].map((lm: any) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
              visibility: lm.visibility ?? 1,
            }));
            setLandmarks(poseLandmarks);
          } else {
            setLandmarks(null);
          }
        } catch (e) {
          console.warn('[FitMon] Frame error:', e);
        }

        if (activeRef.current) {
          rafRef.current = requestAnimationFrame(processFrame);
        }
      };
      rafRef.current = requestAnimationFrame(processFrame);

    } catch (err: any) {
      console.error('[FitMon] Camera/Pose error:', err);
      if (err.name === 'NotAllowedError') {
        setError('Camera permission denied. Please allow camera access.');
      } else {
        setError(err.message || 'Failed to start camera');
      }
      setIsLoading(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (landmarkerRef.current) {
      try { landmarkerRef.current.close(); } catch {}
      landmarkerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.remove();
      videoRef.current = null;
    }
    if (canvasRef.current) {
      canvasRef.current.remove();
      canvasRef.current = null;
    }
    setCameraActive(false);
    setLandmarks(null);
    setStream(null);
  }, []);

  useEffect(() => {
    return () => { stopCamera(); };
  }, [stopCamera]);

  return { landmarks, isLoading, error, cameraActive, startCamera, stopCamera, stream };
}
