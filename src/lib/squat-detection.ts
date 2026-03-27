import { type Landmark, POSE, calculateAngle } from './pose-detection';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SquatPhase = 'calibrating' | 'standing' | 'going_down' | 'at_bottom' | 'going_up';

export interface FormError {
  type: 'depth' | 'knees_inward' | 'forward_lean' | 'back_straight' | 'asymmetry';
  message: string;
}

export interface SquatState {
  phase: SquatPhase;
  repCount: number;
  feedback: string;
  formQuality: 'good' | 'needs_work' | 'neutral';
  kneeAngle: number;
  formScore: number;
  confidence: number;          // 0-1 confidence of current detection
  errors: FormError[];
  isUncertain: boolean;        // flag uncertain detections
  calibrated: boolean;

  // Internal tracking
  _totalFormScore: number;
  _repFormScores: number;
  _lastRepTime: number;
  _reachedDepth: boolean;
  _currentRepErrors: FormError[];
  _minKneeAngle: number;
  _angleHistory: number[];      // temporal smoothing buffer
  _phaseFrameCount: number;     // frames in current phase (temporal consistency)
  _trajectoryDir: number[];     // angle deltas for trajectory analysis
  _calibration: CalibrationData | null;
  _occludedFrames: number;      // consecutive low-visibility frames
  _hipAngleHistory: number[];   // hip angle buffer for false positive filtering
}

interface CalibrationData {
  standingKneeAngle: number;    // user's natural standing knee angle
  standingHipAngle: number;
  torsoLength: number;          // shoulder-to-hip distance (normalized)
  legLength: number;            // hip-to-ankle distance (normalized)
  hipWidth: number;             // hip width (normalized)
  timestamp: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SMOOTHING_WINDOW = 2;           // minimal smoothing for responsiveness
const TRAJECTORY_WINDOW = 8;
const PHASE_CONFIRM_FRAMES = 1;       // instant phase transitions
const CONFIDENCE_THRESHOLD = 0.4;     // very forgiving
const CALIBRATION_FRAMES = 10;        // quick calibration

const DEFAULT_STANDING_ANGLE = 155;
const DEFAULT_SQUAT_DEPTH = 130;      // very forgiving depth - any noticeable bend counts
const DEEP_SQUAT_ANGLE = 90;
const DEFAULT_GOING_DOWN = 150;
const GOING_UP_EXIT_OFFSET = 10;

const MAX_FORWARD_LEAN_DEG = 50;      // very forgiving lean
const MIN_REP_INTERVAL_MS = 400;      // fast rep counting
const MAX_OCCLUSION_FRAMES = 15;

// ─── Initialization ──────────────────────────────────────────────────────────

export function createInitialSquatState(): SquatState {
  return {
    phase: 'calibrating',
    repCount: 0,
    feedback: '🎯 Stand still for calibration...',
    formQuality: 'neutral',
    kneeAngle: 180,
    formScore: 100,
    confidence: 0,
    errors: [],
    isUncertain: false,
    calibrated: false,
    _totalFormScore: 0,
    _repFormScores: 0,
    _lastRepTime: 0,
    _reachedDepth: false,
    _currentRepErrors: [],
    _minKneeAngle: 180,
    _angleHistory: [],
    _phaseFrameCount: 0,
    _trajectoryDir: [],
    _calibration: null,
    _occludedFrames: 0,
    _hipAngleHistory: [],
  };
}

// ─── Utility functions ───────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function smoothAngle(history: number[], newVal: number, window: number): { smoothed: number; history: number[] } {
  const updated = [...history, newVal].slice(-window);
  return { smoothed: median(updated), history: updated };
}

function getWeightedKneeAngle(landmarks: Landmark[]): number {
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];
  const lAnkle = landmarks[POSE.LEFT_ANKLE];
  const rAnkle = landmarks[POSE.RIGHT_ANKLE];

  const leftAngle = calculateAngle(lHip, lKnee, lAnkle);
  const rightAngle = calculateAngle(rHip, rKnee, rAnkle);

  const lVis = (lHip?.visibility ?? 0) + (lKnee?.visibility ?? 0) + (lAnkle?.visibility ?? 0);
  const rVis = (rHip?.visibility ?? 0) + (rKnee?.visibility ?? 0) + (rAnkle?.visibility ?? 0);
  const total = lVis + rVis;

  return total > 0 ? (leftAngle * lVis + rightAngle * rVis) / total : (leftAngle + rightAngle) / 2;
}

