import { type Landmark, POSE, calculateAngle } from './pose-detection';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExerciseType = 'squats';

export type ExercisePhase =
  | 'waiting' | 'calibrating'
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

  // Smoothing
  _bodyDetectFrames: number;
  _occludedFrames: number;
  _lastRepTime: number;
  _hipYHistory: number[];
  _kneeYHistory: number[];

  // Adaptive per-user calibration — collected from standing baseline frames
  _calibFrames: Array<{ hipY: number; kneeY: number }>;
  _standingHipY: number;       // average hip position while standing (0=head, 1=feet)
  _baselineKneeY: number;      // average knee position while standing
  _baselineHipToKnee: number;  // baselineKneeY − standingHipY: user's anatomical gap
  _squatDownRatio: number;     // adaptive: hipDrop > hipToKnee × ratio → "at bottom"
  _baselineShoulderMid: number; // shoulder mid (horizontal) at calibration time (−1 = unset)

  // Rep state
  _bottomConfirmFrames: number; // consecutive frames at depth
  _upConfirmFrames: number;     // consecutive frames back near standing
  _peakHipY: number;            // deepest hip position during current squat

  // Accuracy
  _inPartialDescent: boolean;
  _partialAttempts: number;     // partial squats (started but not completed)
  _adaptiveHistory: number[];   // rolling rep-depth fractions for adaptive ratio
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BODY_DETECT_FRAMES = 10;
const CALIB_BASELINE_FRAMES = 20;      // frames averaged for standing baseline
const BOTTOM_CONFIRM_FRAMES = 2;       // consecutive frames at depth before entering at_bottom
const UP_CONFIRM_FRAMES = 2;           // consecutive frames near standing before counting rep
const LATERAL_DRIFT_THRESHOLD = 0.15; // horizontal shoulder drift that flags sideways movement
const FULL_BODY_VISIBILITY = 0.5;      // min MediaPipe visibility for shoulders/hips/knees
const SMOOTHING_ALPHA = 0.30;          // EMA factor: 0.7×prev + 0.3×new — smooth but responsive
const REP_COOLDOWN_MS = 500;           // min ms between reps
const MAX_OCCLUSION_FRAMES = 20;
const MIN_HIP_TO_KNEE = 0.06;         // sanity guard: rejects tiny/invalid calibration

// ── Adaptive squat ratios (expressed as fractions of _baselineHipToKnee) ────
//
//   _baselineHipToKnee ≈ 0.15–0.25 in normalised frame coordinates.
//   hipDrop > hipToKnee × 0.30  →  user is "at bottom" (primary gate)
//   kneeShift > hipToKnee × 0.08  →  soft knee check (easily met)
//   hipDrop > hipToKnee × 0.35  →  override: pass even if knee check fails
//   hipDrop < hipToKnee × 0.08  →  user is "standing" (rep counted on return)
//
const SQUAT_DOWN_RATIO = 0.30;        // primary gate: hip dropped ≥ 30 % of hipToKnee
const SQUAT_KNEE_SHIFT_RATIO = 0.08;  // soft secondary gate: knee shifted ≥ 8 % of hipToKnee
const SQUAT_HIP_OVERRIDE_RATIO = 0.35; // override: bypass knee check when hip drop is unambiguous
const SQUAT_UP_RATIO = 0.08;          // "returned to standing": drop < 8 % of hipToKnee

const SQUAT_DOWN_RATIO_MIN = 0.22;    // adaptive lower bound (easier)
const SQUAT_DOWN_RATIO_MAX = 0.45;    // adaptive upper bound (harder)
const ADAPTIVE_STEP = 0.02;           // ratio change per rep-depth check

const PARTIAL_DESCENT_FRACTION = 0.30; // fraction of down-threshold → partial descent started
const PERFECT_REP_DEPTH_RATIO = 1.3;  // depth/threshold ≥ 1.3 → "PERFECT REP"
const SQUAT_KNEE_ANGLE_HINT = 130;    // knee angle (°) below which we show "bend knees" tip

