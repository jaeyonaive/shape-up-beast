import { type Landmark, POSE, calculateAngle } from './pose-detection';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExerciseType = 'squats' | 'jumping_jacks' | 'lunges';

export type ExercisePhase =
  | 'waiting' | 'calibrating' | 'calibrating_squat'
  | 'standing' | 'descending' | 'at_bottom' | 'ascending'  // squats
  | 'closed' | 'opening' | 'open' | 'closing'              // jumping jacks
  | 'lunge_standing' | 'lunge_down' | 'lunge_returning';    // lunges

export interface ExerciseState {
  exerciseType: ExerciseType;
  phase: ExercisePhase;
  repCount: number;
  feedback: string;
  formQuality: 'good' | 'needs_work' | 'neutral';
  bodyDetected: boolean;
  kneesVisible: boolean;
  calibrated: boolean;
  calibrationProgress: number;

  // Internal calibration
  _calibStartTime: number;
  _calibMinHipY: number;
  _calibMaxHipY: number;
  _bodyDetectFrames: number;
  _occludedFrames: number;
  _lastRepTime: number;
  _hipYHistory: number[];

  // Squat-specific
  _standingHipY: number;
  _squatHipY: number;
  _threshold: number;
  _squatDropRatio: number;
  _reachedDepth: boolean;
  _baselineSquatDone: boolean;

  // JJ-specific
  _jjArmThreshold: number;
  _jjLegThreshold: number;
  _jjOpenConfirmFrames: number;
  _jjClosedConfirmFrames: number;