function getHipAngle(landmarks: Landmark[]): number {
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];

  if (!lShoulder || !rShoulder || !lHip || !rHip || !lKnee || !rKnee) return 180;

  const midShoulder: Landmark = {
    x: (lShoulder.x + rShoulder.x) / 2,
    y: (lShoulder.y + rShoulder.y) / 2,
    z: (lShoulder.z + rShoulder.z) / 2,
  };
  const midHip: Landmark = {
    x: (lHip.x + rHip.x) / 2,
    y: (lHip.y + rHip.y) / 2,
    z: (lHip.z + rHip.z) / 2,
  };
  const midKnee: Landmark = {
    x: (lKnee.x + rKnee.x) / 2,
    y: (lKnee.y + rKnee.y) / 2,
    z: (lKnee.z + rKnee.z) / 2,
  };

  return calculateAngle(midShoulder, midHip, midKnee);
}

function getTorsoLean(landmarks: Landmark[]): number {
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];

  if (!lShoulder || !rShoulder || !lHip || !rHip) return 0;

  const dx = ((lShoulder.x + rShoulder.x) / 2) - ((lHip.x + rHip.x) / 2);
  const dy = ((lHip.y + rHip.y) / 2) - ((lShoulder.y + rShoulder.y) / 2);

  return Math.abs(Math.atan2(dx, dy) * (180 / Math.PI));
}

function getKneeCollapse(landmarks: Landmark[]): { collapsed: boolean; severity: number } {
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];
  const lAnkle = landmarks[POSE.LEFT_ANKLE];
  const rAnkle = landmarks[POSE.RIGHT_ANKLE];

  if (!lKnee || !rKnee || !lAnkle || !rAnkle) return { collapsed: false, severity: 0 };

  const kneeWidth = Math.abs(lKnee.x - rKnee.x);
  const ankleWidth = Math.abs(lAnkle.x - rAnkle.x);

  if (ankleWidth > 0.01) {
    const ratio = kneeWidth / ankleWidth;
    if (ratio < 0.7) {
      return { collapsed: true, severity: Math.min(1, (0.7 - ratio) / 0.3) };
    }
  }

  return { collapsed: false, severity: 0 };
}

function getAngleAsymmetry(landmarks: Landmark[]): number {
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];
  const lAnkle = landmarks[POSE.LEFT_ANKLE];
  const rAnkle = landmarks[POSE.RIGHT_ANKLE];

  const leftAngle = calculateAngle(lHip, lKnee, lAnkle);
  const rightAngle = calculateAngle(rHip, rKnee, rAnkle);

  return Math.abs(leftAngle - rightAngle);
}

function getLandmarkVisibility(landmarks: Landmark[]): number {
  const indices = [POSE.LEFT_HIP, POSE.RIGHT_HIP, POSE.LEFT_KNEE, POSE.RIGHT_KNEE, POSE.LEFT_ANKLE, POSE.RIGHT_ANKLE, POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER];
  let total = 0;
  for (const idx of indices) {
    total += landmarks[idx]?.visibility ?? 0;
  }
  return total / indices.length;
}

