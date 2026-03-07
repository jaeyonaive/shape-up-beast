import { useRef, useEffect, useState, useCallback } from 'react';
import { type Landmark, drawPose } from '@/lib/pose-detection';

declare global {
  interface Window {
    Pose: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    POSE_CONNECTIONS: any;
  }
}

export function usePoseDetection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const poseRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);

  const loadScripts = useCallback(async () => {
    // Load MediaPipe scripts from CDN
    const scripts = [
      'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
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

      await loadScripts();

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      const pose = new window.Pose({
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

        if (results.poseLandmarks) {
          setLandmarks(results.poseLandmarks);
          drawPose(ctx, results.poseLandmarks, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          setLandmarks(null);
        }
      });

      await pose.initialize();
      poseRef.current = pose;

      const camera = new window.Camera(video, {
        onFrame: async () => {
          if (poseRef.current) {
            await poseRef.current.send({ image: video });
          }
        },
        width: 640,
        height: 480,
        facingMode: 'user',
      });

      await camera.start();
      cameraRef.current = camera;
      setCameraActive(true);
      setIsLoading(false);
    } catch (err: any) {
      console.error('Pose detection error:', err);
      setError(err.message || 'Failed to start camera');
      setIsLoading(false);
    }
  }, [loadScripts]);

  const stopCamera = useCallback(() => {
    if (cameraRef.current) {
      cameraRef.current.stop();
      cameraRef.current = null;
    }
    if (poseRef.current) {
      poseRef.current.close();
      poseRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    setCameraActive(false);
    setLandmarks(null);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return {
    videoRef,
    canvasRef,
    landmarks,
    isLoading,
    error,
    cameraActive,
    startCamera,
    stopCamera,
  };
}
