import { type Landmark, POSE, calculateAngle } from './pose-detection';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExerciseType = 'squats';

export type ExercisePhase =
  | 'waiting' | 'calibrating' | 'calibrating_squat'
  | 'standing' | 'descending' | 'at_bottom' | 'ascending' | 'cooldown';

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

  // Adaptive difficulty & form tracking
  _inPartialDescent: boolean;
  _partialAttempts: number;
  _peakHipY: number;
  _adaptiveHistory: number[];

}

// ─── Constants ───────────────────────────────────────────────────────────────

const BODY_DETECT_FRAMES = 8;
const CALIBRATION_TIMEOUT_MS = 6000;
const SMOOTHING_ALPHA = 0.25;
const REP_COOLDOWN_MS = 500;
const MAX_OCCLUSION_FRAMES = 20;
const SQUAT_DEFAULT_DROP_RATIO = 0.22;
const SQUAT_MIN_DROP_RATIO = 0.2;
const SQUAT_MAX_DROP_RATIO = 0.25;
// How far down (as fraction of calibrated drop) triggers "at bottom"
const SQUAT_DOWN_FRACTION = 0.55;   // 55% of calibrated depth → "down" (was 65%, too strict)
// How far back up (as fraction of calibrated drop) triggers rep count
const SQUAT_UP_FRACTION = 0.30;
const MIN_CALIB_DROP = 0.05;
// Knee angle used only for FEEDBACK, not gating — avoids false rejections when
// ankles are off-screen (getKneeAngle() returns 180° = straight as a safe fallback,
// which would permanently block reps if used as a hard gate condition)
const SQUAT_KNEE_ANGLE_HINT = 130;  // > 130° → suggest bending knees more

const ADAPTIVE_STEP = 0.005;
const PARTIAL_DESCENT_FRACTION = 0.30;  // 30% of calibDrop = user started descending
const PERFECT_REP_DEPTH_RATIO = 1.3;   // depthRatio ≥ 1.3 = "PERFECT REP"

// Damage per exercise
export const DAMAGE_MAP: Record<ExerciseType, number> = {
  squats: 8,
};

export const EXERCISE_LABELS: Record<ExerciseType, string> = {
  squats: 'Squats',
};

