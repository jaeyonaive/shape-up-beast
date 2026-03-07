export type Exercise = 'squat' | 'lunge' | 'jumping_jack' | 'pushup';

export interface Monster {
  id: string;
  name: string;
  maxHp: number;
  image: string;
  isBoss: boolean;
  exercise: Exercise;
  repsToKill: number;
  goldReward: number;
  timeLimit: number; // seconds
}

export interface GameState {
  currentMonsterIndex: number;
  totalCoins: number;
  totalReps: number;
  streak: number;
  highScore: number;
  completedMonsters: string[];
}

export const MONSTERS: Monster[] = [
  {
    id: 'bunny',
    name: 'Brawler Bunny',
    maxHp: 100,
    image: 'monster-tutorial',
    isBoss: false,
    exercise: 'squat',
    repsToKill: 10,
    goldReward: 200,
    timeLimit: 60,
  },
  {
    id: 'dragon',
    name: 'Inferno Drake',
    maxHp: 200,
    image: 'monster-boss',
    isBoss: true,
    exercise: 'squat',
    repsToKill: 20,
    goldReward: 500,
    timeLimit: 90,
  },
];

export function getDefaultGameState(): GameState {
  return {
    currentMonsterIndex: 0,
    totalCoins: 0,
    totalReps: 0,
    streak: 0,
    highScore: 0,
    completedMonsters: [],
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