  // Lunge-specific
  _lungeKneeThreshold: number;
  _lastLungeLeg: 'left' | 'right';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BODY_DETECT_FRAMES = 5;
const CALIBRATION_TIMEOUT_MS = 5000;
const SMOOTHING_WINDOW = 5;

// 500ms cooldown between reps prevents double-counting
const REP_COOLDOWN_MS = 500;

const MAX_OCCLUSION_FRAMES = 20;
const SQUAT_KNEE_ANGLE_THRESHOLD = 120;

// Squat thresholds
const SQUAT_DEFAULT_DROP_RATIO = 0.22;
const SQUAT_MIN_DROP_RATIO = 0.20;
const SQUAT_MAX_DROP_RATIO = 0.25;

// Must return to within 8% of standing hip height to count the rep
const SQUAT_RETURN_RATIO = 0.08;

// Noise floor for hip movement detection
const SQUAT_NOISE_Y = 0.02;

// Minimum absolute hip drop in normalised coordinates
const MIN_ABSOLUTE_HIP_DROP = 0.04;

// Consecutive frames required to confirm JJ open/closed state
const JJ_CONFIRM_FRAMES = 3;

export const DAMAGE_MAP: Record<ExerciseType, number> = {
  squats: 8,
  jumping_jacks: 5,
  lunges: 12,
};

export const EXERCISE_LABELS: Record<ExerciseType, string> = {
  squats: 'Squats',
  jumping_jacks: 'Jumping Jacks',
  lunges: 'Lunges',
};

export const CALORIES_PER_REP: Record<ExerciseType, number> = {
  squats: 0.32,
  jumping_jacks: 0.15,
  lunges: 0.4,
};

// ─── Initialization ──────────────────────────────────────────────────────────

export function createExerciseState(exerciseType: ExerciseType): ExerciseState {
  return {
    exerciseType,
    phase: 'waiting',
    repCount: 0,
    feedback: 'Step into frame...',
    formQuality: 'neutral',
    bodyDetected: false,
    kneesVisible: false,
    calibrated: false,
    calibrationProgress: 0,
    _calibStartTime: 0,
    _calibMinHipY: 999,
    _calibMaxHipY: -999,
    _bodyDetectFrames: 0,
    _occludedFrames: 0,
    _lastRepTime: 0,
    _hipYHistory: [],
    _standingHipY: 0,
    _squatHipY: 0,
    _threshold: 0,
    _squatDropRatio: SQUAT_DEFAULT_DROP_RATIO,
    _reachedDepth: false,
    _baselineSquatDone: false,
    _jjArmThreshold: 0,
    _jjLegThreshold: 0,
    _jjOpenConfirmFrames: 0,
    _jjClosedConfirmFrames: 0,
    _lungeKneeThreshold: 0,
    _lastLungeLeg: 'left',
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMidHipY(landmarks: Landmark[]): number {
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  if (!lHip || !rHip) return -1;
  return (lHip.y + rHip.y) / 2;
}

function hasFullBody(landmarks: Landmark[]): boolean {
  const required = [
    POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER,
    POSE.LEFT_HIP, POSE.RIGHT_HIP,
    POSE.LEFT_KNEE, POSE.RIGHT_KNEE,
  ];

  if (!required.every(idx => landmarks[idx] && (landmarks[idx].visibility ?? 0) > 0.3)) {
    return false;
  }

  const lS = landmarks[POSE.LEFT_SHOULDER];
  const rS = landmarks[POSE.RIGHT_SHOULDER];
  const lH = landmarks[POSE.LEFT_HIP];
  const rH = landmarks[POSE.RIGHT_HIP];
  const lK = landmarks[POSE.LEFT_KNEE];
  const rK = landmarks[POSE.RIGHT_KNEE];

  // Anatomical ordering: shoulders above hips above knees (y increases downward)
  if (lS.y >= lH.y || rS.y >= rH.y) return false;
  if (lH.y >= lK.y || rH.y >= rK.y) return false;

  const shoulderWidth = Math.abs(rS.x - lS.x);
  if (shoulderWidth < 0.02) return false;

  return true;
}

export function hasKneesVisible(landmarks: Landmark[]): boolean {
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];
  return !!(lKnee && rKnee && (lKnee.visibility ?? 0) > 0.25 && (rKnee.visibility ?? 0) > 0.25);
}

function getBodyHeight(landmarks: Landmark[]): number {
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];
  if (!lShoulder || !rShoulder || !lKnee || !rKnee) return 0;
  const shoulderY = (lShoulder.y + rShoulder.y) / 2;
  const kneeY = (lKnee.y + rKnee.y) / 2;
  return Math.max(0, kneeY - shoulderY);
}

function smoothY(history: number[], newVal: number): { smoothed: number; history: number[] } {
  const updated = [...history, newVal].slice(-SMOOTHING_WINDOW);
  const sorted = [...updated].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Median filter — robust to sudden noise/spikes
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { smoothed: median, history: updated };
}

// ─── Jumping Jack helpers ─────────────────────────────────────────────────────

/**
 * Returns count of arms fully raised (both wrist AND elbow above shoulder required).
 * Using stricter check than original to avoid false positives from partial raises.
 */
function getArmSpread(landmarks: Landmark[]): number {
  const lWrist = landmarks[POSE.LEFT_WRIST];
  const rWrist = landmarks[POSE.RIGHT_WRIST];
  const lElbow = landmarks[POSE.LEFT_ELBOW];
  const rElbow = landmarks[POSE.RIGHT_ELBOW];
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  if (!lWrist || !rWrist || !lShoulder || !rShoulder || !lElbow || !rElbow) return 0;

  // y increases downward, so "above shoulder" means y < shoulder.y
  const lUp = lWrist.y < lShoulder.y && lElbow.y < lShoulder.y;
  const rUp = rWrist.y < rShoulder.y && rElbow.y < rShoulder.y;
  return (lUp ? 1 : 0) + (rUp ? 1 : 0);
}

/**
 * Returns true when both arms are clearly lowered — prevents premature "closed" detection.
 */
function armsDown(landmarks: Landmark[]): boolean {
  const lWrist = landmarks[POSE.LEFT_WRIST];
  const rWrist = landmarks[POSE.RIGHT_WRIST];
  const lElbow = landmarks[POSE.LEFT_ELBOW];
  const rElbow = landmarks[POSE.RIGHT_ELBOW];
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  if (!lWrist || !rWrist || !lShoulder || !rShoulder || !lElbow || !rElbow) return false;

  const lDown = lWrist.y > lShoulder.y && lElbow.y > lShoulder.y;
  const rDown = rWrist.y > rShoulder.y && rElbow.y > rShoulder.y;
  return lDown && rDown;
}

function getLegSpread(landmarks: Landmark[]): number {
  const lAnkle = landmarks[POSE.LEFT_ANKLE];
  const rAnkle = landmarks[POSE.RIGHT_ANKLE];
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  if (!lAnkle || !rAnkle || !lHip || !rHip) return 0;

  const hipWidth = Math.abs(rHip.x - lHip.x);
  const ankleWidth = Math.abs(rAnkle.x - lAnkle.x);
  return hipWidth > 0 ? ankleWidth / hipWidth : 0;
}

function anklesVisible(landmarks: Landmark[]): boolean {
  return !!(
    landmarks[POSE.LEFT_ANKLE] && landmarks[POSE.RIGHT_ANKLE] &&
    (landmarks[POSE.LEFT_ANKLE].visibility ?? 0) > 0.2 &&
    (landmarks[POSE.RIGHT_ANKLE].visibility ?? 0) > 0.2
  );
}

// ─── Lunge helpers ───────────────────────────────────────────────────────────

function getFrontKneeAngle(landmarks: Landmark[], side: 'left' | 'right'): number {
  if (side === 'left') {
    return calculateAngle(
      landmarks[POSE.LEFT_HIP],
      landmarks[POSE.LEFT_KNEE],
      landmarks[POSE.LEFT_ANKLE]
    );
  }
  return calculateAngle(
    landmarks[POSE.RIGHT_HIP],
    landmarks[POSE.RIGHT_KNEE],
    landmarks[POSE.RIGHT_ANKLE]
  );
}

function detectLungeSide(landmarks: Landmark[]): 'left' | 'right' | null {
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];
  if (!lKnee || !rKnee) return null;
  return lKnee.y > rKnee.y ? 'left' : 'right';
}

