export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseResult {
  landmarks: Landmark[];
}

export const POSE = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

export function calculateAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

export function getMidpoint(a: Landmark, b: Landmark): Landmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

export type SquatPhase = 'standing' | 'going_down' | 'at_bottom' | 'going_up';

export interface SquatState {
  phase: SquatPhase;
  repCount: number;
  feedback: string;
  formQuality: 'good' | 'needs_work' | 'neutral';
  /** Internal: timestamp of last rep */
  _lastRepTime?: number;
  /** Internal: rolling angle buffer for smoothing */
  _angleBuffer?: number[];
}

let lastLogTime = 0;

// Smooth angle using a rolling average of the last N frames
function smoothAngle(buffer: number[], newAngle: number, windowSize = 3): { smoothed: number; buffer: number[] } {
  const updated = [...buffer, newAngle].slice(-windowSize);
  const smoothed = updated.reduce((a, b) => a + b, 0) / updated.length;
  return { smoothed, buffer: updated };
}

export function detectSquat(
  landmarks: Landmark[],
  prevState: SquatState
): SquatState {
  const leftHip = landmarks[POSE.LEFT_HIP];
  const rightHip = landmarks[POSE.RIGHT_HIP];
  const leftKnee = landmarks[POSE.LEFT_KNEE];
  const rightKnee = landmarks[POSE.RIGHT_KNEE];
  const leftAnkle = landmarks[POSE.LEFT_ANKLE];
  const rightAnkle = landmarks[POSE.RIGHT_ANKLE];
  const leftShoulder = landmarks[POSE.LEFT_SHOULDER];
  const rightShoulder = landmarks[POSE.RIGHT_SHOULDER];

  const keyParts = [leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle];
  const allExist = keyParts.every(p => p != null);

  if (!allExist) {
    return { ...prevState, feedback: '📷 Move back so camera sees your full body', formQuality: 'neutral' };
  }

  // Weighted bilateral angle: use visibility-weighted average of both sides
  const leftVis = (leftHip?.visibility ?? 0) + (leftKnee?.visibility ?? 0) + (leftAnkle?.visibility ?? 0);
  const rightVis = (rightHip?.visibility ?? 0) + (rightKnee?.visibility ?? 0) + (rightAnkle?.visibility ?? 0);
  const leftAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  const rightAngle = calculateAngle(rightHip, rightKnee, rightAnkle);

  let rawAngle: number;
  const totalVis = leftVis + rightVis;
  if (totalVis > 0) {
    rawAngle = (leftAngle * leftVis + rightAngle * rightVis) / totalVis;
  } else {
    rawAngle = (leftAngle + rightAngle) / 2;
  }

  // Apply temporal smoothing (5-frame moving average)
  const { smoothed: kneeAngle, buffer: newBuffer } = smoothAngle(
    prevState._angleBuffer || [], rawAngle, 5
  );

  // Form validation: check hip angle to reject forward bends
  let isValidSquatForm = true;
  if (leftShoulder && rightShoulder && leftHip && rightHip && leftKnee && rightKnee) {
    const leftHipAngle = calculateAngle(leftShoulder, leftHip, leftKnee);
    const rightHipAngle = calculateAngle(rightShoulder, rightHip, rightKnee);
    const hipAngle = (leftHipAngle + rightHipAngle) / 2;
    // If hip angle is too small (<60°), user is bending forward, not squatting
    if (hipAngle < 60) {
      isValidSquatForm = false;
    }
  }

  // Debug logging (throttled)
  const now = Date.now();
  if (now - lastLogTime > 500) {
    console.log(`[FitMon] Knee: ${kneeAngle.toFixed(1)}° (raw: ${rawAngle.toFixed(1)}°) | Phase: ${prevState.phase} | Reps: ${prevState.repCount} | Valid: ${isValidSquatForm}`);
    lastLogTime = now;
  }

  const newState: SquatState = { 
    ...prevState, 
    _angleBuffer: newBuffer,
  };

  // Hysteresis thresholds: different for going down vs coming up
  const STANDING_UP = 155;    // must reach this to count as standing (coming up)
  const STANDING_DOWN = 145;  // start going_down below this
  const SQUAT_ENTER = 120;   // enter squat zone going down
  const SQUAT_EXIT = 130;    // exit squat zone going up (hysteresis)
  const DEEP_SQUAT = 100;

  // Minimum rep duration: prevent noise-induced false reps
  const MIN_REP_INTERVAL_MS = 800;
  const timeSinceLastRep = now - (prevState._lastRepTime || 0);

  if (kneeAngle > STANDING_UP) {
    // Standing position
    if ((prevState.phase === 'going_up' || prevState.phase === 'at_bottom') && timeSinceLastRep > MIN_REP_INTERVAL_MS) {
      newState.repCount = prevState.repCount + 1;
      newState._lastRepTime = now;
      newState.feedback = '🎉 Great rep!';
      newState.formQuality = 'good';
      console.log(`[FitMon] ✅ REP COUNTED! Total: ${newState.repCount}`);
    } else if (prevState.phase === 'standing' || prevState.phase === 'going_down') {
      newState.feedback = 'Start squatting down!';
      newState.formQuality = 'neutral';
    }
    newState.phase = 'standing';
  } else if (kneeAngle < DEEP_SQUAT && isValidSquatForm) {
    newState.phase = 'at_bottom';
    newState.feedback = '✅ Good depth! Come back up!';
    newState.formQuality = 'good';
  } else if (kneeAngle < SQUAT_ENTER && isValidSquatForm) {
    if (prevState.phase === 'standing' || prevState.phase === 'going_down') {
      newState.phase = 'at_bottom';
      newState.feedback = 'Good! Now stand back up!';
      newState.formQuality = 'good';
    } else {
      newState.phase = 'going_up';
      newState.feedback = 'Push back up!';
      newState.formQuality = 'good';
    }
  } else if (kneeAngle < STANDING_DOWN) {
    if (prevState.phase === 'standing') {
      newState.phase = 'going_down';
      newState.feedback = isValidSquatForm ? 'Keep going down!' : '⚠️ Keep your back straight!';
      newState.formQuality = isValidSquatForm ? 'neutral' : 'needs_work';
    } else if (prevState.phase === 'at_bottom' && kneeAngle > SQUAT_EXIT) {
      newState.phase = 'going_up';
      newState.feedback = 'Good, push up!';
      newState.formQuality = 'good';
    }
    // going_down stays going_down in this range (no stuck state)
    // going_up stays going_up in this range
  }

  if (!isValidSquatForm && kneeAngle < STANDING_DOWN) {
    newState.feedback = '⚠️ Keep your back straight — don\'t bend forward!';
    newState.formQuality = 'needs_work';
  }

  return newState;
}