function dist(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ─── False positive filters ─────────────────────────────────────────────────

/** Detect if user is sitting (hip angle very closed but knees not flexing symmetrically, torso upright) */
function isSitting(landmarks: Landmark[], kneeAngle: number, hipAngle: number): boolean {
  const torsoLean = getTorsoLean(landmarks);
  // Sitting: hip angle < 100, torso relatively upright, but ankles far from hips vertically
  const lHip = landmarks[POSE.LEFT_HIP];
  const lAnkle = landmarks[POSE.LEFT_ANKLE];
  if (!lHip || !lAnkle) return false;

  const verticalDiff = Math.abs(lHip.y - lAnkle.y);
  // If ankles are at roughly the same height as hips (sitting in chair), it's not a squat
  if (hipAngle < 110 && torsoLean < 15 && verticalDiff < 0.15) return true;
  return false;
}

/** Detect forward bend (not a squat) */
function isForwardBend(hipAngle: number, kneeAngle: number): boolean {
  // Forward bend: hip angle very low but knees stay relatively straight
  return hipAngle < 90 && kneeAngle > 140;
}

/** Detect lunge-like movement (large asymmetry) */
function isLunge(landmarks: Landmark[]): boolean {
  return getAngleAsymmetry(landmarks) > 40;
}

// ─── Calibration ─────────────────────────────────────────────────────────────

function calibrate(landmarks: Landmark[], history: number[]): CalibrationData | null {
  if (history.length < CALIBRATION_FRAMES) return null;

  // Check stability: standard deviation of recent angles should be low
  const recent = history.slice(-CALIBRATION_FRAMES);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const stddev = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length);

  if (stddev > 10) return null; // more lenient stability check

  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  const lAnkle = landmarks[POSE.LEFT_ANKLE];
  const rAnkle = landmarks[POSE.RIGHT_ANKLE];

  if (!lShoulder || !rShoulder || !lHip || !rHip || !lAnkle || !rAnkle) return null;

  const midShoulder = { x: (lShoulder.x + rShoulder.x) / 2, y: (lShoulder.y + rShoulder.y) / 2 };
  const midHip = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };
  const midAnkle = { x: (lAnkle.x + rAnkle.x) / 2, y: (lAnkle.y + rAnkle.y) / 2 };

  return {
    standingKneeAngle: mean,
    standingHipAngle: getHipAngle(landmarks),
    torsoLength: Math.sqrt((midShoulder.x - midHip.x) ** 2 + (midShoulder.y - midHip.y) ** 2),
    legLength: Math.sqrt((midHip.x - midAnkle.x) ** 2 + (midHip.y - midAnkle.y) ** 2),
    hipWidth: Math.abs(lHip.x - rHip.x),
    timestamp: Date.now(),
  };
}

// ─── Confidence scoring ──────────────────────────────────────────────────────

function computeConfidence(
  kneeAngle: number,
  hipAngle: number,
  torsoLean: number,
  visibility: number,
  phaseFrames: number,
  trajectoryConsistent: boolean,
  isFalsePositive: boolean,
  reachedDepth: boolean,
  calibration: CalibrationData | null,
): number {
  let conf = 0;

  // Visibility factor (0-0.2)
  conf += Math.min(0.2, visibility * 0.25);

  // Depth factor (0-0.25)
  if (reachedDepth) {
    conf += 0.25;
  } else if (kneeAngle < 120) {
    conf += 0.1;
  }

  // Temporal consistency (0-0.2)
  const frameRatio = Math.min(1, phaseFrames / PHASE_CONFIRM_FRAMES);
  conf += 0.2 * frameRatio;

  // Trajectory consistency (0-0.15)
  if (trajectoryConsistent) conf += 0.15;

  // Not a false positive (0-0.1)
  if (!isFalsePositive) conf += 0.1;

  // Calibration match (0-0.1)
  if (calibration) {
    // Standing angle should be close to calibrated value
    conf += 0.1;
  }

  return Math.min(1, conf);
}

// ─── Form scoring ────────────────────────────────────────────────────────────

