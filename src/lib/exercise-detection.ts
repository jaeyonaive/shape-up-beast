import { type Landmark, POSE, calculateAngle } from './pose-detection';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExerciseType = 'squats' | 'jumping_jacks' | 'lunges';

export type ExercisePhase =
  | 'waiting' | 'calibrating'
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
  _reachedDepth: boolean;

  // JJ-specific
  _jjArmThreshold: number;
  _jjLegThreshold: number;

  // Lunge-specific
  _lungeKneeThreshold: number;
  _lastLungeLeg: 'left' | 'right';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BODY_DETECT_FRAMES = 3;
const CALIBRATION_TIMEOUT_MS = 4000;
const MIN_HIP_DROP = 0.02;
const SMOOTHING_WINDOW = 3;
const REP_COOLDOWN_MS = 700;
const MAX_OCCLUSION_FRAMES = 20;
const SQUAT_KNEE_ANGLE_THRESHOLD = 140; // degrees — below this = squatting
const SQUAT_STANDING_ANGLE = 158;       // degrees — above this = standing

// Damage per exercise
export const DAMAGE_MAP: Record<ExerciseType, number> = {
  squats: 8,
  jumping_jacks: 5,
  lunges: 12,
};

export const EXERCISE_LABELS: Record<ExerciseType, string> = {
  squats: '🏋️ Squats',
  jumping_jacks: '⭐ Jumping Jacks',
  lunges: '🦵 Lunges',
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
    _reachedDepth: false,
    _jjArmThreshold: 0,
    _jjLegThreshold: 0,
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
  const required = [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.LEFT_HIP, POSE.RIGHT_HIP, POSE.LEFT_KNEE, POSE.RIGHT_KNEE];
  return required.every(idx => landmarks[idx] && (landmarks[idx].visibility ?? 0) > 0.1);
}

function smoothY(history: number[], newVal: number): { smoothed: number; history: number[] } {
  const updated = [...history, newVal].slice(-SMOOTHING_WINDOW);
  const sorted = [...updated].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { smoothed: median, history: updated };
}

// ─── Jumping Jack helpers ────────────────────────────────────────────────────

function getArmSpread(landmarks: Landmark[]): number {
  const lWrist = landmarks[POSE.LEFT_WRIST];
  const rWrist = landmarks[POSE.RIGHT_WRIST];
  const lElbow = landmarks[POSE.LEFT_ELBOW];
  const rElbow = landmarks[POSE.RIGHT_ELBOW];
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  if (!lWrist || !rWrist || !lShoulder || !rShoulder || !lElbow || !rElbow) return 0;

  // Arms up: wrist OR elbow above shoulder level
  const lUp = lWrist.y < lShoulder.y || lElbow.y < lShoulder.y;
  const rUp = rWrist.y < rShoulder.y || rElbow.y < rShoulder.y;
  return (lUp ? 1 : 0) + (rUp ? 1 : 0);
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
  // The knee that's lower (higher y) is the front leg in a lunge
  return lKnee.y > rKnee.y ? 'left' : 'right';
}

// ─── Main Detection ──────────────────────────────────────────────────────────

