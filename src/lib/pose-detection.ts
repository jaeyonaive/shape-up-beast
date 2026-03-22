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
}

let lastLogTime = 0;

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

  // The new Tasks Vision API always returns all 33 landmarks if a pose is detected.
  // Visibility can be very low or 0 for occluded joints but coordinates are still estimated.
  // So we just check that landmarks exist (they always will if pose was detected).
  const keyParts = [leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle];
  const allExist = keyParts.every(p => p != null);

  if (!allExist) {
    const now = Date.now();
    if (now - lastLogTime > 2000) {
      console.log('[FitMon] Missing key landmarks');
      lastLogTime = now;
    }
    return { ...prevState, feedback: '📷 Move back so camera sees your full body', formQuality: 'neutral' };
  }

  // Use the side with better visibility (fall back to averaging both sides)
  const leftVis = (leftHip?.visibility ?? 0) + (leftKnee?.visibility ?? 0) + (leftAnkle?.visibility ?? 0);
  const rightVis = (rightHip?.visibility ?? 0) + (rightKnee?.visibility ?? 0) + (rightAnkle?.visibility ?? 0);

  let kneeAngle: number;
  if (leftVis >= rightVis) {
    kneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  } else {
    kneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
  }

  // Debug logging (throttled)
  const now = Date.now();
  if (now - lastLogTime > 500) {
    console.log(`[FitMon] Knee angle: ${kneeAngle.toFixed(1)}° | Phase: ${prevState.phase} | Reps: ${prevState.repCount} | Vis L:${leftVis.toFixed(2)} R:${rightVis.toFixed(2)}`);
    lastLogTime = now;
  }

  const newState = { ...prevState };

  // More forgiving thresholds
  const STANDING_ANGLE = 150; // was 160 - more forgiving
  const SQUAT_ANGLE = 120;    // was 110 - easier to trigger
  const DEEP_SQUAT_ANGLE = 100; // was 90 - more forgiving

  if (kneeAngle > STANDING_ANGLE) {
    // Standing position
    if (prevState.phase === 'going_up' || prevState.phase === 'at_bottom') {
      // Completed a rep!
      newState.repCount = prevState.repCount + 1;
      newState.feedback = '🎉 Great rep!';
      newState.formQuality = 'good';
      console.log(`[FitMon] ✅ REP COUNTED! Total: ${newState.repCount}`);
    } else {
      newState.feedback = 'Start squatting down!';
      newState.formQuality = 'neutral';
    }
    newState.phase = 'standing';
  } else if (kneeAngle < DEEP_SQUAT_ANGLE) {
    newState.phase = 'at_bottom';
    newState.feedback = '✅ Good depth! Come back up!';
    newState.formQuality = 'good';
  } else if (kneeAngle < SQUAT_ANGLE) {
    if (prevState.phase === 'standing' || prevState.phase === 'going_down') {
      newState.phase = 'at_bottom';
      newState.feedback = 'Good! Now stand back up!';
      newState.formQuality = 'good';
    } else {
      newState.phase = 'going_up';
      newState.feedback = 'Push back up!';
      newState.formQuality = 'good';
    }
  } else if (kneeAngle < STANDING_ANGLE) {
    if (prevState.phase === 'standing') {
      newState.phase = 'going_down';
      newState.feedback = 'Keep going down!';
      newState.formQuality = 'neutral';
    } else if (prevState.phase === 'at_bottom') {
      newState.phase = 'going_up';
      newState.feedback = 'Good, push up!';
      newState.formQuality = 'good';
    }
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
    if (lm && (lm.visibility ?? 1) > 0.3) {
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