// ─── Main Detection Entry ─────────────────────────────────────────────────────

export function detectExercise(landmarks: Landmark[], prevState: ExerciseState): ExerciseState {
  const now = Date.now();
  const kneesVis = hasKneesVisible(landmarks);

  // ── Body visibility check ──
  if (!hasFullBody(landmarks)) {
    const occ = prevState._occludedFrames + 1;
    if (occ === 1) console.log('[Detection] Body not detected');
    return {
      ...prevState,
      feedback: 'No body detected — step into frame',
      formQuality: 'neutral',
      bodyDetected: false,
      kneesVisible: kneesVis,
      _occludedFrames: Math.min(occ, MAX_OCCLUSION_FRAMES),
      _bodyDetectFrames: 0,
    };
  }

  const hipY = getMidHipY(landmarks);
  const bodyHeight = getBodyHeight(landmarks);
  if (hipY < 0 || bodyHeight <= 0) {
    return { ...prevState, feedback: 'No body detected', bodyDetected: false, kneesVisible: kneesVis };
  }

  const { smoothed: smoothedHipY, history: newHipYHistory } = smoothY(prevState._hipYHistory, hipY);

  let state: ExerciseState = {
    ...prevState,
    _hipYHistory: newHipYHistory,
    _occludedFrames: 0,
    bodyDetected: true,
    kneesVisible: kneesVis,
  };

  // Log body re-detection
  if (!prevState.bodyDetected) {
    console.log('[Detection] Body detected');
  }

  // ═══ WAITING ═══
  if (prevState.phase === 'waiting') {
    const frames = (prevState._bodyDetectFrames || 0) + 1;
    state._bodyDetectFrames = frames;
    if (frames >= BODY_DETECT_FRAMES) {
      state.phase = 'calibrating';
      state._calibStartTime = now;
      state._calibMinHipY = smoothedHipY;
      state._calibMaxHipY = smoothedHipY;
      state.feedback = 'Body detected! Stand still to calibrate...';
      state.formQuality = 'good';
      state.calibrationProgress = 20;
      console.log('[Detection] Body detected — starting calibration');
    } else {
      state.feedback = 'Detecting body...';
      state.calibrationProgress = Math.round((frames / BODY_DETECT_FRAMES) * 20);
    }
    return state;
  }

  // ═══ CALIBRATING ═══
  if (prevState.phase === 'calibrating') {
    const elapsed = now - prevState._calibStartTime;

    // Phase 1: Record standing position for 1.5s
    if (elapsed < 1500) {
      state._calibMinHipY = Math.min(prevState._calibMinHipY, smoothedHipY);
      state._calibMaxHipY = Math.max(prevState._calibMaxHipY, smoothedHipY);
      state._standingHipY = (state._calibMinHipY + state._calibMaxHipY) / 2;
      state.calibrationProgress = Math.min(40, Math.round(20 + (elapsed / 1500) * 20));
      state.feedback = 'Stand straight... capturing your standing height';
      state.formQuality = 'neutral';
      return state;
    }

    // Phase 2: Ask for one squat
    if (!prevState._baselineSquatDone) {
      state._standingHipY = prevState._standingHipY || prevState._calibMinHipY;
      const hipDropRatio = (smoothedHipY - state._standingHipY) / bodyHeight;

      if (hipDropRatio >= SQUAT_MIN_DROP_RATIO) {
        state._squatHipY = smoothedHipY;
        state._squatDropRatio = Math.min(SQUAT_MAX_DROP_RATIO, Math.max(SQUAT_MIN_DROP_RATIO, hipDropRatio * 0.85));
        state._threshold = state._standingHipY + bodyHeight * state._squatDropRatio;
        state._baselineSquatDone = true;
        state.calibrationProgress = 90;
        state.feedback = 'Great squat! Now stand back up to start!';
        state.formQuality = 'good';
        console.log('[Detection] Calibration squat confirmed — drop ratio:', hipDropRatio.toFixed(3));
        return state;
      }

      if (elapsed >= CALIBRATION_TIMEOUT_MS) {
        // Timed out — use conservative defaults
        state._squatDropRatio = SQUAT_DEFAULT_DROP_RATIO;
        state._squatHipY = state._standingHipY + bodyHeight * state._squatDropRatio;
        state._threshold = state._standingHipY + bodyHeight * state._squatDropRatio;
        state._baselineSquatDone = true;
        state.calibrationProgress = 90;
        console.log('[Detection] Calibration timeout — defaults applied. standingHipY:', state._standingHipY.toFixed(3));
        // Fall through to finish
      } else {
        state.calibrationProgress = Math.min(80, Math.round(40 + ((elapsed - 1500) / (CALIBRATION_TIMEOUT_MS - 1500)) * 40));
        state.feedback = 'Do one squat to calibrate!';
        state.formQuality = 'neutral';
        return state;
      }
    }

    // Finish calibration
    state.calibrated = true;
    state.calibrationProgress = 100;
    state.formQuality = 'good';

    switch (state.exerciseType) {
      case 'squats':
        state.phase = 'standing';
        state.feedback = 'GO! Squat!';
        console.log('[Detection] Calibration done — squats. thresholdY:', state._threshold.toFixed(3), 'standingY:', state._standingHipY.toFixed(3));
        break;
      case 'jumping_jacks':
        state.phase = 'closed';
        state.feedback = 'GO! Jumping Jacks!';
        console.log('[Detection] Calibration done — jumping jacks');
        break;
      case 'lunges':
        state.phase = 'lunge_standing';
        state.feedback = 'GO! Lunge!';
        console.log('[Detection] Calibration done — lunges');
        break;
    }
    return state;
  }

  // ═══ GAMEPLAY ═══
  const timeSinceRep = now - prevState._lastRepTime;

  switch (prevState.exerciseType) {
    case 'squats':
      return detectSquatPhase(landmarks, state, smoothedHipY, timeSinceRep, now, bodyHeight);
    case 'jumping_jacks':
      return detectJumpingJackPhase(landmarks, state, timeSinceRep, now);
    case 'lunges':
      return detectLungePhase(landmarks, state, timeSinceRep, now);
  }
}

