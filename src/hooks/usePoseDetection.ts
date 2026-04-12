import { useRef, useEffect, useState, useCallback } from 'react';
import { type Landmark } from '@/lib/pose-detection';
// @ts-ignore - mediapipe tasks-vision types
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// ── Tuning constants ──────────────────────────────────────────────────────────

/**
 * Minimum visibility score required at shoulders, hips AND knees before we
 * accept a detection result. 0.6 rejects hands/objects and partial occlusion
 * while still accepting normally-lit subjects.
 */
const CORE_VISIBILITY_THRESHOLD = 0.6;

/**
 * EMA blending factor for landmark smoothing.
 * 0 = frozen (never updates), 1 = no smoothing.
 * 0.35 gives ~3-frame lag which removes jitter without losing responsiveness.
 */
const LANDMARK_SMOOTHING = 0.35;

/**
 * Consecutive frames without a stable core pose before we clear stale landmarks.
 * 8 frames ≈ 130 ms at 60 fps — short enough to feel responsive.
 */
const MAX_UNSTABLE_FRAMES = 8;

type CameraStatus =
  | 'idle'
  | 'requesting-permission'
  | 'starting-camera'
  | 'camera-active'
  | 'camera-failed';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Shoulders (11, 12) and hips (23, 24) must all exceed the visibility threshold.
 * These four landmarks form the "core" — if they are not reliably detected the
 * downstream exercise logic should not run.
 */
function hasStableCorePose(pts: Landmark[]): boolean {
  return [11, 12, 23, 24, 25, 26].every(
    i => (pts[i]?.visibility ?? 0) >= CORE_VISIBILITY_THRESHOLD,
  );
}

/** Per-landmark exponential moving average in raw video coordinate space. */
function smoothLandmarks(curr: Landmark[], prev: Landmark[] | null): Landmark[] {
  if (!prev || prev.length !== curr.length) return curr;
  return curr.map((pt, i) => {
    const p = prev[i] ?? pt;
    const a = LANDMARK_SMOOTHING;
    return {
      x:          p.x          + a * (pt.x          - p.x),
      y:          p.y          + a * (pt.y          - p.y),
      z:          p.z          + a * (pt.z          - p.z),
      visibility: Math.max(pt.visibility ?? 0, p.visibility ?? 0),
    };
  });
}

/**
 * Waits until video.videoWidth > 0 (not just until metadata is loaded).
 *
 * On iOS Safari, 'loadedmetadata' and 'canplay' both fire before the first
 * frame is decoded and before videoWidth is populated.  We must poll.
 * If dimensions never arrive within `timeoutMs` we resolve anyway so the
 * caller can decide what to do.
 */