// ─── Per-exercise game data ───────────────────────────────────────────────────

export const DAMAGE_MAP: Record<ExerciseType, number> = { squats: 8 };
export const EXERCISE_LABELS: Record<ExerciseType, string> = { squats: 'Squats' };
export const CALORIES_PER_REP: Record<ExerciseType, number> = { squats: 0.32 };

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
    _bodyDetectFrames: 0,
    _occludedFrames: 0,
    _lastRepTime: 0,
    _hipYHistory: [],
    _kneeYHistory: [],
    _calibFrames: [],
    _standingHipY: 0,
    _baselineKneeY: 0,
    _baselineHipToKnee: 0,
    _squatDownRatio: SQUAT_DOWN_RATIO,
    _baselineShoulderMid: -1,
    _bottomConfirmFrames: 0,
    _upConfirmFrames: 0,
    _peakHipY: 0,
    _inPartialDescent: false,
    _partialAttempts: 0,
    _adaptiveHistory: [],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Determines which axis is the "vertical" one (head→feet) by comparing the
// shoulder-to-knee spread in x vs y.  Returns 'x' for landscape video frames
// (common on iOS Safari), 'y' for portrait.
function getVerticalAxis(landmarks: Landmark[]): { axis: 'x' | 'y'; headIsAtLowValue: boolean } {
  const lS = landmarks[POSE.LEFT_SHOULDER];
  const lK = landmarks[POSE.LEFT_KNEE];
  if (!lS || !lK) return { axis: 'y', headIsAtLowValue: true };

  const xSpread = Math.abs(lS.x - lK.x);
  const ySpread = Math.abs(lS.y - lK.y);

  if (xSpread > ySpread) {
    return { axis: 'x', headIsAtLowValue: lS.x < lK.x };
  }
  return { axis: 'y', headIsAtLowValue: true };
}

// Hip midpoint on the vertical axis, normalised so 0 = head, 1 = feet.
// Squatting always INCREASES this value regardless of camera orientation.
function getMidHipVertical(landmarks: Landmark[]): number {
  const lH = landmarks[POSE.LEFT_HIP];
  const rH = landmarks[POSE.RIGHT_HIP];
  if (!lH || !rH) return -1;
  const { axis, headIsAtLowValue } = getVerticalAxis(landmarks);
  const raw = axis === 'x' ? (lH.x + rH.x) / 2 : (lH.y + rH.y) / 2;
  return headIsAtLowValue ? raw : 1 - raw;
}

// Knee midpoint on the same vertical axis (0 = head, 1 = feet).
function getMidKneeVertical(landmarks: Landmark[]): number {
  const lK = landmarks[POSE.LEFT_KNEE];
  const rK = landmarks[POSE.RIGHT_KNEE];
  if (!lK || !rK) return -1;
  const { axis, headIsAtLowValue } = getVerticalAxis(landmarks);
  const raw = axis === 'x' ? (lK.x + rK.x) / 2 : (lK.y + rK.y) / 2;
  return headIsAtLowValue ? raw : 1 - raw;
}

// Horizontal midpoint of shoulders (perpendicular to the vertical axis).
// Used to detect lateral drift.
function getShoulderMidHorizontal(landmarks: Landmark[]): number {
  const lS = landmarks[POSE.LEFT_SHOULDER];
  const rS = landmarks[POSE.RIGHT_SHOULDER];
  if (!lS || !rS) return 0.5;
  const { axis } = getVerticalAxis(landmarks);
  return axis === 'x' ? (lS.y + rS.y) / 2 : (lS.x + rS.x) / 2;
}