// ─── Squat Detection ──────────────────────────────────────────────────────────
//
// State machine: standing → descending → at_bottom → ascending → (rep) → standing
// Only counts a rep when:
//   1. Hip drops >= 20–25% of body height (+ knee angle confirmation if visible)
//   2. User fully returns to near-standing position

function getAvgKneeAngle(landmarks: Landmark[]): number {
  const leftAngle = calculateAngle(
    landmarks[POSE.LEFT_HIP], landmarks[POSE.LEFT_KNEE], landmarks[POSE.LEFT_ANKLE]
  );
  const rightAngle = calculateAngle(
    landmarks[POSE.RIGHT_HIP], landmarks[POSE.RIGHT_KNEE], landmarks[POSE.RIGHT_ANKLE]
  );
  if (leftAngle > 0 && rightAngle > 0) return (leftAngle + rightAngle) / 2;
  return leftAngle > 0 ? leftAngle : rightAngle;
}

function detectSquatPhase(
  landmarks: Landmark[],
  state: ExerciseState,
  smoothedHipY: number,
  timeSinceRep: number,
  now: number,
  bodyHeight: number,
): ExerciseState {
  const kneesVis = hasKneesVisible(landmarks);
  const kneeAngle = kneesVis ? getAvgKneeAngle(landmarks) : 999;
  const safeBodyHeight = Math.max(bodyHeight, 0.001);

  const squatDropRatio = Math.min(
    SQUAT_MAX_DROP_RATIO,
    Math.max(SQUAT_MIN_DROP_RATIO, state._squatDropRatio || SQUAT_DEFAULT_DROP_RATIO)
  );

  // Threshold Y positions (y increases downward in MediaPipe)
  const downThresholdY = state._standingHipY + safeBodyHeight * squatDropRatio;
  const returnThresholdY = state._standingHipY + safeBodyHeight * SQUAT_RETURN_RATIO;
  const startMoveY = state._standingHipY + safeBodyHeight * 0.06;

  const deepByHip = smoothedHipY >= downThresholdY;
  const deepByKnee = kneesVis && kneeAngle < SQUAT_KNEE_ANGLE_THRESHOLD;
  // When knees visible: require both hip depth AND knee angle (prevents false positives)
  // When knees not visible: hip-only fallback
  const isDeepEnough = kneesVis ? (deepByHip && deepByKnee) : deepByHip;

  const absoluteHipDrop = smoothedHipY - state._standingHipY;
  const hasMinDrop = absoluteHipDrop >= MIN_ABSOLUTE_HIP_DROP;

  const prevHipY = state._hipYHistory[state._hipYHistory.length - 2] ?? smoothedHipY;
  const hipVelocity = smoothedHipY - prevHipY;
  const movingDown = hipVelocity > SQUAT_NOISE_Y;
  const backToStanding = smoothedHipY <= returnThresholdY;

  if (!state._reachedDepth) {
    if (isDeepEnough && hasMinDrop) {
      state.phase = 'at_bottom';
      state._reachedDepth = true;
      state.feedback = 'Good depth! Stand back up!';
      state.formQuality = 'good';
      console.log('[Detection] Squat depth reached — hipY:', smoothedHipY.toFixed(3), 'threshold:', downThresholdY.toFixed(3));
      return state;
    }

    if (movingDown && smoothedHipY >= startMoveY) {
      state.phase = 'descending';
      state.feedback = 'Going down...';
    } else {
      state.phase = 'standing';
      state.feedback = 'Squat!';
    }
    state.formQuality = 'neutral';
    return state;
  }

  // Was at depth — waiting to return to standing
  if (backToStanding && timeSinceRep >= REP_COOLDOWN_MS) {
    state.repCount += 1;
    state._lastRepTime = now;
    state._reachedDepth = false;
    state.phase = 'standing';
    state.feedback = `Rep ${state.repCount}!`;
    state.formQuality = 'good';
    console.log('[Detection] Squat rep counted:', state.repCount);
    return state;
  }

  state.phase = 'ascending';
  state.feedback = backToStanding ? 'Squat again!' : 'Come back up...';
  state.formQuality = 'good';
  return state;
}