export function drawPose(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);

  const connections = [
    [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER],
    [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW],
    [POSE.LEFT_ELBOW, POSE.LEFT_WRIST],
    [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW],
    [POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST],
    [POSE.LEFT_SHOULDER, POSE.LEFT_HIP],
    [POSE.RIGHT_SHOULDER, POSE.RIGHT_HIP],
    [POSE.LEFT_HIP, POSE.RIGHT_HIP],
    [POSE.LEFT_HIP, POSE.LEFT_KNEE],
    [POSE.LEFT_KNEE, POSE.LEFT_ANKLE],
    [POSE.RIGHT_HIP, POSE.RIGHT_KNEE],
    [POSE.RIGHT_KNEE, POSE.RIGHT_ANKLE],
  ];

  ctx.strokeStyle = 'hsl(200, 85%, 55%)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';

  for (const [startIdx, endIdx] of connections) {
    const start = landmarks[startIdx];
    const end = landmarks[endIdx];
    if (start && end) {
      ctx.beginPath();
      ctx.moveTo(start.x * width, start.y * height);
      ctx.lineTo(end.x * width, end.y * height);
      ctx.stroke();
    }
  }

  const keyPoints = Object.values(POSE);
  for (const idx of keyPoints) {
    const lm = landmarks[idx];
    if (lm) {
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, 6, 0, 2 * Math.PI);
      ctx.fillStyle = 'hsl(145, 80%, 50%)';
      ctx.fill();
      ctx.strokeStyle = 'hsl(0, 0%, 100%)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
