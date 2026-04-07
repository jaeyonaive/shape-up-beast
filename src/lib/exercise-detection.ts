import { type Landmark, POSE, calculateAngle } from './pose-detection';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExerciseType = 'squats' | 'jumping_jacks' | 'lunges';

export type ExercisePhase =
  | 'waiting' | 'calibrating' | 'calibrating_squat'
  | 'standing' | 'descending' | 'at_bottom' | 'ascending' | 'cooldown'  // squats
  | 'closed' | 'opening' | 'open' | 'closing'                           // jumping jacks
  | 'lunge_standing' | 'lunge_down' | 'lunge_returning';                 // lunges

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

  // Lunge-specific
  _lungeKneeThreshold: number;
  _lastLungeLeg: 'left' | 'right';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BODY_DETECT_FRAMES = 5;
const CALIBRATION_TIMEOUT_MS = 5000;
const SMOOTHING_ALPHA = 0.4;  // EMA factor: higher = more responsive, less smooth
const REP_COOLDOWN_MS = 500;
const MAX_OCCLUSION_FRAMES = 20;
const SQUAT_KNEE_ANGLE_THRESHOLD = 120;
const SQUAT_STANDING_ANGLE = 160;
const SQUAT_DEFAULT_DROP_RATIO = 0.22;
const SQUAT_MIN_DROP_RATIO = 0.2;
const SQUAT_MAX_DROP_RATIO = 0.25;
// Fraction of calibrated drop range that defines "deep enough" and "back to standing"
const SQUAT_DOWN_FRACTION = 0.75;   // hips at 75% of calibrated depth → "down"
const SQUAT_UP_FRACTION = 0.28;     // hips within 28% of standing → "back up"
const MIN_CALIB_DROP = 0.06;        // minimum meaningful calibrated drop (safety guard)

// Damage per exercise
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
    _lungeKneeThreshold: 0,
    _lastLungeLeg: 'left',
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Detect which axis is vertical by comparing the shoulder-to-knee spread in x vs y.
// The axis with the larger spread is the one running head-to-feet.
// Returns 'y' for portrait video and 'x' for landscape video (rotated 90° on mobile).
function getVerticalAxis(landmarks: Landmark[]): { axis: 'x' | 'y'; headIsAtLowValue: boolean } {
  const lS = landmarks[POSE.LEFT_SHOULDER];
  const lK = landmarks[POSE.LEFT_KNEE];
  if (!lS || !lK) return { axis: 'y', headIsAtLowValue: true };

  const xSpread = Math.abs(lS.x - lK.x);
  const ySpread = Math.abs(lS.y - lK.y);

  if (xSpread > ySpread) {
    // Landscape video: x is the vertical axis.
    // "headIsAtLowValue" = true when shoulder.x < knee.x (head at x≈0, feet at x≈1).
    return { axis: 'x', headIsAtLowValue: lS.x < lK.x };
  }
  // Portrait video: y is vertical, head always at y≈0 (smaller value).
  return { axis: 'y', headIsAtLowValue: true };
}

// Returns the hip's position along the vertical axis, normalized so that
// 0 = head side and 1 = feet side (squatting always increases this value).
// Works for both portrait and landscape camera frames.
function getMidHipVertical(landmarks: Landmark[]): number {
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  if (!lHip || !rHip) return -1;

  const { axis, headIsAtLowValue } = getVerticalAxis(landmarks);
  const raw = axis === 'x'
    ? (lHip.x + rHip.x) / 2
    : (lHip.y + rHip.y) / 2;

  // Normalize: if head is at the HIGH end of the axis, flip so that
  // squatting (moving toward feet) always increases the returned value.
  return headIsAtLowValue ? raw : 1 - raw;
}

function hasFullBody(landmarks: Landmark[]): boolean {
  // Require shoulders + hips + knees for rep counting
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
  const lK = landmarks[POSE.LEFT_KNEE];

  const { axis, headIsAtLowValue } = getVerticalAxis(landmarks);

  // Anatomical ordering: shoulder must be "above" hip, hip above knee.
  // The direction of "above" depends on camera orientation.
  const coord = (lm: { x: number; y: number }) => axis === 'x' ? lm.x : lm.y;
  const dir = headIsAtLowValue ? 1 : -1; // +1: smaller coord = higher up; -1: larger = higher up

  if (dir * coord(lS) >= dir * coord(lH)) return false; // shoulder not above hip
  if (dir * coord(lH) >= dir * coord(lK)) return false; // hip not above knee

  // Shoulder width: the axis perpendicular to vertical
  const widthCoord = (lm: { x: number; y: number }) => axis === 'x' ? lm.y : lm.x;
  if (Math.abs(widthCoord(rS) - widthCoord(lS)) < 0.02) return false;

  return true;
}

