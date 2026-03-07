// Pose detection utilities using MediaPipe via CDN
// We use the drawing_utils and pose_landmarker from MediaPipe Tasks Vision

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseResult {
  landmarks: Landmark[];
}

// Key landmark indices from MediaPipe Pose
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

// Squat detection state machine
export type SquatPhase = 'standing' | 'going_down' | 'at_bottom' | 'going_up';

export interface SquatState {
  phase: SquatPhase;
  repCount: number;
  feedback: string;
  formQuality: 'good' | 'needs_work' | 'neutral';
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

  if (!leftHip || !rightHip || !leftKnee || !rightKnee || !leftAnkle || !rightAnkle) {
    return { ...prevState, feedback: 'Stand where the camera can see you', formQuality: 'neutral' };
  }

  // Calculate knee angles (both sides)
  const leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  const rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
  const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;

  // Calculate hip angle for depth check
  const midShoulder = getMidpoint(leftShoulder, rightShoulder);
  const midHip = getMidpoint(leftHip, rightHip);
  const midKnee = getMidpoint(leftKnee, rightKnee);
  const hipAngle = calculateAngle(midShoulder, midHip, midKnee);

  const newState = { ...prevState };

  // Thresholds
  const STANDING_ANGLE = 160;
  const SQUAT_ANGLE = 110;
  const DEEP_SQUAT_ANGLE = 90;

  if (avgKneeAngle > STANDING_ANGLE) {
    // Standing position
    if (prevState.phase === 'going_up' || prevState.phase === 'at_bottom') {
      // Completed a rep!
      newState.repCount = prevState.repCount + 1;
      newState.feedback = '🎉 Great rep!';
      newState.formQuality = 'good';
    } else {
      newState.feedback = 'Start squatting down!';
      newState.formQuality = 'neutral';
    }
    newState.phase = 'standing';
  } else if (avgKneeAngle < DEEP_SQUAT_ANGLE) {
    newState.phase = 'at_bottom';
    newState.feedback = '✅ Good depth! Come back up!';
    newState.formQuality = 'good';
  } else if (avgKneeAngle < SQUAT_ANGLE) {
    if (prevState.phase === 'standing' || prevState.phase === 'going_down') {
      newState.phase = 'at_bottom';
      newState.feedback = 'Go a bit deeper!';
      newState.formQuality = 'needs_work';
    } else {
      newState.phase = 'going_up';
      newState.feedback = 'Push back up!';
      newState.formQuality = 'good';
    }
  } else if (avgKneeAngle < STANDING_ANGLE) {
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

// Draw pose skeleton on canvas
export function drawPose(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);

  // Connections to draw
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

  // Draw connections
  ctx.strokeStyle = 'hsl(200, 85%, 55%)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';

  for (const [startIdx, endIdx] of connections) {
    const start = landmarks[startIdx];
    const end = landmarks[endIdx];
    if (start && end && (start.visibility ?? 1) > 0.5 && (end.visibility ?? 1) > 0.5) {
      ctx.beginPath();
      ctx.moveTo(start.x * width, start.y * height);
      ctx.lineTo(end.x * width, end.y * height);
      ctx.stroke();
    }
  }

  // Draw landmarks
  const keyPoints = Object.values(POSE);
  for (const idx of keyPoints) {
    const lm = landmarks[idx];
    if (lm && (lm.visibility ?? 1) > 0.5) {
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