// ─── Jumping Jack Detection ───────────────────────────────────────────────────
//
// State machine: closed → (N confirm frames open) → open → (N confirm frames closed) → (rep) → closed
//
// Key fixes vs original:
// - Both wrist AND elbow must be above shoulder (not just one)
// - Both arms must go up (armSpread >= 2, not >= 1)
// - Require JJ_CONFIRM_FRAMES consecutive frames to confirm state change
// - armsDown() check requires both wrists AND elbows below shoulder

function detectJumpingJackPhase(
  landmarks: Landmark[],
  state: ExerciseState,
  timeSinceRep: number,
  now: number,
): ExerciseState {
  const armSpread = getArmSpread(landmarks);
  const legSpread = getLegSpread(landmarks);
  const hasAnkles = anklesVisible(landmarks);

  // Open = both arms fully up + legs spread (if ankles visible)
  const armsFullyUp = armSpread >= 2;
  const legsSpread = hasAnkles ? legSpread > 1.4 : true;
  const isOpenFrame = armsFullyUp && legsSpread;

  // Closed = both arms down + legs together (if ankles visible)
  const armsFullyDown = armsDown(landmarks);
  const legsTogether = hasAnkles ? legSpread < 1.2 : true;
  const isClosedFrame = armsFullyDown && legsTogether;

  if (state.phase === 'closed') {
    if (isOpenFrame) {
      const confirm = (state._jjOpenConfirmFrames || 0) + 1;
      state._jjOpenConfirmFrames = confirm;
      if (confirm >= JJ_CONFIRM_FRAMES) {
        state.phase = 'open';
        state._jjOpenConfirmFrames = 0;
        state._jjClosedConfirmFrames = 0;
        state.feedback = 'Arms up! Now close!';
        state.formQuality = 'good';
        console.log('[Detection] Jumping jack open confirmed');
      } else {
        state.feedback = 'Arms up! Keep going!';
        state.formQuality = 'good';
      }
    } else {
      state._jjOpenConfirmFrames = 0;
      state.feedback = 'Raise BOTH arms and jump out!';
      state.formQuality = 'neutral';
    }
    return state;
  }

  if (state.phase === 'open') {
    if (isClosedFrame && timeSinceRep >= REP_COOLDOWN_MS) {
      const confirm = (state._jjClosedConfirmFrames || 0) + 1;
      state._jjClosedConfirmFrames = confirm;
      if (confirm >= JJ_CONFIRM_FRAMES) {
        state.repCount += 1;
        state._lastRepTime = now;
        state.phase = 'closed';
        state._jjOpenConfirmFrames = 0;
        state._jjClosedConfirmFrames = 0;
        state.feedback = `Rep ${state.repCount}!`;
        state.formQuality = 'good';
        console.log('[Detection] Jumping jack rep counted:', state.repCount);
      } else {
        state.feedback = 'Feet together!';
        state.formQuality = 'good';
      }
    } else {
      state._jjClosedConfirmFrames = 0;
      state.feedback = 'Arms down and feet together!';
      state.formQuality = isOpenFrame ? 'good' : 'neutral';
    }
    return state;
  }

  // Fallback — reset to closed
  state.phase = 'closed';
  state._jjOpenConfirmFrames = 0;
  state._jjClosedConfirmFrames = 0;
  return state;
}