export function detectExercise(landmarks: Landmark[], prevState: ExerciseState): ExerciseState {
  const now = Date.now();

  // Body visibility check
  if (!hasFullBody(landmarks)) {
    const occ = prevState._occludedFrames + 1;
    if (occ > MAX_OCCLUSION_FRAMES) {
      return { ...prevState, feedback: '📷 Move into frame', formQuality: 'neutral', bodyDetected: false, _occludedFrames: occ };
    }
    return { ...prevState, _occludedFrames: occ };
  }

  const hipY = getMidHipY(landmarks);
  if (hipY < 0) return { ...prevState, feedback: '📷 Move into frame' };

  const { smoothed: smoothedHipY, history: newHipYHistory } = smoothY(prevState._hipYHistory, hipY);
  let state: ExerciseState = { ...prevState, _hipYHistory: newHipYHistory, _occludedFrames: 0, bodyDetected: true };

  // ═══ WAITING: detect body ═══
  if (prevState.phase === 'waiting') {
    const frames = (prevState._bodyDetectFrames || 0) + 1;
    state._bodyDetectFrames = frames;
    if (frames >= BODY_DETECT_FRAMES) {
      state.phase = 'calibrating';
      state._calibStartTime = now;
      state._calibMinHipY = smoothedHipY;
      state._calibMaxHipY = smoothedHipY;
      state.feedback = '✅ Body detected! Get ready...';
      state.formQuality = 'good';
      state.calibrationProgress = 10;
    } else {
      state.feedback = 'Detecting body...';
      state.calibrationProgress = Math.round((frames / BODY_DETECT_FRAMES) * 20);
    }
    return state;
  }

  // ═══ CALIBRATING ═══
  if (prevState.phase === 'calibrating') {
    const elapsed = now - prevState._calibStartTime;
    state.calibrationProgress = Math.min(100, Math.round(20 + (elapsed / CALIBRATION_TIMEOUT_MS) * 80));
    state._calibMinHipY = Math.min(prevState._calibMinHipY, smoothedHipY);
    state._calibMaxHipY = Math.max(prevState._calibMaxHipY, smoothedHipY);

    if (elapsed >= CALIBRATION_TIMEOUT_MS || (prevState._calibMaxHipY - prevState._calibMinHipY >= MIN_HIP_DROP && elapsed > 1000)) {
      // Finish calibration
      const minY = state._calibMinHipY;
      const maxY = state._calibMaxHipY;
      const drop = maxY - minY;
      state._standingHipY = minY;
      state._squatHipY = drop >= MIN_HIP_DROP ? maxY : minY + 0.08;
      state._threshold = minY + (state._squatHipY - minY) * 0.4;
      state.calibrated = true;
      state.calibrationProgress = 100;
      state.formQuality = 'good';

      // Set initial phase based on exercise type
      switch (state.exerciseType) {
        case 'squats': state.phase = 'standing'; state.feedback = '✅ Go! Squat!'; break;
        case 'jumping_jacks': state.phase = 'closed'; state.feedback = '✅ Go! Jump!'; break;
        case 'lunges': state.phase = 'lunge_standing'; state.feedback = '✅ Go! Lunge!'; break;
      }
      return state;
    }

    state.feedback = `🏋️ Preparing ${EXERCISE_LABELS[state.exerciseType]}...`;
    state.formQuality = 'neutral';
    return state;
  }

  // ═══ GAMEPLAY ═══
  const timeSinceRep = now - prevState._lastRepTime;

  switch (prevState.exerciseType) {
    case 'squats':
      return detectSquatPhase(landmarks, state, smoothedHipY, timeSinceRep, now);
    case 'jumping_jacks':
      return detectJumpingJackPhase(landmarks, state, timeSinceRep, now);
    case 'lunges':
      return detectLungePhase(landmarks, state, timeSinceRep, now);
  }
}

// ─── Squat Detection (uses knee angle + hip Y) ──────────────────────────────

function getAvgKneeAngle(landmarks: Landmark[]): number {
  const leftAngle = calculateAngle(
    landmarks[POSE.LEFT_HIP], landmarks[POSE.LEFT_KNEE], landmarks[POSE.LEFT_ANKLE]
  );
  const rightAngle = calculateAngle(
    landmarks[POSE.RIGHT_HIP], landmarks[POSE.RIGHT_KNEE], landmarks[POSE.RIGHT_ANKLE]
  );
  // Use whichever is valid; average if both are
  if (leftAngle > 0 && rightAngle > 0) return (leftAngle + rightAngle) / 2;
  return leftAngle > 0 ? leftAngle : rightAngle;
}