// Returns true when all required landmarks are visible and in anatomical order.
function hasFullBody(landmarks: Landmark[]): boolean {
  const required = [
    POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER,
    POSE.LEFT_HIP,      POSE.RIGHT_HIP,
    POSE.LEFT_KNEE,     POSE.RIGHT_KNEE,
  ];
  if (!required.every(i => (landmarks[i]?.visibility ?? 0) >= FULL_BODY_VISIBILITY)) return false;

  const lS = landmarks[POSE.LEFT_SHOULDER];
  const rS = landmarks[POSE.RIGHT_SHOULDER];
  const lH = landmarks[POSE.LEFT_HIP];
  const lK = landmarks[POSE.LEFT_KNEE];

  const { axis, headIsAtLowValue } = getVerticalAxis(landmarks);
  const vert = (lm: { x: number; y: number }) => axis === 'x' ? lm.x : lm.y;
  const dir = headIsAtLowValue ? 1 : -1;

  // Anatomical ordering: shoulder above hip above knee
  if (dir * vert(lS) >= dir * vert(lH)) return false;
  if (dir * vert(lH) >= dir * vert(lK)) return false;

  // Shoulders must be separated (rules out a single object being tracked)
  const horiz = (lm: { x: number; y: number }) => axis === 'x' ? lm.y : lm.x;
  if (Math.abs(horiz(rS) - horiz(lS)) < 0.01) return false;

  return true;
}

// Returns a user-facing guidance message when body framing is incomplete.
function getFramingGuidance(landmarks: Landmark[]): string | null {
  const vis = (i: number) => landmarks[i]?.visibility ?? 0;
  if (!(vis(POSE.LEFT_SHOULDER) > 0.3 || vis(POSE.RIGHT_SHOULDER) > 0.3)) return 'Step back — too close!';
  if (!(vis(POSE.LEFT_HIP)      > 0.3 || vis(POSE.RIGHT_HIP)      > 0.3)) return 'Show your full body';
  if (!(vis(POSE.LEFT_KNEE)     > 0.3 || vis(POSE.RIGHT_KNEE)     > 0.3)) return 'Step back to show knees';
  if (!(vis(POSE.LEFT_ANKLE)    > 0.2 || vis(POSE.RIGHT_ANKLE)    > 0.2)) return 'Step back a little more';
  return null;
}

function hasKneesVisible(landmarks: Landmark[]): boolean {
  return (landmarks[POSE.LEFT_KNEE]?.visibility ?? 0) > 0.3 &&
         (landmarks[POSE.RIGHT_KNEE]?.visibility ?? 0) > 0.3;
}

// EMA smoother.  `history` holds a single element (the previous EMA value).
function smoothY(history: number[], val: number): { smoothed: number; history: number[] } {
  const prev = history.length > 0 ? history[0] : val;
  const smoothed = prev + SMOOTHING_ALPHA * (val - prev);
  return { smoothed, history: [smoothed] };
}

// Average knee angle (hip→knee→ankle) for form feedback only — not used as a gate.
function getKneeAngle(landmarks: Landmark[]): number {
  const angles: number[] = [];
  const check = (h: number, k: number, a: number) => {
    const lh = landmarks[h], lk = landmarks[k], la = landmarks[a];
    if (lh && lk && la && (lk.visibility ?? 0) > 0.3 && (la.visibility ?? 0) > 0.2) {
      angles.push(calculateAngle(lh, lk, la));
    }
  };
  check(POSE.LEFT_HIP,  POSE.LEFT_KNEE,  POSE.LEFT_ANKLE);
  check(POSE.RIGHT_HIP, POSE.RIGHT_KNEE, POSE.RIGHT_ANKLE);
  return angles.length > 0 ? angles.reduce((s, a) => s + a, 0) / angles.length : 180;
}

// ─── Main Detection ──────────────────────────────────────────────────────────

