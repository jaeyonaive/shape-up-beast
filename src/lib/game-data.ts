import type { ExerciseType } from './exercise-detection';

export interface GameState {
  totalCoins: number;
  totalReps: number;
  highScore: number;
  bestStreak: number;
  totalCalories: number;
}

export const MONSTER_MAX_HP = 100;

// Points & coins
export const BASE_POINTS_PER_REP = 10;
export const COINS_PER_REP = 5;
export const CALORIES_PER_SQUAT = 0.32;

// Critical hits
export const CRIT_CHANCE = 0.15;
export const CRIT_MULTIPLIER = 2;

// Combo system
export const COMBO_TIMEOUT_MS = 4000;

export function getComboMultiplier(streak: number): number {
  if (streak >= 20) return 5;
  if (streak >= 15) return 4;
  if (streak >= 10) return 3;
  if (streak >= 5) return 2;
  return 1;
}

export function getRank(totalReps: number): { label: string; emoji: string } {
  if (totalReps >= 20) return { label: 'BEAST', emoji: '🔥' };
  if (totalReps >= 10) return { label: 'STRONG', emoji: '⚡' };
  return { label: 'BEGINNER', emoji: '🌱' };
}

export function getRepMessage(damage: number, streak: number, isCrit: boolean, timeLeft: number): string {
  if (isCrit) return `💥 CRITICAL HIT! -${damage} HP!`;
  if (timeLeft <= 10) return `💪 FINAL PUSH! -${damage}`;
  if (streak >= 10) return `🔥 x${streak} UNSTOPPABLE! -${damage}`;
  if (streak >= 5) return `⚡ Combo x${streak}! -${damage}`;
  if (streak >= 3) return `🔥 x${streak} -${damage}`;
  const pool = [`💥 -${damage} HP!`, `⚔️ Nice rep!`, `💪 Keep going!`, `⭐ Hit! -${damage}`, `🗡️ Strike! -${damage}`];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function getComboLabel(streak: number): string | null {
  if (streak >= 20) return `x${streak} 🔥🔥🔥 UNSTOPPABLE!`;
  if (streak >= 15) return `x${streak} 🔥🔥 ON FIRE!`;
  if (streak >= 10) return `x${streak} 🔥 COMBO!`;
  if (streak >= 5) return `x${streak} combo`;
  if (streak >= 3) return `x${streak}`;
  return null;
}

// Workout phases
export interface WorkoutPhase {
  exercise: ExerciseType;
  duration: number; // seconds
  label: string;
  emoji: string;
}

export const WORKOUT_PHASES: WorkoutPhase[] = [
  { exercise: 'squats', duration: 30, label: 'Squats', emoji: '🏋️' },
  { exercise: 'jumping_jacks', duration: 30, label: 'Jumping Jacks', emoji: '⭐' },
];

export function getDefaultGameState(): GameState {
  return { totalCoins: 0, totalReps: 0, highScore: 0, bestStreak: 0, totalCalories: 0 };
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