// Body height: span between shoulder and knee along the vertical axis.
function getBodyHeight(landmarks: Landmark[]): number {
  const lS = landmarks[POSE.LEFT_SHOULDER];
  const lK = landmarks[POSE.LEFT_KNEE];
  if (!lS || !lK) return 0;
  // Use the larger spread — whichever axis is vertical will have the bigger value
  return Math.max(Math.abs(lS.y - lK.y), Math.abs(lS.x - lK.x));
}

// EMA smoother: lower latency than median, still removes single-frame noise.
// history stores only the last smoothed value [prevEMA].
function smoothY(history: number[], newVal: number): { smoothed: number; history: number[] } {
  const prev = history.length > 0 ? history[history.length - 1] : newVal;
  const smoothed = prev + SMOOTHING_ALPHA * (newVal - prev);
  return { smoothed, history: [smoothed] };
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

  // Body visibility check — give specific framing guidance when possible
  if (!hasFullBody(landmarks)) {
    const occ = prevState._occludedFrames + 1;
    const framingMsg = getFramingGuidance(landmarks) ?? 'Move into frame';
    return {
      ...prevState,
      feedback: framingMsg,
      formQuality: 'neutral',
      bodyDetected: false,
      kneesVisible: kneesVis,
      _occludedFrames: Math.min(occ, MAX_OCCLUSION_FRAMES),
      _bodyDetectFrames: 0,
    };
  }

  const hipY = getMidHipVertical(landmarks);
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

  // ═══ WAITING: detect body ═══
  if (prevState.phase === 'waiting') {
    // Require full framing (head + ankles visible) before counting detect frames.
    const framingIssue = getFramingGuidance(landmarks);
    if (framingIssue) {
      return {
        ...state,
        feedback: framingIssue,
        calibrationProgress: 0,
        _bodyDetectFrames: 0,
      };
    }

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
    // Pause calibration if framing is lost — ankles and head must stay visible
    const framingIssue = getFramingGuidance(landmarks);
    if (framingIssue) {
      return { ...state, feedback: framingIssue, formQuality: 'neutral' };
    }

    const elapsed = now - prevState._calibStartTime;

    // Record standing hip Y for 1.5 seconds
    if (elapsed < 1500) {
      state._calibMinHipY = Math.min(prevState._calibMinHipY, smoothedHipY);
      state._calibMaxHipY = Math.max(prevState._calibMaxHipY, smoothedHipY);
      state._standingHipY = (state._calibMinHipY + state._calibMaxHipY) / 2;
      state.calibrationProgress = Math.min(40, Math.round(20 + (elapsed / 1500) * 20));
      state.feedback = 'Stand straight... capturing your height';
      state.formQuality = 'neutral';
      return state;
    }

    // After 1.5s of standing, save standing position & ask for a squat
    if (!prevState._baselineSquatDone) {
      state._standingHipY = prevState._standingHipY || prevState._calibMinHipY;

      // Check if they've performed a squat (hip dropped significantly)
      const hipDropRatio = (smoothedHipY - state._standingHipY) / bodyHeight;

      if (hipDropRatio >= SQUAT_MIN_DROP_RATIO) {
        // They squatted! Record it
        state._squatHipY = smoothedHipY;
        state._squatDropRatio = Math.min(SQUAT_MAX_DROP_RATIO, Math.max(SQUAT_MIN_DROP_RATIO, hipDropRatio * 0.85));
        state._threshold = state._standingHipY + bodyHeight * state._squatDropRatio;
        state._baselineSquatDone = true;
        state.calibrationProgress = 90;
        state.feedback = 'Great squat! Stand back up...';
        state.formQuality = 'good';
        return state;
      }

      // Timeout: use defaults after 5 seconds total
      if (elapsed >= CALIBRATION_TIMEOUT_MS) {
        state._squatDropRatio = SQUAT_DEFAULT_DROP_RATIO;
        state._squatHipY = state._standingHipY + bodyHeight * state._squatDropRatio;
        state._threshold = state._standingHipY + bodyHeight * state._squatDropRatio;
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
      case 'squats': state.phase = 'standing'; state.feedback = 'GO! Squat!'; break;
      case 'jumping_jacks': state.phase = 'closed'; state.feedback = 'GO! Jump!'; break;
      case 'lunges': state.phase = 'lunge_standing'; state.feedback = 'GO! Lunge!'; break;
    }
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

// ─── Squat Detection — 3-state machine ──────────────────────────────────────
//
//  standing ──(hips reach downThreshold)──▶ at_bottom
//  at_bottom ──(hips return to upThreshold)──▶ cooldown  (+1 rep)
//  cooldown ──(REP_COOLDOWN_MS elapsed)──▶ standing
//
// Thresholds are fractions of the calibrated drop range so the system
// automatically adapts to every body type and camera distance.

function detectSquatPhase(_landmarks: Landmark[], state: ExerciseState, smoothedHipY: number, timeSinceRep: number, now: number): ExerciseState {
  // Calibrated drop range; guard against a bad calibration producing near-zero range.
  const calibDrop = Math.max(state._threshold - state._standingHipY, MIN_CALIB_DROP);

  // Enter "down" when hips have dropped 75% of the calibrated squat depth.
  const downThreshold = state._standingHipY + calibDrop * SQUAT_DOWN_FRACTION;
  // Count the rep when hips are back within 28% of calibrated drop above standing.
  const upThreshold = state._standingHipY + calibDrop * SQUAT_UP_FRACTION;

  const phase = state.phase;

  // ── COOLDOWN: a rep was just counted — ignore all movement ───────────────
  if (phase === 'cooldown') {
    if (timeSinceRep >= REP_COOLDOWN_MS) {
      state.phase = 'standing';
      state.feedback = 'Keep going!';
      state.formQuality = 'neutral';
    }
    // Stay in cooldown regardless of hip position — prevents double counting.
    return state;
  }

  // ── STANDING: waiting for user to squat down ─────────────────────────────
  if (phase === 'standing' || phase === 'descending' || phase === 'ascending') {
    if (smoothedHipY >= downThreshold) {
      // Hips low enough — entered the squat
      state.phase = 'at_bottom';
      state._reachedDepth = true;
      state.feedback = 'Good depth! Come back up!';
      state.formQuality = 'good';
    } else {
      state.phase = 'standing';
      state.feedback = 'Squat!';
      state.formQuality = 'neutral';
    }
    return state;
  }

  // ── AT_BOTTOM ("down"): waiting for user to stand back up ────────────────
  if (phase === 'at_bottom') {
    if (smoothedHipY <= upThreshold) {
      // Hips back near baseline — count the rep
      state.repCount += 1;
      state._lastRepTime = now;
      state._reachedDepth = false;
      state.phase = 'cooldown';
      state.feedback = `Rep ${state.repCount}!`;
      state.formQuality = 'good';
    } else {
      state.feedback = 'Stand back up!';
      state.formQuality = 'good';
    }
    return state;
  }

  // Fallback — should not normally be reached
  state.phase = 'standing';
  return state;
}

// ─── Jumping Jack Detection ──────────────────────────────────────────────────

function detectJumpingJackPhase(_landmarks: Landmark[], state: ExerciseState, timeSinceRep: number, now: number): ExerciseState {
  const armSpread = getArmSpread(_landmarks);
  const legSpread = getLegSpread(_landmarks);
  const anklesVisible = !!(
    _landmarks[POSE.LEFT_ANKLE] && _landmarks[POSE.RIGHT_ANKLE] &&
    (_landmarks[POSE.LEFT_ANKLE].visibility ?? 0) > 0.2 &&
    (_landmarks[POSE.RIGHT_ANKLE].visibility ?? 0) > 0.2
  );

  // Arms-only mode when ankles aren't visible (common on phones)
  // Require BOTH arms raised for open, at least one arm down for closed
  const isOpen = anklesVisible
    ? (armSpread >= 2 && legSpread > 1.05)
    : (armSpread >= 2);
  const isClosed = anklesVisible
    ? (armSpread <= 1 && legSpread < 1.3)
    : (armSpread <= 1);

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
