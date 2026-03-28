import { type Landmark, POSE, calculateAngle } from './pose-detection';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExerciseType = 'high_knees' | 'jumping_jacks' | 'lunges';

export type ExercisePhase =
  | 'waiting' | 'calibrating' | 'calibrating_squat'
  | 'hk_standing' | 'hk_knee_up' | 'hk_returning'          // high knees
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
  _reachedDepth: boolean;
  _baselineSquatDone: boolean;

  // JJ-specific
  _jjArmThreshold: number;
  _jjLegThreshold: number;

  // Lunge-specific
  _lungeKneeThreshold: number;
  _lastLungeLeg: 'left' | 'right';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BODY_DETECT_FRAMES = 3;
const CALIBRATION_TIMEOUT_MS = 5000;
const MIN_HIP_DROP = 0.02;
const SMOOTHING_WINDOW = 3;
const REP_COOLDOWN_MS = 700;
const MAX_OCCLUSION_FRAMES = 20;
const HIGH_KNEE_THRESHOLD = 0.03;

// Damage per exercise
export const DAMAGE_MAP: Record<ExerciseType, number> = {
  high_knees: 6,
  jumping_jacks: 5,
  lunges: 12,
};

export const EXERCISE_LABELS: Record<ExerciseType, string> = {
  high_knees: 'High Knees',
  jumping_jacks: 'Jumping Jacks',
  lunges: 'Lunges',
};

export const CALORIES_PER_REP: Record<ExerciseType, number> = {
  high_knees: 0.2,
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
    _reachedDepth: false,
    _baselineSquatDone: false,
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
  // Only require shoulders + hips — knees are optional (close to camera)
  const required = [
    POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER,
    POSE.LEFT_HIP, POSE.RIGHT_HIP,
  ];
  return required.every(idx => landmarks[idx] && (landmarks[idx].visibility ?? 0) > 0.1);
}

export function hasKneesVisible(landmarks: Landmark[]): boolean {
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];
  return !!(lKnee && rKnee && (lKnee.visibility ?? 0) > 0.3 && (rKnee.visibility ?? 0) > 0.3);
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
  return lKnee.y > rKnee.y ? 'left' : 'right';
}

// ─── Main Detection ──────────────────────────────────────────────────────────

export function detectExercise(landmarks: Landmark[], prevState: ExerciseState): ExerciseState {
  const now = Date.now();
  const kneesVis = hasKneesVisible(landmarks);

  // Body visibility check
  if (!hasFullBody(landmarks)) {
    const occ = prevState._occludedFrames + 1;
    if (occ > MAX_OCCLUSION_FRAMES) {
      return {
        ...prevState,
        feedback: 'Move into frame — make sure your whole body is visible',
        formQuality: 'neutral',
        bodyDetected: false,
        kneesVisible: kneesVis,
        _occludedFrames: occ,
      };
    }
    return { ...prevState, _occludedFrames: occ, kneesVisible: kneesVis };
  }

  const hipY = getMidHipY(landmarks);
  if (hipY < 0) return { ...prevState, feedback: 'Move into frame', kneesVisible: kneesVis };

  const { smoothed: smoothedHipY, history: newHipYHistory } = smoothY(prevState._hipYHistory, hipY);
  let state: ExerciseState = {
    ...prevState,
    _hipYHistory: newHipYHistory,
    _occludedFrames: 0,
    bodyDetected: true,
    kneesVisible: kneesVis,
  };

  // ═══ WAITING: detect body ═══
  if (prevState.phase === 'waiting') {
    const frames = (prevState._bodyDetectFrames || 0) + 1;
    state._bodyDetectFrames = frames;
    if (frames >= BODY_DETECT_FRAMES) {
      state.phase = 'calibrating';
      state._calibStartTime = now;
      state._calibMinHipY = smoothedHipY;
      state._calibMaxHipY = smoothedHipY;
      state.feedback = 'Body detected! Stand still...';
      state.formQuality = 'good';
      state.calibrationProgress = 20;
    } else {
      state.feedback = 'Detecting body...';
      state.calibrationProgress = Math.round((frames / BODY_DETECT_FRAMES) * 20);
    }
    return state;
  }

  // ═══ CALIBRATING: capture standing position, then ask for one squat ═══
  if (prevState.phase === 'calibrating') {
    // Knees not required — just helpful hint
    if (!kneesVis) {
      state.feedback = 'Knees not visible — detection may use hip position only';
    }

    const elapsed = now - prevState._calibStartTime;

    // Record standing hip Y for 1.5 seconds
    if (elapsed < 1500) {
      state._calibMinHipY = Math.min(prevState._calibMinHipY, smoothedHipY);
      state._calibMaxHipY = Math.max(prevState._calibMaxHipY, smoothedHipY);
      state.calibrationProgress = Math.min(40, Math.round(20 + (elapsed / 1500) * 20));
      state.feedback = 'Stand straight... capturing your height';
      state.formQuality = 'neutral';
      return state;
    }

    // After 1.5s of standing, save standing position & ask for a squat
    if (!prevState._baselineSquatDone) {
      state._standingHipY = prevState._calibMinHipY;

      // Check if they've performed a squat (hip dropped significantly)
      const hipDrop = smoothedHipY - state._standingHipY;

      if (hipDrop > 0.04) {
        // They squatted! Record it
        state._squatHipY = smoothedHipY;
        state._threshold = state._standingHipY + (smoothedHipY - state._standingHipY) * 0.4;
        state._baselineSquatDone = true;
        state.calibrationProgress = 90;
        state.feedback = 'Great squat! Stand back up...';
        state.formQuality = 'good';
        return state;
      }

      // Timeout: use defaults after 5 seconds total
      if (elapsed >= CALIBRATION_TIMEOUT_MS) {
        state._squatHipY = state._standingHipY + 0.08;
        state._threshold = state._standingHipY + 0.032;
        state._baselineSquatDone = true;
        state.calibrationProgress = 90;
        // Fall through to finish calibration
      } else {
        state.calibrationProgress = Math.min(80, Math.round(40 + ((elapsed - 1500) / (CALIBRATION_TIMEOUT_MS - 1500)) * 40));
        state.feedback = 'Now do one squat to calibrate...';
        state.formQuality = 'neutral';
        return state;
      }
    }

    // Finish calibration
    state.calibrated = true;
    state.calibrationProgress = 100;
    state.formQuality = 'good';

    switch (state.exerciseType) {
      case 'high_knees': state.phase = 'hk_standing'; state.feedback = 'GO! High knees!'; break;
      case 'jumping_jacks': state.phase = 'closed'; state.feedback = 'GO! Jump!'; break;
      case 'lunges': state.phase = 'lunge_standing'; state.feedback = 'GO! Lunge!'; break;
    }
    return state;
  }

  // ═══ GAMEPLAY ═══
  const timeSinceRep = now - prevState._lastRepTime;

  switch (prevState.exerciseType) {
    case 'high_knees':
      return detectHighKneesPhase(landmarks, state, timeSinceRep, now);
    case 'jumping_jacks':
      return detectJumpingJackPhase(landmarks, state, timeSinceRep, now);
    case 'lunges':
      return detectLungePhase(landmarks, state, timeSinceRep, now);
  }
}