export function detectExercise(landmarks: Landmark[], prevState: ExerciseState): ExerciseState {
  const now = Date.now();
  const kneesVis = hasKneesVisible(landmarks);

  if (!hasFullBody(landmarks)) {
    const msg = getFramingGuidance(landmarks) ?? 'Move into frame';
    return {
      ...prevState,
      feedback: msg,
      formQuality: 'neutral',
      bodyDetected: false,
      kneesVisible: kneesVis,
      _occludedFrames: Math.min(prevState._occludedFrames + 1, MAX_OCCLUSION_FRAMES),
      _bodyDetectFrames: 0,
    };
  }

  const hipYRaw  = getMidHipVertical(landmarks);
  const kneeYRaw = getMidKneeVertical(landmarks);
  if (hipYRaw < 0) {
    return { ...prevState, feedback: 'No body detected', bodyDetected: false, kneesVisible: kneesVis };
  }

  const { smoothed: smoothedHipY,  history: newHipHistory  } = smoothY(prevState._hipYHistory,  hipYRaw);
  const { smoothed: smoothedKneeY, history: newKneeHistory } = kneeYRaw >= 0
    ? smoothY(prevState._kneeYHistory, kneeYRaw)
    : { smoothed: prevState._baselineKneeY, history: prevState._kneeYHistory };

  let state: ExerciseState = {
    ...prevState,
    _hipYHistory:  newHipHistory,
    _kneeYHistory: newKneeHistory,
    _occludedFrames: 0,
    bodyDetected: true,
    kneesVisible: kneesVis,
  };

  // ═══ WAITING ═══
  if (prevState.phase === 'waiting') {
    const framingIssue = getFramingGuidance(landmarks);
    if (framingIssue) {
      return { ...state, feedback: framingIssue, calibrationProgress: 0, _bodyDetectFrames: 0 };
    }
    const frames = prevState._bodyDetectFrames + 1;
    state._bodyDetectFrames = frames;
    if (frames >= BODY_DETECT_FRAMES) {
      state.phase = 'calibrating';
      state.feedback = 'Body detected! Stand still...';
      state.formQuality = 'good';
      state.calibrationProgress = 20;
    } else {
      state.feedback = 'Detecting body...';
      state.calibrationProgress = Math.round((frames / BODY_DETECT_FRAMES) * 20);
    }
    return state;
  }

  // ═══ CALIBRATING ═══
  //
  // Collect CALIB_BASELINE_FRAMES of standing {hipY, kneeY}.
  // Average them → standing baseline.
  // Compute _baselineHipToKnee = baselineKneeY − standingHipY.
  // This is the user's anatomical hip-to-knee gap — all squat thresholds
  // are expressed as fractions of this value, making detection body-size
  // and camera-distance independent.
  //
  // No calibration squat needed: standing proportions are enough.
  if (prevState.phase === 'calibrating') {
    const framingIssue = getFramingGuidance(landmarks);

    // Reset collection if body leaves the frame mid-calibration —
    // prevents contaminated averages from partial-occlusion frames.
    if (framingIssue || kneeYRaw < 0) {
      return {
        ...state,
        feedback: framingIssue ?? 'Show your knees',
        formQuality: 'neutral',
        _calibFrames: [],
      };
    }

    const frames = [...prevState._calibFrames, { hipY: smoothedHipY, kneeY: smoothedKneeY }];
    state._calibFrames = frames;

    if (frames.length >= CALIB_BASELINE_FRAMES) {
      const avgHip  = frames.reduce((s, f) => s + f.hipY,  0) / frames.length;
      const avgKnee = frames.reduce((s, f) => s + f.kneeY, 0) / frames.length;
      const hipToKnee = avgKnee - avgHip;

      if (hipToKnee < MIN_HIP_TO_KNEE) {
        // Calibration invalid — body not framed properly (e.g. person too far)
        return {
          ...state,
          feedback: 'Step closer to camera',
          formQuality: 'neutral',
          _calibFrames: [],
        };
      }

      state._standingHipY      = avgHip;
      state._baselineKneeY     = avgKnee;
      state._baselineHipToKnee = hipToKnee;
      state._baselineShoulderMid = getShoulderMidHorizontal(landmarks);
      state._squatDownRatio    = SQUAT_DOWN_RATIO;

      state.calibrated           = true;
      state.calibrationProgress  = 100;
      state.phase                = 'standing';
      state.feedback             = 'GO! Squat!';
      state.formQuality          = 'good';
    } else {
      state.calibrationProgress = Math.min(99, Math.round(20 + (frames.length / CALIB_BASELINE_FRAMES) * 80));
      state.feedback    = 'Stand straight... capturing your proportions';
      state.formQuality = 'neutral';
    }
    return state;
  }

  // ═══ GAMEPLAY ═══
  return detectSquatPhase(landmarks, state, smoothedHipY, smoothedKneeY, now);
}

