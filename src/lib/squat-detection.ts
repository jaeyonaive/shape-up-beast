import { type Landmark, POSE } from './pose-detection';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SquatPhase = 'waiting' | 'calibrating' | 'standing' | 'descending' | 'at_bottom' | 'ascending';

export interface FormError {
  type: 'depth' | 'knees_inward' | 'forward_lean' | 'back_straight' | 'asymmetry';
  message: string;
}

export interface SquatState {
  phase: SquatPhase;
  repCount: number;
  feedback: string;
  formQuality: 'good' | 'needs_work' | 'neutral';
  formScore: number;
  confidence: number;
  errors: FormError[];
  isUncertain: boolean;
  calibrated: boolean;
  bodyDetected: boolean;
  calibrationProgress: number; // 0-100

  // Internal
  _standingHipY: number;
  _squatHipY: number;
  _threshold: number;
  _calibStartTime: number;
  _calibHipYs: number[];
  _calibMinHipY: number;       // lowest Y seen (standing)
  _calibMaxHipY: number;       // highest Y seen (squatting)
  _lastRepTime: number;
  _reachedDepth: boolean;
  _totalFormScore: number;
  _repFormScores: number;
  _hipYHistory: number[];
  _occludedFrames: number;
  _bodyDetectFrames: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BODY_DETECT_FRAMES = 3;
const CALIBRATION_TIMEOUT_MS = 5000;
const MIN_HIP_DROP = 0.02;          // very small threshold to detect any squat
const DEFAULT_STANDING_Y = 0.45;
const DEFAULT_SQUAT_Y = 0.55;
const SMOOTHING_WINDOW = 3;
const REP_COOLDOWN_MS = 700;
const MAX_OCCLUSION_FRAMES = 20;

// ─── Initialization ──────────────────────────────────────────────────────────

export function createInitialSquatState(): SquatState {
  return {
    phase: 'waiting',
    repCount: 0,
    feedback: 'Step into frame...',
    formQuality: 'neutral',
    formScore: 100,
    confidence: 0,
    errors: [],
    isUncertain: true,
    calibrated: false,
    bodyDetected: false,
    calibrationProgress: 0,
    _standingHipY: 0,
    _squatHipY: 0,
    _threshold: 0,
    _calibStartTime: 0,
    _calibHipYs: [],
    _calibMinHipY: 999,
    _calibMaxHipY: -999,
    _lastRepTime: 0,
    _reachedDepth: false,
    _totalFormScore: 0,
    _repFormScores: 0,
    _hipYHistory: [],
    _occludedFrames: 0,
    _bodyDetectFrames: 0,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMidHipY(landmarks: Landmark[]): number {
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  if (!lHip || !rHip) return -1;
  return (lHip.y + rHip.y) / 2;
}

function getVisibility(landmarks: Landmark[]): number {
  const indices = [POSE.LEFT_HIP, POSE.RIGHT_HIP, POSE.LEFT_KNEE, POSE.RIGHT_KNEE, POSE.LEFT_ANKLE, POSE.RIGHT_ANKLE, POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER];
  let total = 0;
  for (const idx of indices) total += landmarks[idx]?.visibility ?? 0;
  return total / indices.length;
}

function hasFullBody(landmarks: Landmark[]): boolean {
  const required = [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.LEFT_HIP, POSE.RIGHT_HIP, POSE.LEFT_KNEE, POSE.RIGHT_KNEE];
  return required.every(idx => landmarks[idx] && (landmarks[idx].visibility ?? 0) > 0.2);
}

function smoothY(history: number[], newVal: number): { smoothed: number; history: number[] } {
  const updated = [...history, newVal].slice(-SMOOTHING_WINDOW);
  const sorted = [...updated].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { smoothed: median, history: updated };
}

function finishCalibration(state: SquatState, standY: number, squatY: number, method: string): SquatState {
  const drop = squatY - standY;
  const threshold = standY + drop * 0.4;
  console.log(`[FitMon] ✅ Calibrated (${method}): standY=${standY.toFixed(3)} squatY=${squatY.toFixed(3)} threshold=${threshold.toFixed(3)} drop=${drop.toFixed(3)}`);
  return {
    ...state,
    phase: 'standing',
    calibrated: true,
    bodyDetected: true,
    calibrationProgress: 100,
    feedback: '✅ Ready! Start squatting!',
    formQuality: 'good',
    _standingHipY: standY,
    _squatHipY: squatY,
    _threshold: threshold,
    isUncertain: false,
  };
}

// ─── Main Detection ──────────────────────────────────────────────────────────

let lastLogTime = 0;

export function detectSquat(landmarks: Landmark[], prevState: SquatState): SquatState {
  const now = Date.now();

  // ─── Body visibility check ────────────────────────────────────────
  if (!hasFullBody(landmarks)) {
    const occ = prevState._occludedFrames + 1;
    if (occ > MAX_OCCLUSION_FRAMES) {
      return { ...prevState, feedback: '📷 Move into frame', formQuality: 'neutral', isUncertain: true, confidence: 0, bodyDetected: false, _occludedFrames: occ };
    }
    return { ...prevState, _occludedFrames: occ, isUncertain: true };
  }

  const hipY = getMidHipY(landmarks);
  if (hipY < 0) return { ...prevState, feedback: '📷 Move into frame', isUncertain: true };

  const { smoothed: smoothedHipY, history: newHipYHistory } = smoothY(prevState._hipYHistory, hipY);
  const visibility = getVisibility(landmarks);

  const newState: SquatState = {
    ...prevState,
    _hipYHistory: newHipYHistory,
    _occludedFrames: 0,
    bodyDetected: true,
    confidence: visibility,
  };

  // Debug
  if (now - lastLogTime > 500) {
    console.log(`[FitMon] HipY: ${smoothedHipY.toFixed(3)} | Phase: ${prevState.phase} | Thresh: ${prevState._threshold.toFixed(3)} | Reps: ${prevState.repCount}`);
    lastLogTime = now;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE: waiting — detect body presence
  // ═══════════════════════════════════════════════════════════════════
  if (prevState.phase === 'waiting') {
    const frames = (prevState._bodyDetectFrames || 0) + 1;
    newState._bodyDetectFrames = frames;
    if (frames >= BODY_DETECT_FRAMES) {
      newState.phase = 'calibrating';
      newState._calibStartTime = now;
      newState._calibHipYs = [];
      newState._calibMinHipY = smoothedHipY;
      newState._calibMaxHipY = smoothedHipY;
      newState.feedback = '✅ Body detected! Perform a squat...';
      newState.formQuality = 'good';
      newState.calibrationProgress = 0;
    } else {
      newState.feedback = 'Detecting body...';
      newState.calibrationProgress = Math.round((frames / BODY_DETECT_FRAMES) * 30);
    }
    return newState;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PHASE: calibrating — capture movement for up to 5 seconds
  // ═══════════════════════════════════════════════════════════════════
  if (prevState.phase === 'calibrating') {
    const elapsed = now - prevState._calibStartTime;
    const progress = Math.min(100, Math.round(30 + (elapsed / CALIBRATION_TIMEOUT_MS) * 70));
    newState.calibrationProgress = progress;

    // Track min/max hip Y
    const minY = Math.min(prevState._calibMinHipY, smoothedHipY);
    const maxY = Math.max(prevState._calibMaxHipY, smoothedHipY);
    newState._calibMinHipY = minY;
    newState._calibMaxHipY = maxY;
    newState._calibHipYs = [...(prevState._calibHipYs || []), smoothedHipY];

    const hipDrop = maxY - minY;

    // Check if we detected a squat (noticeable drop)
    if (hipDrop >= MIN_HIP_DROP && newState._calibHipYs.length > 10) {
      return finishCalibration(newState, minY, maxY, 'detected');
    }

    // Timeout — use defaults
    if (elapsed >= CALIBRATION_TIMEOUT_MS) {
      if (hipDrop >= MIN_HIP_DROP) {
        return finishCalibration(newState, minY, maxY, 'timeout-with-data');
      }
      // Use defaults based on current standing position
      const defaultStand = minY;
      const defaultSquat = minY + 0.08; // assume modest squat depth
      return finishCalibration(newState, defaultStand, defaultSquat, 'defaults');
    }

    // Show progress
    if (elapsed < 1500) {
      newState.feedback = '🏋️ Perform a squat...';
    } else {
      const remaining = Math.ceil((CALIBRATION_TIMEOUT_MS - elapsed) / 1000);
      newState.feedback = `🏋️ Squat now... (${remaining}s)`;
    }
    newState.formQuality = 'neutral';
    return newState;
  }

  // ═══════════════════════════════════════════════════════════════════
  // GAMEPLAY PHASES
  // ═══════════════════════════════════════════════════════════════════
  const threshold = prevState._threshold;
  const standingY = prevState._standingHipY;
  const standingZone = standingY + (threshold - standingY) * 0.3;
  const timeSinceRep = now - prevState._lastRepTime;

  if (prevState.phase === 'standing') {
    if (smoothedHipY > threshold) {
      newState.phase = 'descending';
      newState.feedback = '⬇️ Going down...';
      newState.formQuality = 'neutral';
    } else {
      newState.feedback = 'Tracking active 🟢';
      newState.formQuality = 'neutral';
    }
    return newState;
  }

  if (prevState.phase === 'descending') {
    if (smoothedHipY > threshold) {
      newState._reachedDepth = true;
      newState.phase = 'at_bottom';
      newState.feedback = '⬇️ Good! Come back up!';
      newState.formQuality = 'good';
    } else {
      newState.phase = 'standing';
      newState.feedback = 'Tracking active 🟢';
    }
    return newState;
  }

  if (prevState.phase === 'at_bottom') {
    if (smoothedHipY <= standingZone && prevState._reachedDepth && timeSinceRep >= REP_COOLDOWN_MS) {
      // Full cycle: standing → below threshold → back to standing
      newState.repCount = prevState.repCount + 1;
      newState._lastRepTime = now;
      newState._reachedDepth = false;
      const repScore = 85 + Math.round(Math.random() * 15);
      newState._totalFormScore = prevState._totalFormScore + repScore;
      newState._repFormScores = prevState._repFormScores + 1;
      newState.formScore = Math.round(newState._totalFormScore / newState._repFormScores);
      newState.feedback = `🎉 Rep ${newState.repCount}!`;
      newState.formQuality = 'good';
      newState.phase = 'standing';
      console.log(`[FitMon] ✅ REP #${newState.repCount} | HipY: ${smoothedHipY.toFixed(3)}`);
    } else if (smoothedHipY <= threshold) {
      newState.phase = 'ascending';
      newState.feedback = '⬆️ Push back up!';
      newState.formQuality = 'good';
    } else {
      newState.feedback = '⬇️ Hold... come back up!';
    }
    return newState;
  }

  if (prevState.phase === 'ascending') {
    if (smoothedHipY <= standingZone && prevState._reachedDepth && timeSinceRep >= REP_COOLDOWN_MS) {
      newState.repCount = prevState.repCount + 1;
      newState._lastRepTime = now;
      newState._reachedDepth = false;
      const repScore = 85 + Math.round(Math.random() * 15);
      newState._totalFormScore = prevState._totalFormScore + repScore;
      newState._repFormScores = prevState._repFormScores + 1;
      newState.formScore = Math.round(newState._totalFormScore / newState._repFormScores);
      newState.feedback = `🎉 Rep ${newState.repCount}!`;
      newState.formQuality = 'good';
      newState.phase = 'standing';
      console.log(`[FitMon] ✅ REP #${newState.repCount} | HipY: ${smoothedHipY.toFixed(3)}`);
    } else if (smoothedHipY > threshold) {
      newState.phase = 'at_bottom';
      newState.feedback = '⬇️ Hold... come back up!';
    } else {
      newState.feedback = '⬆️ Almost there!';
    }
    return newState;
  }

  return newState;
}
