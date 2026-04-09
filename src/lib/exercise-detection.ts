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

const BODY_DETECT_FRAMES = 8;           // more frames required before calibration starts
const CALIBRATION_TIMEOUT_MS = 6000;
const SMOOTHING_ALPHA = 0.25;  // lower = smoother, filters clothing jitter
const REP_COOLDOWN_MS = 600;
const MAX_OCCLUSION_FRAMES = 20;
const SQUAT_DEFAULT_DROP_RATIO = 0.22;
const SQUAT_MIN_DROP_RATIO = 0.2;
const SQUAT_MAX_DROP_RATIO = 0.25;
// Fraction of calibrated drop range that defines "deep enough" and "back to standing"
const SQUAT_DOWN_FRACTION = 0.65;   // hips at 65% of calibrated depth → "down"
const SQUAT_UP_FRACTION = 0.30;     // hips within 30% of standing → "back up"
const MIN_CALIB_DROP = 0.05;        // minimum meaningful calibrated drop (safety guard)
// Dual-condition squat guards (prevent false positives from lateral movement)
const SQUAT_KNEE_ANGLE_DOWN = 110;       // knee angle must be ≤ this to count as "at bottom"
const SQUAT_MIN_ABSOLUTE_DROP = 0.18;    // hip must drop ≥ 18% of body height (absolute guard)

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

// ─── Jumping Jack helpers ────────────────────────────────────────────────────

// ─── Jumping Jack constants ───────────────────────────────────────────────────

/** Ankle spread / shoulder width ratio that defines the OPEN position. */
const JJ_OPEN_LEG_RATIO   = 1.4;  // ankles ≥ 1.4× shoulder width → legs open
/** Ankle spread / shoulder width ratio that defines the CLOSED position.
 *  The gap between CLOSED (0.9) and OPEN (1.4) gives hysteresis so a single
 *  noisy frame cannot flip the state. */
const JJ_CLOSED_LEG_RATIO = 0.9;  // ankles ≤ 0.9× shoulder width → legs closed

// ─── Jumping Jack helpers ─────────────────────────────────────────────────────

/**
 * Ankle spread normalised to shoulder width using the orientation-aware
 * HORIZONTAL axis (perpendicular to vertical), so it works for both portrait
 * and landscape camera frames.
 *
 * Returns -1 when ankle landmarks are not reliably visible.
 */
function getLegSpreadRatio(landmarks: Landmark[]): number {
  const lAnkle   = landmarks[POSE.LEFT_ANKLE];
  const rAnkle   = landmarks[POSE.RIGHT_ANKLE];
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];

  if (
    !lAnkle || !rAnkle || !lShoulder || !rShoulder ||
    (lAnkle.visibility ?? 0) < 0.25 ||
    (rAnkle.visibility ?? 0) < 0.25
  ) return -1;

  // Horizontal axis = perpendicular to the vertical axis
  const { axis } = getVerticalAxis(landmarks);
  const hc = (lm: { x: number; y: number }) => axis === 'x' ? lm.y : lm.x;

  const shoulderWidth = Math.abs(hc(lShoulder) - hc(rShoulder));
  if (shoulderWidth < 0.01) return -1; // degenerate

  return Math.abs(hc(lAnkle) - hc(rAnkle)) / shoulderWidth;
}

/**
 * True when BOTH wrists are above their respective shoulders.
 * Uses wrists only (not elbows) to require a clearly raised position.
 */
function areBothArmsRaised(landmarks: Landmark[]): boolean {
  const lWrist   = landmarks[POSE.LEFT_WRIST];
  const rWrist   = landmarks[POSE.RIGHT_WRIST];
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  if (!lWrist || !rWrist || !lShoulder || !rShoulder) return false;
  if ((lWrist.visibility ?? 0) < 0.3 || (rWrist.visibility ?? 0) < 0.3) return false;

  const { axis, headIsAtLowValue } = getVerticalAxis(landmarks);
  const vc = (lm: { x: number; y: number }) => axis === 'x' ? lm.x : lm.y;
  const aboveShoulder = (w: typeof lWrist, s: typeof lShoulder) =>
    headIsAtLowValue ? vc(w) < vc(s) : vc(w) > vc(s);

  return aboveShoulder(lWrist, lShoulder) && aboveShoulder(rWrist, rShoulder);
}

/**
 * True when BOTH wrists are below their respective shoulders.
 */