// ─── High Knees Detection ───────────────────────────────────────────────────
// Detects when either knee rises above hip level (alternating legs)

function getKneeHeight(landmarks: Landmark[], side: 'left' | 'right'): number {
  const hip = side === 'left' ? landmarks[POSE.LEFT_HIP] : landmarks[POSE.RIGHT_HIP];
  const knee = side === 'left' ? landmarks[POSE.LEFT_KNEE] : landmarks[POSE.RIGHT_KNEE];
  if (!hip || !knee) return 0;
  // How far knee is above hip (negative y = higher on screen)
  return hip.y - knee.y;
}

function detectHighKneesPhase(landmarks: Landmark[], state: ExerciseState, timeSinceRep: number, now: number): ExerciseState {
  const leftKneeUp = getKneeHeight(landmarks, 'left');
  const rightKneeUp = getKneeHeight(landmarks, 'right');

  // Knee is "up" if it rises significantly (above ~hip level)
  const kneeUpThreshold = 0.03; // normalized coords — small movement counts
  const eitherKneeUp = leftKneeUp > kneeUpThreshold || rightKneeUp > kneeUpThreshold;
  const bothKneesDown = leftKneeUp < 0.01 && rightKneeUp < 0.01;

  if (state.phase === 'hk_standing') {
    state.feedback = 'Lift your knees!';
    state.formQuality = 'neutral';
    if (eitherKneeUp) {
      state.phase = 'hk_knee_up';
      state.feedback = 'Knee up! Now switch!';
      state.formQuality = 'good';
    }
    return state;
  }

  if (state.phase === 'hk_knee_up') {
    if (bothKneesDown && timeSinceRep >= REP_COOLDOWN_MS) {
      state.repCount += 1;
      state._lastRepTime = now;
      state.phase = 'hk_standing';
      state.feedback = `Rep ${state.repCount}!`;
      state.formQuality = 'good';
    } else if (eitherKneeUp) {
      state.feedback = 'Good! Bring it down!';
    }
    return state;
  }

  state.phase = 'hk_standing';
  return state;
}

// ─── Jumping Jack Detection ──────────────────────────────────────────────────

function detectJumpingJackPhase(_landmarks: Landmark[], state: ExerciseState, timeSinceRep: number, now: number): ExerciseState {
  const armSpread = getArmSpread(_landmarks);
  const legSpread = getLegSpread(_landmarks);

  // At least one arm up AND legs slightly apart
  const isOpen = armSpread >= 1 && legSpread > 1.1;
  // Arms down AND legs together
  const isClosed = armSpread === 0 && legSpread < 1.3;

  if (state.phase === 'closed') {
    state.feedback = 'Raise BOTH arms and jump out!';
    state.formQuality = 'neutral';
    if (isOpen) {
      state.phase = 'open';
      state.feedback = 'Arms up! Now close!';
      state.formQuality = 'good';
    }
    return state;
  }

  if (state.phase === 'open') {
    state.feedback = 'Arms down and feet together!';
    if (isClosed && timeSinceRep >= REP_COOLDOWN_MS) {
      state.repCount += 1;
      state._lastRepTime = now;
      state.phase = 'closed';
      state.feedback = `Rep ${state.repCount}!`;
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
  const isLunging = kneeAngle < 130;
  const isStanding = kneeAngle > 155;

  if (state.phase === 'lunge_standing') {
    state.feedback = 'Tracking active';
    state.formQuality = 'neutral';
    if (isLunging) {
      state.phase = 'lunge_down';
      state._lastLungeLeg = lungeSide || 'left';
      state.feedback = 'Lunge down!';
      state.formQuality = 'good';
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
    } else if (isLunging) {
      state.feedback = 'Hold... come back up!';
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
    }
    return state;
  }

  if (!['lunge_standing', 'lunge_down', 'lunge_returning'].includes(state.phase)) {
    state.phase = 'lunge_standing';
  }

  return state;
}
