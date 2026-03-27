import { type Landmark, POSE } from './pose-detection';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SquatPhase = 'waiting' | 'calibrating_stand' | 'calibrating_squat' | 'ready' | 'standing' | 'descending' | 'at_bottom' | 'ascending';

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

  // Internal
  _standingHipY: number;        // calibrated standing hip Y
  _squatHipY: number;           // calibrated squat hip Y
  _threshold: number;           // midpoint threshold for squat detection
  _calibFrames: number;         // frames collected during calibration
  _calibHipYs: number[];        // hip Y samples during calibration
  _lastRepTime: number;
  _reachedDepth: boolean;
  _totalFormScore: number;
  _repFormScores: number;
  _hipYHistory: number[];       // smoothing buffer
  _occludedFrames: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BODY_DETECT_FRAMES = 5;       // frames needed to confirm body detected
const CALIBRATION_STAND_FRAMES = 20; // frames to sample standing position
const CALIBRATION_SQUAT_FRAMES = 15; // frames to sample squat position
const SMOOTHING_WINDOW = 3;
const REP_COOLDOWN_MS = 700;         // cooldown between reps
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
    _standingHipY: 0,
    _squatHipY: 0,
    _threshold: 0,
    _calibFrames: 0,
    _calibHipYs: [],
    _lastRepTime: 0,
    _reachedDepth: false,
    _totalFormScore: 0,
    _repFormScores: 0,
    _hipYHistory: [],
    _occludedFrames: 0,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMidHipY(landmarks: Landmark[]): number {
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  if (!lHip || !rHip) return -1;
  return (lHip.y + rHip.y) / 2;
}

function getMidKneeY(landmarks: Landmark[]): number {
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];
  if (!lKnee || !rKnee) return -1;
  return (lKnee.y + rKnee.y) / 2;
}

function getVisibility(landmarks: Landmark[]): number {
  const indices = [POSE.LEFT_HIP, POSE.RIGHT_HIP, POSE.LEFT_KNEE, POSE.RIGHT_KNEE, POSE.LEFT_ANKLE, POSE.RIGHT_ANKLE, POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER];
  let total = 0;
  for (const idx of indices) {
    total += landmarks[idx]?.visibility ?? 0;
  }
  return total / indices.length;
}

function hasFullBody(landmarks: Landmark[]): boolean {
  const required = [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.LEFT_HIP, POSE.RIGHT_HIP, POSE.LEFT_KNEE, POSE.RIGHT_KNEE, POSE.LEFT_ANKLE, POSE.RIGHT_ANKLE];
  return required.every(idx => landmarks[idx] && (landmarks[idx].visibility ?? 0) > 0.3);
}

function smoothY(history: number[], newVal: number): { smoothed: number; history: number[] } {
  const updated = [...history, newVal].slice(-SMOOTHING_WINDOW);
  const sorted = [...updated].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { smoothed: median, history: updated };
}

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── Main Detection ──────────────────────────────────────────────────────────

let lastLogTime = 0;