export const CALORIES_PER_REP: Record<ExerciseType, number> = {
  squats: 0.32,
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
    _inPartialDescent: false,
    _partialAttempts: 0,
    _peakHipY: 0,
    _adaptiveHistory: [],
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

  // 0.35: low enough to work in variable mobile lighting, high enough to
  // reject clothing / partial occlusions that MediaPipe tracks with low confidence
  if (!required.every(idx => landmarks[idx] && (landmarks[idx].visibility ?? 0) > 0.35)) {
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

function hasKneesVisible(landmarks: Landmark[]): boolean {
  return !!(
    landmarks[POSE.LEFT_KNEE] && landmarks[POSE.RIGHT_KNEE] &&
    (landmarks[POSE.LEFT_KNEE].visibility ?? 0) > 0.3 &&
    (landmarks[POSE.RIGHT_KNEE].visibility ?? 0) > 0.3
  );
}

// Returns a framing guidance message if the body isn't well-framed, or null if OK.
function getFramingGuidance(landmarks: Landmark[]): string | null {
  const vis = (idx: number): number => landmarks[idx]?.visibility ?? 0;

  const shouldersVis = vis(POSE.LEFT_SHOULDER) > 0.3 || vis(POSE.RIGHT_SHOULDER) > 0.3;
  const hipsVis = vis(POSE.LEFT_HIP) > 0.3 || vis(POSE.RIGHT_HIP) > 0.3;
  const kneesVis = vis(POSE.LEFT_KNEE) > 0.3 || vis(POSE.RIGHT_KNEE) > 0.3;
  const anklesVis = vis(POSE.LEFT_ANKLE) > 0.2 || vis(POSE.RIGHT_ANKLE) > 0.2;

  if (!shouldersVis) return 'Step back — too close!';
  if (!hipsVis) return 'Show your full body';
  if (!kneesVis) return 'Step back to show knees';
  if (!anklesVis) return 'Step back a little more';

  return null;
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

    state.phase = 'standing';
    state.feedback = 'GO! Squat!';
    return state;
  }

  // ═══ GAMEPLAY ═══
  const timeSinceRep = now - prevState._lastRepTime;
  return detectSquatPhase(landmarks, state, smoothedHipY, timeSinceRep, now);
}

/**
 * Average knee angle (hip→knee→ankle) across whichever legs are visible.
 * Returns 180 (straight) when no ankle landmarks are available.
 * Works for both portrait and landscape camera frames since calculateAngle
 * operates in 2-D Euclidean space and is orientation-invariant.
 */
function getKneeAngle(landmarks: Landmark[]): number {
  const angles: number[] = [];

  const lH = landmarks[POSE.LEFT_HIP];
  const lK = landmarks[POSE.LEFT_KNEE];
  const lA = landmarks[POSE.LEFT_ANKLE];
  if (lH && lK && lA &&
      (lK.visibility ?? 0) > 0.3 && (lA.visibility ?? 0) > 0.2) {
    angles.push(calculateAngle(lH, lK, lA));
  }

  const rH = landmarks[POSE.RIGHT_HIP];
  const rK = landmarks[POSE.RIGHT_KNEE];
  const rA = landmarks[POSE.RIGHT_ANKLE];
  if (rH && rK && rA &&
      (rK.visibility ?? 0) > 0.3 && (rA.visibility ?? 0) > 0.2) {
    angles.push(calculateAngle(rH, rK, rA));
  }

  if (angles.length === 0) return 180; // unknown → assume straight (conservative)
  return angles.reduce((sum, a) => sum + a, 0) / angles.length;
}

// ─── Squat Detection ─────────────────────────────────────────────────────────
//
//  standing ──(hips drop below downThreshold)──▶ at_bottom
//  at_bottom ──(hips return above upThreshold)──▶ cooldown  (+1 rep)
//  cooldown  ──(REP_COOLDOWN_MS elapsed)──▶ standing
//
//  Gate condition: hip drop ONLY (single condition).
//  Knee angle is computed for form feedback but does NOT block rep counting —
//  when ankles are off-screen, getKneeAngle() returns 180° (straight),
//  which would permanently reject squats if used as a hard gate.

function detectSquatPhase(landmarks: Landmark[], state: ExerciseState, smoothedHipY: number, timeSinceRep: number, now: number): ExerciseState {
  const calibDrop = Math.max(state._threshold - state._standingHipY, MIN_CALIB_DROP);

  const downThreshold = state._standingHipY + calibDrop * SQUAT_DOWN_FRACTION;
  const upThreshold   = state._standingHipY + calibDrop * SQUAT_UP_FRACTION;

  const bodyH   = getBodyHeight(landmarks);
  const hipDrop = smoothedHipY - state._standingHipY;

  // Single gate: did hips drop below the threshold?
  const hipsLow = smoothedHipY >= downThreshold;

  const phase = state.phase;

  // ── COOLDOWN ──────────────────────────────────────────────────────────────
  if (phase === 'cooldown') {
    if (timeSinceRep >= REP_COOLDOWN_MS) {
      state.phase = 'standing';
      state.feedback = 'Keep going!';
      state.formQuality = 'neutral';
    }
    return state;
  }

  // ── STANDING ─────────────────────────────────────────────────────────────
  if (phase === 'standing' || phase === 'descending' || phase === 'ascending') {
    const dropFraction = calibDrop > 0 ? hipDrop / calibDrop : 0;

    // Track peak depth during descent
    if (hipDrop > 0) {
      state._peakHipY = Math.max(state._peakHipY, smoothedHipY);
    }

    // Partial-descent tracking for accuracy metric
    if (dropFraction >= PARTIAL_DESCENT_FRACTION) {
      state._inPartialDescent = true;
    } else if (state._inPartialDescent && dropFraction < 0.15) {
      state._partialAttempts += 1;
      state._inPartialDescent = false;
      state._peakHipY = 0;
    }

    if (hipsLow) {
      state.phase = 'at_bottom';
      state._reachedDepth = true;
      state._inPartialDescent = false;
      state.feedback = 'Good! Come back up!';
      state.formQuality = 'good';
    } else if (dropFraction >= PARTIAL_DESCENT_FRACTION) {
      // Descending but not yet at depth — give form hint
      const kneeAngle = getKneeAngle(landmarks);
      state.phase = 'standing';
      state.feedback = kneeAngle > SQUAT_KNEE_ANGLE_HINT ? 'Bend knees more! ⬇️' : 'GO LOWER ⬇️';
      state.formQuality = 'needs_work';
    } else {
      state.phase = 'standing';
      state.feedback = 'Squat!';
      state.formQuality = 'neutral';
    }
    return state;
  }

  // ── AT_BOTTOM ─────────────────────────────────────────────────────────────
  if (phase === 'at_bottom') {
    state._peakHipY = Math.max(state._peakHipY, smoothedHipY);

    if (smoothedHipY <= upThreshold) {
      const depthRatio = calibDrop > 0
        ? (state._peakHipY - state._standingHipY) / calibDrop
        : 1.0;

      // Adaptive difficulty: adjust threshold based on rolling depth average
      const adaptHistory = [...state._adaptiveHistory, depthRatio].slice(-5);
      state._adaptiveHistory = adaptHistory;
      if (adaptHistory.length >= 3) {
        const avg = adaptHistory.reduce((s, v) => s + v, 0) / adaptHistory.length;
        if (avg > 1.3) {
          state._squatDropRatio = Math.min(SQUAT_MAX_DROP_RATIO, state._squatDropRatio + ADAPTIVE_STEP);
          state._threshold = state._standingHipY + bodyH * state._squatDropRatio;
        } else if (avg < 1.05) {
          state._squatDropRatio = Math.max(SQUAT_MIN_DROP_RATIO, state._squatDropRatio - ADAPTIVE_STEP);
          state._threshold = state._standingHipY + bodyH * state._squatDropRatio;
        }
      }

      state.repCount += 1;
      state._lastRepTime = now;
      state._reachedDepth = false;
      state._inPartialDescent = false;
      state._peakHipY = 0;
      state.phase = 'cooldown';
      state.feedback = depthRatio >= PERFECT_REP_DEPTH_RATIO ? 'PERFECT REP 🔥' : `Rep ${state.repCount}!`;
      state.formQuality = 'good';
    } else {
      state.feedback = 'Stand back up!';
      state.formQuality = 'good';
    }
    return state;
  }

  state.phase = 'standing';
  return state;
}