function detectSquatPhase(landmarks: Landmark[], state: ExerciseState, smoothedHipY: number, timeSinceRep: number, now: number): ExerciseState {
  const kneeAngle = getAvgKneeAngle(landmarks);
  const threshold = state._threshold;
  const standingZone = state._standingHipY + (threshold - state._standingHipY) * 0.3;
  const returnZone = state._standingHipY + (threshold - state._standingHipY) * 0.5;

  const isDescending = kneeAngle < 152 || smoothedHipY > state._standingHipY + (threshold - state._standingHipY) * 0.55;
  const isDeepEnough = kneeAngle < SQUAT_KNEE_ANGLE_THRESHOLD || smoothedHipY > threshold;
  const isRecovered = kneeAngle > 150 || smoothedHipY <= returnZone;
  const isStanding = kneeAngle > SQUAT_STANDING_ANGLE && smoothedHipY <= standingZone;

  if (state.phase === 'standing') {
    if (isDeepEnough) {
      state.phase = 'at_bottom';
      state._reachedDepth = true;
      state.feedback = '⬇️ Good depth! Come back up!';
      state.formQuality = 'good';
    } else if (isDescending) {
      state.phase = 'descending';
      state.feedback = '⬇️ Going down...';
      state.formQuality = 'neutral';
    } else {
      state.feedback = 'Tracking active 🟢';
      state.formQuality = 'neutral';
    }
    return state;
  }

  if (state.phase === 'descending' || state.phase === 'at_bottom' || state.phase === 'ascending') {
    if (isDeepEnough) {
      state._reachedDepth = true;
      state.phase = 'at_bottom';
      state.feedback = '⬇️ Good! Come back up!';
      state.formQuality = 'good';
      return state;
    }

    if (state._reachedDepth && isRecovered && timeSinceRep >= REP_COOLDOWN_MS) {
      state.repCount += 1;
      state._lastRepTime = now;
      state._reachedDepth = false;
      state.phase = 'standing';
      state.feedback = `🎉 Rep ${state.repCount}!`;
      state.formQuality = 'good';
      return state;
    }

    state.phase = isStanding ? 'standing' : 'ascending';
    state.feedback = '⬆️ Nice! Keep coming up!';
    state.formQuality = 'good';
    return state;
  }

  state.phase = 'standing';
  return state;
}

// ─── Jumping Jack Detection ──────────────────────────────────────────────────

function detectJumpingJackPhase(_landmarks: Landmark[], state: ExerciseState, timeSinceRep: number, now: number): ExerciseState {
  const armSpread = getArmSpread(_landmarks);
  const legSpread = getLegSpread(_landmarks);
  
  // At least one arm up + legs spread = open
  const isOpen = armSpread >= 1 && legSpread > 1.1;
  const isClosed = armSpread === 0 && legSpread < 1.3;

  if (state.phase === 'closed') {
    state.feedback = '⭐ Raise BOTH arms & jump out!';
    state.formQuality = 'neutral';
    if (isOpen) {
      state.phase = 'open';
      state.feedback = '⭐ Arms up! Now close!';
      state.formQuality = 'good';
    }
    return state;
  }

  if (state.phase === 'open') {
    state.feedback = '⬇️ Arms down & feet together!';
    if (isClosed && timeSinceRep >= REP_COOLDOWN_MS) {
      state.repCount += 1;
      state._lastRepTime = now;
      state.phase = 'closed';
      state.feedback = `🎉 Rep ${state.repCount}!`;
      state.formQuality = 'good';
    }
    return state;
  }

  state.phase = 'closed';
  return state;
}

// ─── Lunge Detection ─────────────────────────────────────────────────────────

function detectLungePhase(landmarks: Landmark[], state: ExerciseState, timeSinceRep: number, now: number): ExerciseState {
  const lungeSide = detectLungeSide(landmarks);
  const kneeAngle = lungeSide ? getFrontKneeAngle(landmarks, lungeSide) : 180;
  const isLunging = kneeAngle < 130; // bent knee
  const isStanding = kneeAngle > 155;

  if (state.phase === 'lunge_standing') {
    state.feedback = 'Tracking active 🟢';
    state.formQuality = 'neutral';
    if (isLunging) {
      state.phase = 'lunge_down';
      state._lastLungeLeg = lungeSide || 'left';
      state.feedback = '🦵 Lunge down!';
      state.formQuality = 'good';
    }
    return state;
  }

  if (state.phase === 'lunge_down') {
    if (isStanding && timeSinceRep >= REP_COOLDOWN_MS) {
      state.repCount += 1;
      state._lastRepTime = now;
      state.phase = 'lunge_standing';
      state.feedback = `🎉 Rep ${state.repCount}!`;
      state.formQuality = 'good';
    } else if (isLunging) {
      state.feedback = '🦵 Hold... come back up!';
    }
    return state;
  }

  if (state.phase === 'lunge_returning') {
    if (isStanding && timeSinceRep >= REP_COOLDOWN_MS) {
      state.repCount += 1;
      state._lastRepTime = now;
      state.phase = 'lunge_standing';
      state.feedback = `🎉 Rep ${state.repCount}!`;
      state.formQuality = 'good';
    }
    return state;
  }

  // Reset if unexpected phase
  if (!['lunge_standing', 'lunge_down', 'lunge_returning'].includes(state.phase)) {
    state.phase = 'lunge_standing';
  }

  return state;
}
