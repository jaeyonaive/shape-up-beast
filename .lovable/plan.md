

# Fix False Squat Detection — Plan

## Problem

Standing still or slightly moving triggers squat reps. The detection is too sensitive, causing false positives from minor hip position jitter, baseline drift, and loose thresholds.

## Root Causes (in `src/lib/exercise-detection.ts`)

1. **Standing baseline drift** (line 396-398): `_standingHipY` is continuously adjusted with an exponential moving average (`0.92/0.08 blend`) while standing. Over time this shifts the threshold closer to the current hip position, making tiny movements cross the squat boundary.

2. **Return threshold too shallow** (`SQUAT_RETURN_RATIO = 0.08`): The user barely needs to move up from the squat position for a rep to count. Combined with baseline drift, normal posture sway triggers reps.

3. **Knee angle fallback too loose** (`deepByKnee = kneeAngle < 140`): A slight knee bend (which happens when standing naturally) can satisfy the "deep enough" check even without meaningful hip drop.

4. **Noise threshold too small** (`SQUAT_NOISE_Y = 0.012`): Tiny pose detection jitter exceeds this, causing false "descending" state transitions.

5. **Smoothing window only 3 frames**: Not enough to filter MediaPipe landmark noise.

6. **No minimum absolute hip displacement check**: The system only checks ratios relative to a drifting baseline, never verifying the hip actually moved a meaningful absolute distance.

## Changes to `src/lib/exercise-detection.ts`

### A. Increase noise filtering
- `SMOOTHING_WINDOW`: 3 → **5** (median filter over more frames)
- `SQUAT_NOISE_Y`: 0.012 → **0.025** (ignore smaller hip velocity)

### B. Tighten squat depth requirements
- `SQUAT_KNEE_ANGLE_THRESHOLD`: 140 → **120** (require deeper knee bend for fallback)
- `SQUAT_STANDING_ANGLE`: 158 → **160** (stricter standing check)
- Require **both** hip drop AND knee angle (change `||` to `&&` when knees are visible, keep hip-only when knees aren't visible):
  ```
  const isDeepEnough = kneesVis ? (deepByHip && deepByKnee) : deepByHip;
  ```

### C. Add minimum absolute hip displacement guard
- Add constant `MIN_ABSOLUTE_HIP_DROP = 0.04` (in normalized coordinates)
- Before counting depth reached, verify: `(smoothedHipY - state._standingHipY) >= MIN_ABSOLUTE_HIP_DROP`

### D. Fix baseline drift
- **Remove** the continuous standing baseline adjustment (lines 396-398). Once calibrated, the standing position should be locked. This prevents the threshold from creeping toward the current position.

### E. Tighten return-to-standing check
- `SQUAT_RETURN_RATIO`: 0.08 → **0.04** (must return much closer to original standing height)
- Add condition: hip must be **above** starting position + small margin, not just below the return threshold that's drifting

### F. Increase rep cooldown
- `REP_COOLDOWN_MS`: 500 → **800** ms (prevent rapid double-counts)

## Summary of constant changes

| Constant | Before | After |
|---|---|---|
| `SMOOTHING_WINDOW` | 3 | 5 |
| `SQUAT_NOISE_Y` | 0.012 | 0.025 |
| `SQUAT_KNEE_ANGLE_THRESHOLD` | 140 | 120 |
| `REP_COOLDOWN_MS` | 500 | 800 |
| `SQUAT_RETURN_RATIO` | 0.08 | 0.04 |
| New: `MIN_ABSOLUTE_HIP_DROP` | — | 0.04 |

## Files modified
- `src/lib/exercise-detection.ts` — all changes above

## What stays the same
- Calibration flow, camera, UI, gameplay, damage system — no changes
- Jumping jack and lunge detection — untouched