function scoreRep(
  minAngle: number,
  maxTorsoLean: number,
  kneeCollapsed: boolean,
  reachedDepth: boolean,
  asymmetry: number,
  confidence: number,
): number {
  let score = 100;

  if (!reachedDepth) score -= 30;
  else if (minAngle > 90) score -= 15;

  if (maxTorsoLean > MAX_FORWARD_LEAN_DEG) {
    score -= Math.min(25, (maxTorsoLean - MAX_FORWARD_LEAN_DEG) * 1.5);
  }

  if (kneeCollapsed) score -= 20;
  if (asymmetry > 20) score -= Math.min(15, (asymmetry - 20) * 0.75);

  // Confidence penalty
  score *= Math.max(0.5, confidence);

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Main detection ──────────────────────────────────────────────────────────

let lastLogTime = 0;

export function detectSquat(
  landmarks: Landmark[],
  prevState: SquatState
): SquatState {
  const keyParts = [
    landmarks[POSE.LEFT_HIP], landmarks[POSE.RIGHT_HIP],
    landmarks[POSE.LEFT_KNEE], landmarks[POSE.RIGHT_KNEE],
    landmarks[POSE.LEFT_ANKLE], landmarks[POSE.RIGHT_ANKLE],
  ];

  // ─── Occlusion handling ──────────────────────────────────────────────
  if (!keyParts.every(p => p != null)) {
    const occluded = prevState._occludedFrames + 1;
    if (occluded > MAX_OCCLUSION_FRAMES) {
      return {
        ...prevState,
        feedback: '📷 Move back so camera sees your full body',
        formQuality: 'neutral',
        isUncertain: true,
        confidence: 0,
        _occludedFrames: occluded,
      };
    }
    // Brief occlusion: hold state
    return { ...prevState, _occludedFrames: occluded, isUncertain: true };
  }

  // Reset occlusion counter
  const rawKneeAngle = getWeightedKneeAngle(landmarks);
  const hipAngle = getHipAngle(landmarks);
  const torsoLean = getTorsoLean(landmarks);
  const kneeCollapseResult = getKneeCollapse(landmarks);
  const asymmetry = getAngleAsymmetry(landmarks);
  const visibility = getLandmarkVisibility(landmarks);
  const now = Date.now();

  // ─── Temporal smoothing ──────────────────────────────────────────────
  const { smoothed: kneeAngle, history: newAngleHistory } = smoothAngle(
    prevState._angleHistory, rawKneeAngle, SMOOTHING_WINDOW
  );

  // ─── Trajectory tracking ────────────────────────────────────────────
  const prevAngle = prevState._angleHistory.length > 0
    ? prevState._angleHistory[prevState._angleHistory.length - 1]
    : rawKneeAngle;
  const delta = rawKneeAngle - prevAngle;
  const newTrajectory = [...prevState._trajectoryDir, delta].slice(-TRAJECTORY_WINDOW);

  // Check trajectory consistency: are most deltas in the same direction?
  const downCount = newTrajectory.filter(d => d < -1).length;
  const upCount = newTrajectory.filter(d => d > 1).length;
  const trajectoryConsistent = (downCount > TRAJECTORY_WINDOW * 0.6) || (upCount > TRAJECTORY_WINDOW * 0.6);

  // ─── Hip angle smoothing for false positive filtering ────────────────
  const newHipHistory = [...prevState._hipAngleHistory, hipAngle].slice(-SMOOTHING_WINDOW);
  const smoothedHipAngle = median(newHipHistory);

  // ─── Calibration phase ───────────────────────────────────────────────
  if (prevState.phase === 'calibrating') {
    const cal = calibrate(landmarks, newAngleHistory);
    if (cal) {
      console.log(`[FitMon] ✅ Calibrated: standing=${cal.standingKneeAngle.toFixed(1)}° torso=${cal.torsoLength.toFixed(3)} leg=${cal.legLength.toFixed(3)}`);
      return {
        ...prevState,
        phase: 'standing',
        calibrated: true,
        feedback: '✅ Calibrated! Start squatting!',
        formQuality: 'good',
        _calibration: cal,
        _angleHistory: newAngleHistory,
        _trajectoryDir: newTrajectory,
        _hipAngleHistory: newHipHistory,
        _occludedFrames: 0,
        kneeAngle: Math.round(kneeAngle),
        confidence: 0.5,
        isUncertain: false,
      };
    }
    return {
      ...prevState,
      feedback: `🎯 Stand still... (${Math.min(100, Math.round((newAngleHistory.length / CALIBRATION_FRAMES) * 100))}%)`,
      formQuality: 'neutral',
      _angleHistory: newAngleHistory,
      _trajectoryDir: newTrajectory,
      _hipAngleHistory: newHipHistory,
      _occludedFrames: 0,
      kneeAngle: Math.round(kneeAngle),
      confidence: 0,
      isUncertain: true,
    };
  }

  // ─── Adaptive thresholds from calibration ────────────────────────────
  const cal = prevState._calibration;
  const standingThreshold = cal ? Math.min(170, cal.standingKneeAngle - 5) : DEFAULT_STANDING_ANGLE;
  const goingDownThreshold = cal ? Math.min(155, cal.standingKneeAngle - 20) : DEFAULT_GOING_DOWN;
  const depthThreshold = DEFAULT_SQUAT_DEPTH;
  const goingUpExit = depthThreshold + GOING_UP_EXIT_OFFSET;

  // ─── False positive filtering ────────────────────────────────────────
  const sitting = isSitting(landmarks, kneeAngle, smoothedHipAngle);
  const forwardBend = isForwardBend(smoothedHipAngle, kneeAngle);
  const lunge = isLunge(landmarks);
  const isFP = sitting || forwardBend || lunge;

  // ─── Confidence ──────────────────────────────────────────────────────
  const confidence = computeConfidence(
    kneeAngle, smoothedHipAngle, torsoLean, visibility,
    prevState._phaseFrameCount, trajectoryConsistent, isFP,
    prevState._reachedDepth, cal
  );

  // ─── Debug logging ───────────────────────────────────────────────────
  if (now - lastLogTime > 500) {
    console.log(
      `[FitMon] Knee: ${kneeAngle.toFixed(1)}° | Hip: ${smoothedHipAngle.toFixed(1)}° | ` +
      `Torso: ${torsoLean.toFixed(1)}° | Phase: ${prevState.phase}(${prevState._phaseFrameCount}f) | ` +
      `Conf: ${confidence.toFixed(2)} | Reps: ${prevState.repCount} | ` +
      `FP: sit=${sitting} bend=${forwardBend} lunge=${lunge}`
    );
    lastLogTime = now;
  }

  // ─── Build new state ─────────────────────────────────────────────────
  const newState: SquatState = {
    ...prevState,
    kneeAngle: Math.round(kneeAngle),
    confidence,
    isUncertain: confidence < CONFIDENCE_THRESHOLD,
    _angleHistory: newAngleHistory,
    _trajectoryDir: newTrajectory,
    _hipAngleHistory: newHipHistory,
    _currentRepErrors: [...prevState._currentRepErrors],
    _occludedFrames: 0,
  };

  if (kneeAngle < newState._minKneeAngle) {
    newState._minKneeAngle = kneeAngle;
  }

  // ─── Skip false positive filtering during active squatting ─────────
  // Only reject if standing and clearly not squatting
  if (isFP && prevState.phase === 'standing' && kneeAngle > goingDownThreshold) {
    if (sitting) newState.feedback = '🪑 Sitting detected — stand up to start';
    else if (forwardBend) newState.feedback = '🙇 Forward bend — squat with your legs';
    else if (lunge) newState.feedback = '🦵 Lunge detected — keep feet even for squats';
    newState.formQuality = 'needs_work';
    newState.isUncertain = true;
    return newState;
  }

  // ─── Form errors ─────────────────────────────────────────────────────
  const realtimeErrors: FormError[] = [];

  if (torsoLean > MAX_FORWARD_LEAN_DEG && kneeAngle < goingDownThreshold) {
    realtimeErrors.push({ type: 'forward_lean', message: '🔼 Chest up! Too much forward lean' });
  }
  if (kneeCollapseResult.collapsed && kneeAngle < goingDownThreshold) {
    realtimeErrors.push({ type: 'knees_inward', message: '↔️ Push knees out!' });
  }
  if (asymmetry > 25 && kneeAngle < goingDownThreshold) {
    realtimeErrors.push({ type: 'asymmetry', message: '⚖️ Keep weight balanced on both legs' });
  }

  // ─── Phase state machine with temporal consistency ───────────────────
  const timeSinceLastRep = now - (prevState._lastRepTime || 0);

  const confirmPhase = (targetPhase: SquatPhase): boolean => {
    // Phase must be held for N frames to confirm
    if (prevState.phase === targetPhase) {
      newState._phaseFrameCount = prevState._phaseFrameCount + 1;
      return true;
    }
    // First frame in new phase
    newState._phaseFrameCount = 1;
    return prevState._phaseFrameCount >= PHASE_CONFIRM_FRAMES || targetPhase === prevState.phase;
  };

  if (kneeAngle >= standingThreshold) {
    // ─── STANDING ──────────────────────────────────────────────────
    if (
      (prevState.phase === 'going_up' || prevState.phase === 'at_bottom' || prevState.phase === 'going_down') &&
      timeSinceLastRep > MIN_REP_INTERVAL_MS &&
      prevState._reachedDepth
    ) {
      // Count rep with minimal gating - if depth was reached, it counts
        const repScore = scoreRep(
          newState._minKneeAngle, torsoLean, kneeCollapseResult.collapsed,
          newState._reachedDepth, asymmetry, confidence
        );
        newState.repCount = prevState.repCount + 1;
        newState._lastRepTime = now;
        newState._totalFormScore = prevState._totalFormScore + repScore;
        newState._repFormScores = prevState._repFormScores + 1;
        newState.formScore = Math.round(newState._totalFormScore / newState._repFormScores);
        newState.errors = [...newState._currentRepErrors];

        if (repScore >= 80) {
          newState.feedback = `🎉 Great rep! (${repScore}%) [${(confidence * 100).toFixed(0)}% conf]`;
          newState.formQuality = 'good';
        } else if (repScore >= 50) {
          newState.feedback = `👍 OK rep (${repScore}%) — watch your form`;
          newState.formQuality = 'needs_work';
        } else {
          newState.feedback = `⚠️ Poor form (${repScore}%) — go deeper, keep chest up`;
          newState.formQuality = 'needs_work';
        }

        console.log(`[FitMon] ✅ REP #${newState.repCount} | Score: ${repScore}% | Conf: ${confidence.toFixed(2)} | MinAngle: ${newState._minKneeAngle.toFixed(1)}°`);
    } else if (prevState.phase === 'standing') {
      newState.feedback = 'Start squatting down!';
      newState.formQuality = 'neutral';
    }
    newState.phase = 'standing';
    newState._reachedDepth = false;
    newState._currentRepErrors = [];
    newState._minKneeAngle = 180;
    confirmPhase('standing');

  } else if (kneeAngle < depthThreshold) {
    // ─── AT BOTTOM ─────────────────────────────────────────────────
    newState._reachedDepth = true;
    confirmPhase('at_bottom');

    if (kneeAngle <= DEEP_SQUAT_ANGLE) {
      newState.feedback = '🔥 Excellent depth! Come back up!';
      newState.formQuality = 'good';
    } else {
      newState.feedback = '✅ Good depth! Stand back up!';
      newState.formQuality = 'good';
    }

    if (realtimeErrors.length > 0) {
      newState.feedback = realtimeErrors[0].message;
      newState.formQuality = 'needs_work';
      for (const err of realtimeErrors) {
        if (!newState._currentRepErrors.find(e => e.type === err.type)) {
          newState._currentRepErrors.push(err);
        }
      }
    }
    newState.phase = 'at_bottom';

  } else if (kneeAngle < goingDownThreshold) {
    // ─── TRANSITION ZONE ───────────────────────────────────────────
    if (prevState.phase === 'standing' || prevState.phase === 'going_down') {
      newState.phase = 'going_down';
      confirmPhase('going_down');

      if (realtimeErrors.length > 0) {
        newState.feedback = realtimeErrors[0].message;
        newState.formQuality = 'needs_work';
        for (const err of realtimeErrors) {
          if (!newState._currentRepErrors.find(e => e.type === err.type)) {
            newState._currentRepErrors.push(err);
          }
        }
      } else {
        newState.feedback = 'Go lower!';
        newState.formQuality = 'neutral';
      }
    } else if (prevState.phase === 'at_bottom' && kneeAngle > goingUpExit) {
      newState.phase = 'going_up';
      confirmPhase('going_up');
      newState.feedback = 'Push back up!';
      newState.formQuality = 'good';
    } else if (prevState.phase === 'going_up') {
      confirmPhase('going_up');
      newState.feedback = 'Almost there, keep pushing!';
      newState.formQuality = 'good';
    }
  }

  return newState;
}