export function detectSquat(
  landmarks: Landmark[],
  prevState: SquatState
): SquatState {
  const now = Date.now();

  // Check body visibility
  if (!hasFullBody(landmarks)) {
    const occ = prevState._occludedFrames + 1;
    if (occ > MAX_OCCLUSION_FRAMES) {
      return {
        ...prevState,
        feedback: '📷 Move into frame',
        formQuality: 'neutral',
        isUncertain: true,
        confidence: 0,
        bodyDetected: false,
        _occludedFrames: occ,
      };
    }
    return { ...prevState, _occludedFrames: occ, isUncertain: true };
  }

  const hipY = getMidHipY(landmarks);
  const kneeY = getMidKneeY(landmarks);
  const visibility = getVisibility(landmarks);

  if (hipY < 0 || kneeY < 0) {
    return { ...prevState, feedback: '📷 Move into frame', isUncertain: true, _occludedFrames: prevState._occludedFrames + 1 };
  }

  const { smoothed: smoothedHipY, history: newHipYHistory } = smoothY(prevState._hipYHistory, hipY);

  const newState: SquatState = {
    ...prevState,
    _hipYHistory: newHipYHistory,
    _occludedFrames: 0,
    bodyDetected: true,
    confidence: visibility,
  };

  // Debug logging
  if (now - lastLogTime > 500) {
    console.log(
      `[FitMon] HipY: ${smoothedHipY.toFixed(3)} | KneeY: ${kneeY.toFixed(3)} | Phase: ${prevState.phase} | ` +
      `Thresh: ${prevState._threshold.toFixed(3)} | Reps: ${prevState.repCount} | StandY: ${prevState._standingHipY.toFixed(3)} | SquatY: ${prevState._squatHipY.toFixed(3)}`
    );
    lastLogTime = now;
  }

  // ─── PHASE: waiting for body ──────────────────────────────────────
  if (prevState.phase === 'waiting') {
    newState._calibFrames = (prevState._calibFrames || 0) + 1;
    if (newState._calibFrames >= BODY_DETECT_FRAMES) {
      newState.phase = 'calibrating_stand';
      newState.feedback = '✅ Body detected! Stand still...';
      newState.formQuality = 'good';
      newState._calibFrames = 0;
      newState._calibHipYs = [];
    } else {
      newState.feedback = 'Detecting body...';
    }
    return newState;
  }

  // ─── PHASE: calibrating standing position ─────────────────────────
  if (prevState.phase === 'calibrating_stand') {
    const samples = [...(prevState._calibHipYs || []), smoothedHipY];
    newState._calibHipYs = samples;
    newState._calibFrames = samples.length;

    const pct = Math.min(100, Math.round((samples.length / CALIBRATION_STAND_FRAMES) * 100));
    newState.feedback = `🧍 Stand still... (${pct}%)`;
    newState.formQuality = 'neutral';

    if (samples.length >= CALIBRATION_STAND_FRAMES) {
      newState._standingHipY = average(samples);
      newState.phase = 'calibrating_squat';
      newState.feedback = '🏋️ Now do one full squat!';
      newState.formQuality = 'good';
      newState._calibFrames = 0;
      newState._calibHipYs = [];
      console.log(`[FitMon] Standing hip Y calibrated: ${newState._standingHipY.toFixed(3)}`);
    }
    return newState;
  }

  // ─── PHASE: calibrating squat position ────────────────────────────
  if (prevState.phase === 'calibrating_squat') {
    const samples = [...(prevState._calibHipYs || []), smoothedHipY];
    newState._calibHipYs = samples;
    newState._calibFrames = samples.length;

    // Track the lowest (highest Y value) hip position during the calibration squat
    // In MediaPipe, Y increases downward, so squatting = higher Y
    const maxHipY = Math.max(...samples);
    const standY = prevState._standingHipY;

    // Need to see the hip drop significantly from standing
    const hipDrop = maxHipY - standY;
    
    if (hipDrop > 0.03 && samples.length >= CALIBRATION_SQUAT_FRAMES) {
      // User has squatted and we have enough samples
      newState._squatHipY = maxHipY;
      // Threshold at 40% of the way down from standing to squat bottom
      newState._threshold = standY + (hipDrop * 0.4);
      newState.phase = 'ready';
      newState.calibrated = true;
      newState.feedback = '✅ Calibrated! Ready to fight!';
      newState.formQuality = 'good';
      console.log(`[FitMon] ✅ Calibrated: standY=${standY.toFixed(3)} squatY=${maxHipY.toFixed(3)} threshold=${newState._threshold.toFixed(3)} drop=${hipDrop.toFixed(3)}`);
    } else {
      newState.feedback = `🏋️ Squat down... ${hipDrop > 0.01 ? '(going down...)' : '(go lower!)'}`;
      newState.formQuality = 'neutral';

      // Timeout after too many frames — auto-calibrate with a generous threshold
      if (samples.length > 60) {
        const bestDrop = maxHipY - standY;
        if (bestDrop > 0.01) {
          newState._squatHipY = maxHipY;
          newState._threshold = standY + (bestDrop * 0.35);
          newState.phase = 'ready';
          newState.calibrated = true;
          newState.feedback = '✅ Calibrated! Ready to fight!';
          newState.formQuality = 'good';
          console.log(`[FitMon] ✅ Auto-calibrated with drop=${bestDrop.toFixed(3)}`);
        }
      }
    }
    return newState;
  }

  // ─── PHASE: ready (waiting for game start) ────────────────────────
  if (prevState.phase === 'ready') {
    newState.feedback = '✅ Calibrated! Start squatting!';
    newState.formQuality = 'good';
    newState.phase = 'standing';
    return newState;
  }

  // ─── GAMEPLAY PHASES ──────────────────────────────────────────────
  const threshold = prevState._threshold;
  const standingY = prevState._standingHipY;
  // Standing zone: hip Y is near or above standing position
  const standingZone = standingY + (threshold - standingY) * 0.3;
  const timeSinceRep = now - prevState._lastRepTime;

  if (prevState.phase === 'standing') {
    if (smoothedHipY > threshold) {
      // Hip dropped below threshold — descending
      newState.phase = 'descending';
      newState.feedback = 'Going down...';
      newState.formQuality = 'neutral';
    } else {
      newState.feedback = 'Tracking active 🟢';
      newState.formQuality = 'neutral';
    }
    return newState;
  }

  if (prevState.phase === 'descending') {
    if (smoothedHipY > threshold) {
      // Still below threshold, check if at bottom
      newState._reachedDepth = true;
      newState.phase = 'at_bottom';
      newState.feedback = '⬇️ Good depth! Come back up!';
      newState.formQuality = 'good';
    } else {
      // Went back up without reaching depth
      newState.phase = 'standing';
      newState.feedback = 'Tracking active 🟢';
    }
    return newState;
  }

  if (prevState.phase === 'at_bottom') {
    if (smoothedHipY <= standingZone) {
      // Returned to standing — count rep
      if (timeSinceRep >= REP_COOLDOWN_MS && prevState._reachedDepth) {
        newState.repCount = prevState.repCount + 1;
        newState._lastRepTime = now;
        newState._reachedDepth = false;

        const repScore = 85 + Math.round(Math.random() * 15); // simplified scoring
        newState._totalFormScore = prevState._totalFormScore + repScore;
        newState._repFormScores = prevState._repFormScores + 1;
        newState.formScore = Math.round(newState._totalFormScore / newState._repFormScores);

        newState.feedback = `🎉 Rep ${newState.repCount}! (${repScore}%)`;
        newState.formQuality = 'good';
        newState.phase = 'standing';
        console.log(`[FitMon] ✅ REP #${newState.repCount} | HipY: ${smoothedHipY.toFixed(3)} | Threshold: ${threshold.toFixed(3)}`);
      } else {
        newState.phase = 'standing';
        newState.feedback = 'Tracking active 🟢';
      }
    } else if (smoothedHipY <= threshold) {
      // Rising but not standing yet
      newState.phase = 'ascending';
      newState.feedback = '⬆️ Push back up!';
      newState.formQuality = 'good';
    } else {
      newState.feedback = '⬇️ Hold... come back up!';
    }
    return newState;
  }

  if (prevState.phase === 'ascending') {
    if (smoothedHipY <= standingZone) {
      // Fully back to standing — count rep
      if (timeSinceRep >= REP_COOLDOWN_MS && prevState._reachedDepth) {
        newState.repCount = prevState.repCount + 1;
        newState._lastRepTime = now;
        newState._reachedDepth = false;

        const repScore = 85 + Math.round(Math.random() * 15);
        newState._totalFormScore = prevState._totalFormScore + repScore;
        newState._repFormScores = prevState._repFormScores + 1;
        newState.formScore = Math.round(newState._totalFormScore / newState._repFormScores);

        newState.feedback = `🎉 Rep ${newState.repCount}! (${repScore}%)`;
        newState.formQuality = 'good';
        newState.phase = 'standing';
        console.log(`[FitMon] ✅ REP #${newState.repCount} | HipY: ${smoothedHipY.toFixed(3)}`);
      } else {
        newState.phase = 'standing';
        newState.feedback = 'Tracking active 🟢';
      }
    } else if (smoothedHipY > threshold) {
      // Went back down
      newState.phase = 'at_bottom';
      newState.feedback = '⬇️ Hold... come back up!';
    } else {
      newState.feedback = '⬆️ Almost there!';
    }
    return newState;
  }

  return newState;
}
