import { type Landmark, POSE, calculateAngle } from './pose-detection';

export type SquatPhase = 'standing' | 'going_down' | 'at_bottom' | 'going_up';

export interface FormError {
  type: 'depth' | 'knees_inward' | 'forward_lean' | 'back_straight';
  message: string;
}

export interface SquatState {
  phase: SquatPhase;
  repCount: number;
  feedback: string;
  formQuality: 'good' | 'needs_work' | 'neutral';
  /** Real-time knee angle for debug/display */
  kneeAngle: number;
  /** Form accuracy 0-100% */
  formScore: number;
  /** Errors detected on current/last rep */
  errors: FormError[];
  /** Cumulative form scores for average */
  _totalFormScore: number;
  _repFormScores: number;
  _lastRepTime: number;
  _reachedDepth: boolean;
  _currentRepErrors: FormError[];
  _minKneeAngle: number;
}

export function createInitialSquatState(): SquatState {
  return {
    phase: 'standing',
    repCount: 0,
    feedback: 'Get ready! Stand where your full body is visible.',
    formQuality: 'neutral',
    kneeAngle: 180,
    formScore: 100,
    errors: [],
    _totalFormScore: 0,
    _repFormScores: 0,
    _lastRepTime: 0,
    _reachedDepth: false,
    _currentRepErrors: [],
    _minKneeAngle: 180,
  };
}

// --- Configurable thresholds ---
const STANDING_ANGLE = 160;       // Must reach to count as standing
const SQUAT_DEPTH_ANGLE = 100;    // Below this = valid squat depth
const DEEP_SQUAT_ANGLE = 70;      // Excellent depth
const GOING_DOWN_ANGLE = 140;     // Start descending below this
const GOING_UP_EXIT = 120;        // Hysteresis for exiting bottom

const MAX_FORWARD_LEAN_DEG = 30;  // Max torso forward lean
const MIN_REP_INTERVAL_MS = 600;

let lastLogTime = 0;

/**
 * Calculate torso forward lean angle (0 = upright, 90 = horizontal)
 */
function getTorsoLean(landmarks: Landmark[]): number {
  const lShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE.RIGHT_SHOULDER];
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];

  if (!lShoulder || !rShoulder || !lHip || !rHip) return 0;

  const midShoulderX = (lShoulder.x + rShoulder.x) / 2;
  const midShoulderY = (lShoulder.y + rShoulder.y) / 2;
  const midHipX = (lHip.x + rHip.x) / 2;
  const midHipY = (lHip.y + rHip.y) / 2;

  // Angle from vertical: atan2(dx, dy) where dy is positive downward in screen coords
  const dx = midShoulderX - midHipX;
  const dy = midHipY - midShoulderY; // positive = shoulders above hips
  const angleFromVertical = Math.abs(Math.atan2(dx, dy) * (180 / Math.PI));
  return angleFromVertical;
}

/**
 * Check if knees collapse inward relative to hips and ankles
 */
function getKneeCollapse(landmarks: Landmark[]): { collapsed: boolean; severity: number } {
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];
  const lAnkle = landmarks[POSE.LEFT_ANKLE];
  const rAnkle = landmarks[POSE.RIGHT_ANKLE];

  if (!lHip || !rHip || !lKnee || !rKnee || !lAnkle || !rAnkle) {
    return { collapsed: false, severity: 0 };
  }

  // Compare knee-to-knee distance vs ankle-to-ankle distance
  const kneeWidth = Math.abs(lKnee.x - rKnee.x);
  const ankleWidth = Math.abs(lAnkle.x - rAnkle.x);
  const hipWidth = Math.abs(lHip.x - rHip.x);

  // If knees are significantly narrower than ankles or hips, they're collapsing
  if (ankleWidth > 0.01) {
    const ratio = kneeWidth / ankleWidth;
    if (ratio < 0.7) {
      return { collapsed: true, severity: Math.min(1, (0.7 - ratio) / 0.3) };
    }
  }

  return { collapsed: false, severity: 0 };
}

/**
 * Check if hips drop to at least knee level
 */
function hipsBelowKnees(landmarks: Landmark[]): boolean {
  const lHip = landmarks[POSE.LEFT_HIP];
  const rHip = landmarks[POSE.RIGHT_HIP];
  const lKnee = landmarks[POSE.LEFT_KNEE];
  const rKnee = landmarks[POSE.RIGHT_KNEE];

  if (!lHip || !rHip || !lKnee || !rKnee) return false;

  const midHipY = (lHip.y + rHip.y) / 2;
  const midKneeY = (lKnee.y + rKnee.y) / 2;

  // In screen coords, larger y = lower. Hips at or below knees.
  return midHipY >= midKneeY - 0.02; // small tolerance
}

/**
 * Calculate weighted bilateral knee angle
 */
