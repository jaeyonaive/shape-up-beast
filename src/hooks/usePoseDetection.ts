import { useRef, useEffect, useState, useCallback } from 'react';
import { type Landmark, drawPose } from '@/lib/pose-detection';

export function usePoseDetection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const poseRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const activeRef = useRef(false);

  const loadScripts = useCallback(async () => {
    const scripts = [
      'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js',
      'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js',
    ];
    for (const src of scripts) {
      if (document.querySelector(`script[src="${src}"]`)) continue;
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
      });
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // CRITICAL: getUserMedia directly in click handler
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error('Video element not ready');
      }

      video.srcObject = stream;
      await video.play();
      console.log('[FitMon] Camera started, video size:', video.videoWidth, 'x', video.videoHeight);

      // Load MediaPipe after camera is running
      await loadScripts();
      console.log('[FitMon] MediaPipe scripts loaded');

      const pose = new (window as any).Pose({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults((results: any) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        if (results.poseLandmarks && results.poseLandmarks.length > 0) {
          setLandmarks([...results.poseLandmarks]);
          drawPose(ctx, results.poseLandmarks, canvas.width, canvas.height);
        } else {
          console.log('[FitMon] No pose detected in frame');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          setLandmarks(null);
        }
      });

      await pose.initialize();
      console.log('[FitMon] Pose model initialized');
      poseRef.current = pose;
      activeRef.current = true;
      setCameraActive(true);
      setIsLoading(false);

      // Detection loop
      const processFrame = async () => {
        if (!activeRef.current || !poseRef.current) return;
        if (!video || video.readyState < 2) {
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }
        try {
          await poseRef.current.send({ image: video });
        } catch (e) {
          console.warn('[FitMon] Frame processing error:', e);
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
  }, [loadScripts]);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (poseRef.current) {
      try { poseRef.current.close(); } catch {}
      poseRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setLandmarks(null);
  }, []);

  useEffect(() => {
    return () => { stopCamera(); };
  }, [stopCamera]);

  return { videoRef, canvasRef, landmarks, isLoading, error, cameraActive, startCamera, stopCamera };
}