function areBothArmsLowered(landmarks: Landmark[]): boolean {
  const lWrist   = landmarks[POSE.LEFT_WRIST];
  const rWrist   = landmarks[POSE.RIGHT_WRIST];
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  if (!lWrist || !rWrist || !lShoulder || !rShoulder) return false;
  if ((lWrist.visibility ?? 0) < 0.3 || (rWrist.visibility ?? 0) < 0.3) return false;

  const { axis, headIsAtLowValue } = getVerticalAxis(landmarks);
  const vc = (lm: { x: number; y: number }) => axis === 'x' ? lm.x : lm.y;
  const belowShoulder = (w: typeof lWrist, s: typeof lShoulder) =>
    headIsAtLowValue ? vc(w) > vc(s) : vc(w) < vc(s);

  return belowShoulder(lWrist, lShoulder) && belowShoulder(rWrist, rShoulder);
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
  // Use the orientation-aware vertical coordinate (knee that is lower down = lunge leg)
  const { axis, headIsAtLowValue } = getVerticalAxis(landmarks);
  const vc = (lm: { x: number; y: number }) => axis === 'x' ? lm.x : lm.y;
  // Lower down = larger value when headIsAtLowValue, smaller when !headIsAtLowValue
  return headIsAtLowValue
    ? (vc(lKnee) > vc(rKnee) ? 'left' : 'right')
    : (vc(lKnee) < vc(rKnee) ? 'left' : 'right');
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
//  standing ──(hips drop AND knees bend)──▶ at_bottom
//  at_bottom ──(hips return to upThreshold)──▶ cooldown  (+1 rep)
//  cooldown ──(REP_COOLDOWN_MS elapsed)──▶ standing
//
// DUAL CONDITION to enter at_bottom prevents false positives:
//   1. Hip drops ≥ SQUAT_DOWN_FRACTION of calibrated range
//      AND ≥ SQUAT_MIN_ABSOLUTE_DROP fraction of body height
//   2. Knee angle ≤ SQUAT_KNEE_ANGLE_DOWN  (knees are actually bent)
// Lateral shuffles / swaying set off the hip sensor but leave the knees
// straight, so they are cleanly rejected by condition 2.

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

function detectSquatPhase(landmarks: Landmark[], state: ExerciseState, smoothedHipY: number, timeSinceRep: number, now: number): ExerciseState {
  // Calibrated drop range; guard against a bad calibration producing near-zero range.
  const calibDrop = Math.max(state._threshold - state._standingHipY, MIN_CALIB_DROP);

  const downThreshold = state._standingHipY + calibDrop * SQUAT_DOWN_FRACTION;
  const upThreshold   = state._standingHipY + calibDrop * SQUAT_UP_FRACTION;

  // Dual squat conditions evaluated once per frame.
  const bodyH       = getBodyHeight(landmarks);
  const kneeAngle   = getKneeAngle(landmarks);
  const hipDrop     = smoothedHipY - state._standingHipY;

  // Condition 1 – hips have descended far enough (calibrated threshold + absolute guard)
  const hipsLow   = smoothedHipY >= downThreshold &&
                    hipDrop >= bodyH * SQUAT_MIN_ABSOLUTE_DROP;
  // Condition 2 – knees are actually bent (rejects lateral sways / steps)
  const kneesBent = kneeAngle <= SQUAT_KNEE_ANGLE_DOWN;

  const phase = state.phase;

  // ── COOLDOWN: a rep was just counted — ignore all movement ───────────────
  if (phase === 'cooldown') {
    if (timeSinceRep >= REP_COOLDOWN_MS) {
      state.phase = 'standing';
      state.feedback = 'Keep going!';
      state.formQuality = 'neutral';
    }
    return state;
  }

  // ── STANDING: waiting for user to squat down ─────────────────────────────
  if (phase === 'standing' || phase === 'descending' || phase === 'ascending') {
    if (hipsLow && kneesBent) {
      // Both conditions met — valid squat depth reached
      state.phase = 'at_bottom';
      state._reachedDepth = true;
      state.feedback = 'Good depth! Come back up!';
      state.formQuality = 'good';
    } else if (hipsLow && !kneesBent) {
      // Hips dropped but knees still mostly straight → lateral movement / lean
      state.phase = 'standing';
      state.feedback = 'Bend your knees!';
      state.formQuality = 'needs_work';
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

  // Fallback
  state.phase = 'standing';
  return state;
}

// ─── Jumping Jack Detection ──────────────────────────────────────────────────
//
//  closed ──(arms up AND legs spread)──▶ open
//  open   ──(arms down AND legs together)──▶ closed  (+1 rep)
//
//  OPEN  requires: both wrists above shoulders
//                  AND ankles ≥ JJ_OPEN_LEG_RATIO × shoulder width
//  CLOSED requires: both wrists below shoulders
//                   AND ankles ≤ JJ_CLOSED_LEG_RATIO × shoulder width
//
//  When ankles are not visible (phone too close), leg check is skipped so
//  the arms-only signal still works — but the state machine still demands a
//  full open → closed cycle, preventing single-arm raises from counting.
//
//  The hysteresis gap between JJ_CLOSED_LEG_RATIO (0.9) and JJ_OPEN_LEG_RATIO
//  (1.4) prevents mid-range ankle positions from flickering the state.

function detectJumpingJackPhase(landmarks: Landmark[], state: ExerciseState, timeSinceRep: number, now: number): ExerciseState {
  const armsUp     = areBothArmsRaised(landmarks);
  const armsDown   = areBothArmsLowered(landmarks);
  const legRatio   = getLegSpreadRatio(landmarks);   // -1 = not visible
  const legsKnown  = legRatio >= 0;

  // Full-body open: arms up AND legs spread enough
  // Arms-only fallback when ankles are off-frame: just check arms
  const isOpen   = armsUp   && (!legsKnown || legRatio >= JJ_OPEN_LEG_RATIO);
  // Full-body closed: arms down AND feet together
  const isClosed = armsDown && (!legsKnown || legRatio <= JJ_CLOSED_LEG_RATIO);

  if (state.phase === 'closed') {
    state.feedback = 'Raise arms and jump out!';
    state.formQuality = 'neutral';
    if (isOpen) {
      state.phase = 'open';
      state.feedback = 'Arms up! Now close!';
      state.formQuality = 'good';
    }
    return state;
  }

  if (state.phase === 'open') {
    state.feedback = 'Arms down, feet together!';
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