function getKneeAngle(landmarks: Landmark[]): number {
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

/**
 * Score form for a completed rep (0-100)
 */
function scoreRep(minAngle: number, torsoLean: number, kneeCollapse: boolean, reachedDepth: boolean): number {
  let score = 100;

  // Depth scoring: best if <90, OK if <100, poor if >100
  if (!reachedDepth) {
    score -= 30;
  } else if (minAngle > 90) {
    score -= 15;
  } else if (minAngle <= 70) {
    score += 0; // bonus for great depth (cap at 100)
  }

  // Torso lean penalty
  if (torsoLean > MAX_FORWARD_LEAN_DEG) {
    score -= Math.min(25, (torsoLean - MAX_FORWARD_LEAN_DEG) * 2);
  }

  // Knee collapse penalty
  if (kneeCollapse) {
    score -= 20;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function detectSquat(
  landmarks: Landmark[],
  prevState: SquatState
): SquatState {
  const keyParts = [
    landmarks[POSE.LEFT_HIP], landmarks[POSE.RIGHT_HIP],
    landmarks[POSE.LEFT_KNEE], landmarks[POSE.RIGHT_KNEE],
    landmarks[POSE.LEFT_ANKLE], landmarks[POSE.RIGHT_ANKLE],
  ];

  if (!keyParts.every(p => p != null)) {
    return { ...prevState, feedback: '📷 Move back so camera sees your full body', formQuality: 'neutral' };
  }

  const kneeAngle = getKneeAngle(landmarks);
  const torsoLean = getTorsoLean(landmarks);
  const kneeCollapseResult = getKneeCollapse(landmarks);
  const hipsLow = hipsBelowKnees(landmarks);
  const now = Date.now();

  // Debug logging (throttled)
  if (now - lastLogTime > 500) {
    console.log(`[FitMon] Knee: ${kneeAngle.toFixed(1)}° | Torso: ${torsoLean.toFixed(1)}° | Phase: ${prevState.phase} | Reps: ${prevState.repCount} | Depth: ${prevState._reachedDepth}`);
    lastLogTime = now;
  }

  const newState: SquatState = {
    ...prevState,
    kneeAngle: Math.round(kneeAngle),
    _currentRepErrors: [...prevState._currentRepErrors],
  };

  // Track minimum knee angle during descent
  if (kneeAngle < newState._minKneeAngle) {
    newState._minKneeAngle = kneeAngle;
  }

  // Collect real-time form errors
  const realtimeErrors: FormError[] = [];

  if (torsoLean > MAX_FORWARD_LEAN_DEG && kneeAngle < GOING_DOWN_ANGLE) {
    realtimeErrors.push({ type: 'forward_lean', message: '🔼 Chest up! Too much forward lean' });
  }

  if (kneeCollapseResult.collapsed && kneeAngle < GOING_DOWN_ANGLE) {
    realtimeErrors.push({ type: 'knees_inward', message: '↔️ Push knees out! Don\'t let them cave in' });
  }

  // Phase state machine
  const timeSinceLastRep = now - (prevState._lastRepTime || 0);

  if (kneeAngle >= STANDING_ANGLE) {
    // STANDING
    if ((prevState.phase === 'going_up' || prevState.phase === 'at_bottom') && timeSinceLastRep > MIN_REP_INTERVAL_MS) {
      // REP COMPLETE
      const repScore = scoreRep(newState._minKneeAngle, torsoLean, kneeCollapseResult.collapsed, newState._reachedDepth);
      newState.repCount = prevState.repCount + 1;
      newState._lastRepTime = now;
      newState._totalFormScore = prevState._totalFormScore + repScore;
      newState._repFormScores = prevState._repFormScores + 1;
      newState.formScore = Math.round(newState._totalFormScore / newState._repFormScores);
      newState.errors = [...newState._currentRepErrors];

      if (repScore >= 80) {
        newState.feedback = `🎉 Great rep! (${repScore}%)`;
        newState.formQuality = 'good';
      } else if (repScore >= 50) {
        newState.feedback = `👍 OK rep (${repScore}%) — watch your form`;
        newState.formQuality = 'needs_work';
      } else {
        newState.feedback = `⚠️ Poor form (${repScore}%) — go deeper, keep chest up`;
        newState.formQuality = 'needs_work';
      }

      console.log(`[FitMon] ✅ REP #${newState.repCount} | Score: ${repScore}% | MinAngle: ${newState._minKneeAngle.toFixed(1)}° | Avg: ${newState.formScore}%`);
    } else if (prevState.phase === 'standing') {
      newState.feedback = 'Start squatting down!';
      newState.formQuality = 'neutral';
    }
    newState.phase = 'standing';
    newState._reachedDepth = false;
    newState._currentRepErrors = [];
    newState._minKneeAngle = 180;
  } else if (kneeAngle < SQUAT_DEPTH_ANGLE) {
    // AT BOTTOM — valid depth
    newState.phase = 'at_bottom';
    newState._reachedDepth = true;

    if (kneeAngle <= DEEP_SQUAT_ANGLE) {
      newState.feedback = '🔥 Excellent depth! Come back up!';
      newState.formQuality = 'good';
    } else {
      newState.feedback = '✅ Good depth! Stand back up!';
      newState.formQuality = 'good';
    }

    // Add form errors during bottom
    if (realtimeErrors.length > 0) {
      newState.feedback = realtimeErrors[0].message;
      newState.formQuality = 'needs_work';
      for (const err of realtimeErrors) {
        if (!newState._currentRepErrors.find(e => e.type === err.type)) {
          newState._currentRepErrors.push(err);
        }
      }
    }
  } else if (kneeAngle < GOING_DOWN_ANGLE) {
    // TRANSITION ZONE
    if (prevState.phase === 'standing' || prevState.phase === 'going_down') {
      newState.phase = 'going_down';

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
    } else if (prevState.phase === 'at_bottom' && kneeAngle > GOING_UP_EXIT) {
      newState.phase = 'going_up';
      newState.feedback = 'Push back up!';
      newState.formQuality = 'good';
    } else if (prevState.phase === 'going_up') {
      newState.feedback = 'Almost there, keep pushing!';
      newState.formQuality = 'good';
    }
  }

  return newState;
}