function waitForDimensions(video: HTMLVideoElement, timeoutMs = 8000): Promise<void> {
  return new Promise(resolve => {
    if (video.videoWidth > 0 && video.videoHeight > 0) { resolve(); return; }

    let pollId: ReturnType<typeof setInterval>;
    let timerId: ReturnType<typeof setTimeout>;

    const done = () => {
      clearInterval(pollId);
      clearTimeout(timerId);
      resolve();
    };

    pollId = setInterval(() => {
      if (video.videoWidth > 0 && video.videoHeight > 0) done();
    }, 50);

    timerId = setTimeout(done, timeoutMs);

    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth > 0) done();
    });
    video.addEventListener('canplay', () => {
      if (video.videoWidth > 0) done();
    });
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePoseDetection() {
  const videoRef   = useRef<HTMLVideoElement | null>(null);
  const [landmarks,   setLandmarks]   = useState<Landmark[] | null>(null);
  const [stream,      setStream]      = useState<MediaStream | null>(null);
  const [isLoading,   setIsLoading]   = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [cameraActive,  setCameraActive]  = useState(false);
  const [cameraStatus,  setCameraStatus]  = useState<CameraStatus>('idle');

  const landmarkerRef          = useRef<PoseLandmarker | null>(null);
  const streamRef              = useRef<MediaStream | null>(null);
  const rafRef                 = useRef<number>(0);
  const activeRef              = useRef(false);
  const startingRef            = useRef(false);
  const lastTimestampRef       = useRef(-1);
  const smoothedLandmarksRef   = useRef<Landmark[] | null>(null);
  const unstableFramesRef      = useRef(0);

  // ── stopCamera ─────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    activeRef.current   = false;
    startingRef.current = false;

    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }

    try { landmarkerRef.current?.close(); } catch { /* ignore */ }
    landmarkerRef.current = null;

    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.remove();
      videoRef.current = null;
    }

    smoothedLandmarksRef.current = null;
    unstableFramesRef.current    = 0;
    lastTimestampRef.current     = -1;

    setCameraActive(false);
    setLandmarks(null);
    setStream(null);
    setIsLoading(false);
    setCameraStatus('idle');
  }, []);

  // ── startCamera ────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera not supported on this device');
      }

      stopCamera();
      startingRef.current = true;
      setIsLoading(true);
      setError(null);
      setCameraStatus('requesting-permission');

      // ── Hidden video that MediaPipe reads from ──────────────────────────
      // IMPORTANT: must be in the DOM and have a real rendered size so that
      // iOS Safari allocates a proper decode buffer and populates videoWidth.
      // 1px × 1px causes iOS to skip full-resolution decoding on some builds.
      const video = document.createElement('video');
      video.setAttribute('autoplay', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('muted', '');
      video.muted = true;
      video.style.cssText = [
        'position:fixed',
        'top:-9999px',
        'left:-9999px',
        // Real CSS size so iOS allocates a full decode buffer
        'width:320px',
        'height:240px',
        'pointer-events:none',
        // Hidden from the user but present in layout
        'visibility:hidden',
      ].join(';');
      document.body.appendChild(video);
      videoRef.current = video;

      // ── getUserMedia ────────────────────────────────────────────────────
      // Only constrain facingMode.
      //
      // Specifying width + height + aspectRatio simultaneously creates
      // conflicting constraints that trigger OverconstrainedError on some iOS
      // versions.  Even when they don't error, iOS often ignores them and
      // delivers a 1280×720 landscape frame anyway.
      //
      // We accept whatever resolution the OS chooses and adapt in the
      // detection pipeline (getVerticalAxis in exercise-detection.ts handles
      // both landscape and portrait frame orientations).
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });

      streamRef.current = cameraStream;
      setStream(cameraStream);
      setCameraStatus('starting-camera');

      video.srcObject = cameraStream;
      await video.play();

      // Wait until videoWidth > 0.
      // On iOS Safari, 'loadedmetadata' fires before this is populated —
      // running MediaPipe on a 0×0 frame produces silent errors.
      await waitForDimensions(video);

      console.log(
        '[Camera] Ready:',
        video.videoWidth, '×', video.videoHeight,
        video.videoWidth > video.videoHeight ? '(landscape frame)' : '(portrait frame)',
      );

      setCameraActive(true);
      setCameraStatus('camera-active');

      // ── Initialise MediaPipe ────────────────────────────────────────────
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm',
      );

      const modelOpts = {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU' as const,
        },
        runningMode:                'VIDEO' as const,
        numPoses:                   1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence:  0.5,
        minTrackingConfidence:      0.5,
      };

      let poseLandmarker: PoseLandmarker;
      try {
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, modelOpts);
        console.log('[Camera] PoseLandmarker ready (GPU)');
      } catch {
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          ...modelOpts,
          baseOptions: { ...modelOpts.baseOptions, delegate: 'CPU' as const },
        });
        console.log('[Camera] PoseLandmarker ready (CPU fallback)');
      }

      landmarkerRef.current    = poseLandmarker;
      activeRef.current        = true;
      lastTimestampRef.current = -1;
      smoothedLandmarksRef.current = null;
      unstableFramesRef.current    = 0;
      setIsLoading(false);

      // ── Frame processing loop ───────────────────────────────────────────
      const processFrame = () => {
        if (!activeRef.current || !landmarkerRef.current) return;

        // Skip until the video has real decoded dimensions.
        // This is the guard that was missing — without it, detectForVideo
        // runs on a 0×0 frame and either throws or returns empty results
        // permanently, making it look like no one is detected.
        if (
          !video ||
          video.readyState < 2 ||
          video.videoWidth  === 0 ||
          video.videoHeight === 0
        ) {
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }

        const ts = performance.now();
        // MediaPipe VIDEO mode requires strictly increasing timestamps
        if (ts <= lastTimestampRef.current) {
          rafRef.current = requestAnimationFrame(processFrame);
          return;
        }
        lastTimestampRef.current = ts;

        try {
          const result = landmarkerRef.current.detectForVideo(video, ts);

          if (result.landmarks?.length > 0) {
            const raw: Landmark[] = result.landmarks[0].map((lm: any) => ({
              x:          lm.x,
              y:          lm.y,
              z:          lm.z,
              visibility: lm.visibility ?? 1,
            }));

            if (hasStableCorePose(raw)) {
              unstableFramesRef.current = 0;
              const smoothed = smoothLandmarks(raw, smoothedLandmarksRef.current);
              smoothedLandmarksRef.current = smoothed;
              setLandmarks(smoothed);
            } else {
              unstableFramesRef.current++;
              if (unstableFramesRef.current > MAX_UNSTABLE_FRAMES) {
                smoothedLandmarksRef.current = null;
                setLandmarks(null);
              } else if (smoothedLandmarksRef.current) {
                // Hold the last good result briefly to avoid flickering
                setLandmarks(smoothedLandmarksRef.current);
              }
            }
          } else {
            unstableFramesRef.current++;
            if (unstableFramesRef.current > MAX_UNSTABLE_FRAMES) {
              smoothedLandmarksRef.current = null;
              setLandmarks(null);
            }
          }
        } catch (e) {
          console.warn('[Camera] Frame processing error:', e);
        }

        if (activeRef.current) rafRef.current = requestAnimationFrame(processFrame);
      };

      rafRef.current = requestAnimationFrame(processFrame);

    } catch (err: any) {
      const name = err?.name ?? '';
      console.error('[Camera] Error:', name, err?.message);
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Camera permission denied'
          : name === 'NotFoundError'
            ? 'No camera found on this device'
            : name === 'OverconstrainedError'
              ? 'Camera constraints not supported'
              : err?.message ?? 'Camera failed to start',
      );
      setCameraActive(false);
      setCameraStatus('camera-failed');
      setIsLoading(false);
      setLandmarks(null);

      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
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

  useEffect(() => () => stopCamera(), [stopCamera]);

  return { landmarks, isLoading, error, cameraActive, cameraStatus, startCamera, stopCamera, stream, videoRef };
}
