import { useRef, useEffect, useState, useCallback } from 'react';
import { type Landmark } from '@/lib/pose-detection';
// @ts-ignore - mediapipe tasks-vision types
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const CORE_VISIBILITY_THRESHOLD = 0.3;
const LANDMARK_SMOOTHING = 0.35;
const MAX_UNSTABLE_FRAMES = 12;

type CameraStatus = 'idle' | 'requesting-permission' | 'starting-camera' | 'camera-active' | 'camera-failed';

function hasStableCorePose(points: Landmark[]) {
  const coreIndices = [11, 12, 23, 24];
  return coreIndices.every((idx) => {
    const point = points[idx];
    return point && (point.visibility ?? 0) >= CORE_VISIBILITY_THRESHOLD;
  });
}

function smoothLandmarks(points: Landmark[], previous: Landmark[] | null): Landmark[] {
  if (!previous || previous.length !== points.length) return points;

  return points.map((point, index) => {
    const prev = previous[index] ?? point;
    return {
      x: prev.x + (point.x - prev.x) * LANDMARK_SMOOTHING,
      y: prev.y + (point.y - prev.y) * LANDMARK_SMOOTHING,
      z: prev.z + (point.z - prev.z) * LANDMARK_SMOOTHING,
      visibility: Math.max(point.visibility ?? 0, prev.visibility ?? 0),
    };
  });
}

function waitForVideoReady(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Camera stream did not become ready in time'));
    }, 4000);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('canplay', onReady);
    };

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('canplay', onReady);
  });
}

export function usePoseDetection() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const activeRef = useRef(false);
  const startingRef = useRef(false);
  const lastTimestampRef = useRef(-1);
  const smoothedLandmarksRef = useRef<Landmark[] | null>(null);
  const unstableFramesRef = useRef(0);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    startingRef.current = false;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    if (landmarkerRef.current) {
      try {
        landmarkerRef.current.close();
      } catch {}
      landmarkerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.remove();
      videoRef.current = null;
    }

    smoothedLandmarksRef.current = null;
    unstableFramesRef.current = 0;
    lastTimestampRef.current = -1;
    setCameraActive(false);
    setLandmarks(null);
    setStream(null);
    setIsLoading(false);
    setCameraStatus('idle');
  }, []);

  const startCamera = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is not supported on this device');
      }

      stopCamera();
      startingRef.current = true;
      setIsLoading(true);
      setError(null);
      setCameraStatus('requesting-permission');

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
      video.style.pointerEvents = 'none';
      document.body.appendChild(video);
      videoRef.current = video;

      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = cameraStream;
      setStream(cameraStream);
      setCameraStatus('starting-camera');

      video.srcObject = cameraStream;
      await waitForVideoReady(video);
      await video.play();

      setCameraActive(true);
      setCameraStatus('camera-active');
      console.log('[Fitnasia] Camera started:', video.videoWidth, 'x', video.videoHeight);

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
      );

      const modelOptions = {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU' as const,
        },
        runningMode: 'VIDEO' as const,
        numPoses: 1,
        minPoseDetectionConfidence: 0.6,
        minPosePresenceConfidence: 0.6,
        minTrackingConfidence: 0.5,
      };

      let poseLandmarker: PoseLandmarker;
      try {
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, modelOptions);
        console.log('[Fitnasia] PoseLandmarker initialized (GPU)');
      } catch (gpuErr) {
        console.warn('[Fitnasia] GPU delegate failed, falling back to CPU:', gpuErr);
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          ...modelOptions,
          baseOptions: { ...modelOptions.baseOptions, delegate: 'CPU' as const },
        });
        console.log('[Fitnasia] PoseLandmarker initialized (CPU fallback)');
      }

      landmarkerRef.current = poseLandmarker;
      activeRef.current = true;
      lastTimestampRef.current = -1;
      smoothedLandmarksRef.current = null;
      unstableFramesRef.current = 0;
      setIsLoading(false);

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
            const rawLandmarks: Landmark[] = result.landmarks[0].map((lm: any) => ({
              x: lm.x,
              y: lm.y,
              z: lm.z,
              visibility: lm.visibility ?? 1,
            }));

            if (hasStableCorePose(rawLandmarks)) {
              unstableFramesRef.current = 0;
              const nextLandmarks = smoothLandmarks(rawLandmarks, smoothedLandmarksRef.current);
              smoothedLandmarksRef.current = nextLandmarks;
              setLandmarks(nextLandmarks);
            } else {
              unstableFramesRef.current += 1;
              if (unstableFramesRef.current > MAX_UNSTABLE_FRAMES) {
                smoothedLandmarksRef.current = null;
                setLandmarks(null);
              } else if (smoothedLandmarksRef.current) {
                setLandmarks(smoothedLandmarksRef.current);
              }
            }
          } else {
            unstableFramesRef.current += 1;
            if (unstableFramesRef.current > MAX_UNSTABLE_FRAMES) {
              smoothedLandmarksRef.current = null;
              setLandmarks(null);
            }
          }
        } catch (frameError) {
          console.warn('[Fitnasia] Frame error:', frameError);
        }

        if (activeRef.current) {
          rafRef.current = requestAnimationFrame(processFrame);
        }
      };

      rafRef.current = requestAnimationFrame(processFrame);
    } catch (err: any) {
      console.error('[Fitnasia] Camera/Pose error:', err);
      const name = err?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('Camera access required');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setError('Camera failed to start');
      } else {
        setError(err?.message || 'Camera failed to start');
      }
      setCameraActive(false);
      setCameraStatus('camera-failed');
      setIsLoading(false);
      setLandmarks(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setStream(null);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.remove();
        videoRef.current = null;
      }
    } finally {
      startingRef.current = false;
    }
  }, [stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return { landmarks, isLoading, error, cameraActive, cameraStatus, startCamera, stopCamera, stream };
}