// ─── Squat phase state machine ────────────────────────────────────────────────
//
//  standing ──(isSquatting, 2 frames)──▶ at_bottom
//  at_bottom ──(hipsUp, 2 frames)──▶ cooldown (+1 rep)
//  cooldown  ──(500 ms elapsed)──▶ standing
//
//  Primary gate:   hipDrop > hipToKnee × 0.30  (30 % of anatomical gap)
//  Soft secondary: kneeShift > hipToKnee × 0.08  OR  hipDrop > hipToKnee × 0.35
//                  — the override means a clear hip drop always counts even if
//                    knee tracking is noisy or partial
//  Up condition:   hipDrop < hipToKnee × 0.08  (within 8 % of standing)

function detectSquatPhase(
  landmarks: Landmark[],
  state: ExerciseState,
  smoothedHipY: number,
  smoothedKneeY: number,
  now: number,
): ExerciseState {
  const timeSinceRep = now - state._lastRepTime;
  const hipToKnee = state._baselineHipToKnee;

  const hipDrop   = smoothedHipY  - state._standingHipY;
  const kneeShift = smoothedKneeY - state._baselineKneeY;

  // Primary gate: hip dropped ≥ 30 % of the user's hip-to-knee gap
  const hipsLow = hipDrop >= hipToKnee * state._squatDownRatio;
  // Soft secondary: knee shifted ≥ 8 % of hipToKnee (very easy to satisfy)
  // Pass-through when knee data is unavailable (smoothedKneeY < 0).
  const kneesShifted = smoothedKneeY < 0 || kneeShift >= hipToKnee * SQUAT_KNEE_SHIFT_RATIO;
  // Override: a large hip drop (≥ 35 %) counts even if the knee check fails —
  // guards against noisy knee tracking blocking an obvious squat.
  const hipOverride = hipDrop >= hipToKnee * SQUAT_HIP_OVERRIDE_RATIO;
  // Up: hip returned to within 8 % of standing hip position
  const hipsUp = hipDrop < hipToKnee * SQUAT_UP_RATIO;

  // Lateral drift guard
  const shoulderMidH = getShoulderMidHorizontal(landmarks);
  const hasDrifted = state._baselineShoulderMid >= 0 &&
    Math.abs(shoulderMidH - state._baselineShoulderMid) > LATERAL_DRIFT_THRESHOLD;

  const isSquatting = hipsLow && (kneesShifted || hipOverride) && !hasDrifted;

  const phase = state.phase;

  // ── COOLDOWN ──────────────────────────────────────────────────────────────
  if (phase === 'cooldown') {
    if (timeSinceRep >= REP_COOLDOWN_MS) {
      state.phase         = 'standing';
      state._upConfirmFrames = 0;
      state.feedback      = 'Keep going!';
      state.formQuality   = 'neutral';
    }
    return state;
  }

  // ── STANDING / DESCENDING ─────────────────────────────────────────────────
  if (phase === 'standing' || phase === 'descending' || phase === 'ascending') {
    // Track peak (deepest) hip position this rep
    if (hipDrop > 0) state._peakHipY = Math.max(state._peakHipY, smoothedHipY);

    // Partial-descent accuracy tracking
    const partialThreshold = hipToKnee * state._squatDownRatio * PARTIAL_DESCENT_FRACTION;
    if (hipDrop >= partialThreshold) {
      state._inPartialDescent = true;
    } else if (state._inPartialDescent && hipDrop < partialThreshold * 0.5) {
      state._partialAttempts += 1;
      state._inPartialDescent = false;
      state._peakHipY = 0;
    }

    if (isSquatting) {
      // Require BOTTOM_CONFIRM_FRAMES consecutive frames at depth
      const confirmFrames = state._bottomConfirmFrames + 1;
      state._bottomConfirmFrames = confirmFrames;
      state._upConfirmFrames     = 0;
      if (confirmFrames >= BOTTOM_CONFIRM_FRAMES) {
        state.phase                = 'at_bottom';
        state._bottomConfirmFrames = 0;
        state._inPartialDescent    = false;
        state.feedback             = 'Good! Come back up!';
        state.formQuality          = 'good';
      } else {
        state.feedback    = 'Hold it! ⬇️';
        state.formQuality = 'good';
      }
    } else if (hipsLow && hasDrifted) {
      state._bottomConfirmFrames = 0;
      state._upConfirmFrames     = 0;
      state.feedback    = 'Stay centered!';
      state.formQuality = 'needs_work';
    } else {
      state._bottomConfirmFrames = 0;
      if (hipDrop >= partialThreshold) {
        // Descending but not yet at depth — give form hint
        const kneeAngle = getKneeAngle(landmarks);
        state.phase       = 'standing';
        state.feedback    = kneeAngle > SQUAT_KNEE_ANGLE_HINT ? 'Bend knees more! ⬇️' : 'GO LOWER ⬇️';
        state.formQuality = 'needs_work';
      } else {
        state.phase       = 'standing';
        state.feedback    = 'Squat!';
        state.formQuality = 'neutral';
      }
    }
    return state;
  }

  // ── AT_BOTTOM ─────────────────────────────────────────────────────────────
  if (phase === 'at_bottom') {
    state._peakHipY = Math.max(state._peakHipY, smoothedHipY);

    if (hipsUp) {
      // Require UP_CONFIRM_FRAMES consecutive frames back near standing height
      const upFrames = state._upConfirmFrames + 1;
      state._upConfirmFrames = upFrames;

      if (upFrames >= UP_CONFIRM_FRAMES) {
        state._upConfirmFrames = 0;

        // How deep did they go, relative to the down threshold?
        const depthRatio = hipToKnee > 0
          ? (state._peakHipY - state._standingHipY) / (hipToKnee * state._squatDownRatio)
          : 1.0;

        // Adaptive ratio: make threshold harder if user consistently goes deep,
        // easier if they're barely reaching it.
        const history = [...state._adaptiveHistory, depthRatio].slice(-5);
        state._adaptiveHistory = history;
        if (history.length >= 3) {
          const avg = history.reduce((s, v) => s + v, 0) / history.length;
          if (avg > 1.3) {
            state._squatDownRatio = Math.min(SQUAT_DOWN_RATIO_MAX, state._squatDownRatio + ADAPTIVE_STEP);
          } else if (avg < 1.05) {
            state._squatDownRatio = Math.max(SQUAT_DOWN_RATIO_MIN, state._squatDownRatio - ADAPTIVE_STEP);
          }
        }

        state.repCount         += 1;
        state._lastRepTime      = now;
        state._inPartialDescent = false;
        state._peakHipY         = 0;
        state.phase             = 'cooldown';
        state.feedback          = depthRatio >= PERFECT_REP_DEPTH_RATIO ? 'PERFECT REP 🔥' : `Rep ${state.repCount}!`;
        state.formQuality       = 'good';
      } else {
        state.feedback    = 'Stand back up!';
        state.formQuality = 'good';
      }
    } else {
      state._upConfirmFrames = 0;
      state.feedback    = 'Stand back up!';
      state.formQuality = 'good';
    }
    return state;
  }

  state.phase = 'standing';
  return state;
}