// ─── Lunge Detection ──────────────────────────────────────────────────────────

function detectLungePhase(landmarks: Landmark[], state: ExerciseState, timeSinceRep: number, now: number): ExerciseState {
  const lungeSide = detectLungeSide(landmarks);
  const kneeAngle = lungeSide ? getFrontKneeAngle(landmarks, lungeSide) : 180;
  const isLunging = kneeAngle < 130;
  const isStanding = kneeAngle > 155;

  if (state.phase === 'lunge_standing') {
    state.feedback = 'Lunge forward!';
    state.formQuality = 'neutral';
    if (isLunging) {
      state.phase = 'lunge_down';
      state._lastLungeLeg = lungeSide || 'left';
      state.feedback = 'Hold... push back up!';
      state.formQuality = 'good';
      console.log('[Detection] Lunge down');
    }
    return state;
  }

  if (state.phase === 'lunge_down') {
    if (isStanding && timeSinceRep >= REP_COOLDOWN_MS) {
      state.repCount += 1;
      state._lastRepTime = now;
      state.phase = 'lunge_standing';
      state.feedback = `Rep ${state.repCount}!`;
      state.formQuality = 'good';
      console.log('[Detection] Lunge rep counted:', state.repCount);
    } else if (isLunging) {
      state.feedback = 'Good! Come back up!';
    }
    return state;
  }

  if (state.phase === 'lunge_returning') {
    if (isStanding && timeSinceRep >= REP_COOLDOWN_MS) {
      state.repCount += 1;
      state._lastRepTime = now;
      state.phase = 'lunge_standing';
      state.feedback = `Rep ${state.repCount}!`;
      state.formQuality = 'good';
      console.log('[Detection] Lunge rep counted:', state.repCount);
    }
    return state;
  }

  if (!['lunge_standing', 'lunge_down', 'lunge_returning'].includes(state.phase)) {
    state.phase = 'lunge_standing';
  }
  return state;
}
