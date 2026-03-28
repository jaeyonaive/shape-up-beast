export type Exercise = 'squat' | 'lunge' | 'jumping_jack' | 'pushup';

export interface Monster {
  id: string;
  name: string;
  image: string;
  exercise: Exercise;
}

export interface GameState {
  totalCoins: number;
  totalReps: number;
  highScore: number;
  bestStreak: number;
  totalCalories: number;
}

export const MONSTER: Monster = {
  id: 'bunny',
  name: 'Brawler Bunny',
  image: 'monster-tutorial',
  exercise: 'squat',
};

// ~0.32 calories per squat (average estimate)
export const CALORIES_PER_SQUAT = 0.32;

// Combo thresholds for bonus multipliers
export function getComboMultiplier(streak: number): number {
  if (streak >= 20) return 5;
  if (streak >= 15) return 4;
  if (streak >= 10) return 3;
  if (streak >= 5) return 2;
  return 1;
}

export function getComboLabel(streak: number): string | null {
  if (streak >= 20) return `x${streak} 🔥🔥🔥 UNSTOPPABLE!`;
  if (streak >= 15) return `x${streak} 🔥🔥 ON FIRE!`;
  if (streak >= 10) return `x${streak} 🔥 COMBO!`;
  if (streak >= 5) return `x${streak} combo`;
  if (streak >= 3) return `x${streak}`;
  return null;
}

// Points: base 10 per squat * combo multiplier
export const BASE_POINTS_PER_SQUAT = 10;
export const COINS_PER_SQUAT = 5;

// Combo resets after this many seconds without a squat
export const COMBO_TIMEOUT_MS = 4000;

export function getDefaultGameState(): GameState {
  return {
    totalCoins: 0,
    totalReps: 0,
    highScore: 0,
    bestStreak: 0,
    totalCalories: 0,
  };
}

export function loadGameState(): GameState {
  try {
    const saved = localStorage.getItem('fitmon-state');
    if (saved) return JSON.parse(saved);
  } catch {}
  return getDefaultGameState();
}

export function saveGameState(state: GameState) {
  localStorage.setItem('fitmon-state', JSON.stringify(state));
}
