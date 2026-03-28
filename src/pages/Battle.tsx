import { useState, useEffect, useRef, useCallback } from 'react';
import { CameraOverlay } from '@/components/game/CameraOverlay';
import { MonsterDisplay } from '@/components/game/MonsterDisplay';
import { HPBar } from '@/components/game/HPBar';
import { useNavigate } from 'react-router-dom';
import { usePoseDetection } from '@/hooks/usePoseDetection';
import {
  createExerciseState, detectExercise, DAMAGE_MAP, EXERCISE_LABELS, CALORIES_PER_REP,
  type ExerciseState, type ExerciseType,
} from '@/lib/exercise-detection';
import {
  WORKOUT_PHASES, MONSTER_MAX_HP, loadGameState, saveGameState,
  BASE_POINTS_PER_REP, COINS_PER_REP, COMBO_TIMEOUT_MS,
  getComboMultiplier, getComboLabel,
} from '@/lib/game-data';
import { Button } from '@/components/ui/button';
import battleBgForest from '@/assets/battle-bg-forest.jpg';
import coinImg from '@/assets/coin.png';
import monsterTutorial from '@/assets/monster-tutorial.png';

export default function Battle() {
  const navigate = useNavigate();
  const { landmarks, isLoading, error, startCamera, stopCamera, stream } = usePoseDetection();

  // Workout phase management
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [phaseTimeLeft, setPhaseTimeLeft] = useState(WORKOUT_PHASES[0].duration);
  const [workoutComplete, setWorkoutComplete] = useState(false);

  // Game state
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [streak, setStreak] = useState(0);
  const [calories, setCalories] = useState(0);
  const [totalReps, setTotalReps] = useState(0);
  const [monsterHP, setMonsterHP] = useState(MONSTER_MAX_HP);
  const [isHit, setIsHit] = useState(false);
  const [damageText, setDamageText] = useState<string | null>(null);
  const [comboText, setComboText] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [sessionOver, setSessionOver] = useState(false);
  const [monsterDefeated, setMonsterDefeated] = useState(false);

  // Exercise detection state
  const exerciseStateRef = useRef<ExerciseState>(createExerciseState(WORKOUT_PHASES[0].exercise));
  const [displayState, setDisplayState] = useState<ExerciseState>(exerciseStateRef.current);
  const prevRepRef = useRef(0);
  const lastRepTimeRef = useRef(Date.now());
  const streakRef = useRef(0);

  const currentPhase = WORKOUT_PHASES[phaseIndex];

  // Phase countdown timer
  useEffect(() => {
    if (!gameActive || sessionOver || workoutComplete) return;
    const interval = setInterval(() => {
      setPhaseTimeLeft(t => {
        if (t <= 1) {
          // Phase ended, move to next
          const nextIdx = phaseIndex + 1;
          if (nextIdx >= WORKOUT_PHASES.length) {
            setWorkoutComplete(true);
            return 0;
          }
          setPhaseIndex(nextIdx);
          // Reset exercise state for new phase
          const newExState = createExerciseState(WORKOUT_PHASES[nextIdx].exercise);
          // Skip calibration if body already detected
          newExState.calibrated = true;
          newExState.bodyDetected = true;
          newExState.calibrationProgress = 100;
          switch (WORKOUT_PHASES[nextIdx].exercise) {
            case 'squats': newExState.phase = 'standing'; break;
            case 'jumping_jacks': newExState.phase = 'closed'; break;
            case 'lunges': newExState.phase = 'lunge_standing'; break;
          }
          // Copy calibration data from current state
          newExState._standingHipY = exerciseStateRef.current._standingHipY;
          newExState._squatHipY = exerciseStateRef.current._squatHipY;
          newExState._threshold = exerciseStateRef.current._threshold;
          exerciseStateRef.current = newExState;
          prevRepRef.current = 0;
          setDisplayState({ ...newExState });
          return WORKOUT_PHASES[nextIdx].duration;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameActive, sessionOver, workoutComplete, phaseIndex]);

  // End session when workout complete
  useEffect(() => {
    if (workoutComplete && !sessionOver) {
      handleEndSession();
    }
  }, [workoutComplete]);

  // Combo timeout
  useEffect(() => {
    if (!gameActive || sessionOver) return;
    const interval = setInterval(() => {
      if (streakRef.current > 0 && Date.now() - lastRepTimeRef.current > COMBO_TIMEOUT_MS) {
        streakRef.current = 0;
        setStreak(0);
        setComboText(null);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [gameActive, sessionOver]);

  // Exercise detection
  useEffect(() => {
    if (!landmarks || !started || sessionOver || workoutComplete) return;
    const newState = detectExercise(landmarks, exerciseStateRef.current);
    exerciseStateRef.current = newState;
    setDisplayState({ ...newState });

    if (newState.calibrated && !gameActive) setGameActive(true);

    const isActive = gameActive || newState.calibrated;
    if (newState.repCount > prevRepRef.current && isActive) {
      prevRepRef.current = newState.repCount;
      lastRepTimeRef.current = Date.now();

      const exType = newState.exerciseType;
      const damage = DAMAGE_MAP[exType];
      const calPerRep = CALORIES_PER_REP[exType];

      // Streak
      const newStreak = streakRef.current + 1;
      streakRef.current = newStreak;
      setStreak(newStreak);

      const multiplier = getComboMultiplier(newStreak);
      const points = BASE_POINTS_PER_REP * multiplier;
      const earnedCoins = COINS_PER_REP * multiplier;

      setScore(s => s + points);
      setCoins(c => c + earnedCoins);
      setCalories(cal => +(cal + calPerRep).toFixed(1));
      setTotalReps(r => r + 1);

      // Monster damage
      setMonsterHP(hp => {
        const newHP = Math.max(0, hp - damage);
        if (newHP <= 0) setMonsterDefeated(true);
        return newHP;
      });

      // Combo label
      const label = getComboLabel(newStreak);
      if (label) setComboText(label);

      // Hit effects
      setIsHit(true);
      setDamageText(`-${damage}`);
      setTimeout(() => { setIsHit(false); setDamageText(null); }, 400);
    }
  }, [landmarks, started, sessionOver, gameActive, workoutComplete]);

  // Respawn monster when defeated
  useEffect(() => {
    if (monsterDefeated) {
      setTimeout(() => {
        setMonsterHP(MONSTER_MAX_HP);
        setMonsterDefeated(false);
      }, 1500);
    }
  }, [monsterDefeated]);

  const handleStart = useCallback(async () => {
    setStarted(true);
    await startCamera();
  }, [startCamera]);

  const handleEndSession = useCallback(() => {
    setSessionOver(true);
    stopCamera();
    const state = loadGameState();
    state.totalCoins += coins;
    state.totalReps += totalReps;
    state.totalCalories = +(state.totalCalories + calories).toFixed(1);
    if (score > state.highScore) state.highScore = score;
    if (streak > state.bestStreak) state.bestStreak = streak;
    saveGameState(state);
  }, [coins, calories, score, streak, totalReps, stopCamera]);

  // ─── Pre-start screen ───
  if (!started) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 gap-6">
        <img src={monsterTutorial} alt="Monster" className="w-48 h-48 object-contain drop-shadow-2xl monster-float" />
        <div className="text-center">
          <h2 className="font-pixel text-lg text-foreground game-text-shadow mb-2">2-Phase Workout</h2>
          <div className="space-y-1 mb-4">
            {WORKOUT_PHASES.map((p, i) => (
              <p key={i} className="font-body text-sm text-muted-foreground">
                {p.emoji} {p.label} — {p.duration}s
              </p>
            ))}
          </div>
          <p className="font-body text-xs text-muted-foreground mb-6">
            Defeat the monster · Earn coins · Burn calories
          </p>
          <Button onClick={handleStart} disabled={isLoading} className="h-14 px-8 font-pixel text-xs bg-primary text-primary-foreground hover:bg-primary/90 pulse-glow">
            {isLoading ? '⏳ Loading...' : '📷 Start Workout!'}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Session over screen ───
  if (sessionOver) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <div className="game-panel p-8 max-w-sm w-full text-center slide-up">
          <div className="text-6xl mb-4">🏆</div>
          <h2 className="font-pixel text-lg text-foreground game-text-shadow mb-2">Workout Complete!</h2>
          <div className="space-y-2 mb-6">
            <p className="font-body text-sm text-foreground">Score: <span className="font-pixel text-primary">{score}</span></p>
            <p className="font-body text-sm text-foreground">Total Reps: <span className="font-pixel text-primary">{totalReps}</span></p>
            <p className="font-body text-sm text-foreground">Best Combo: <span className="font-pixel text-secondary">x{streak}</span></p>
            <p className="font-body text-sm text-foreground">Calories: <span className="font-pixel text-game-gold">{calories} kcal</span></p>
            <p className="font-body text-sm text-game-gold">+{coins}G earned!</p>
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={() => navigate('/')} className="w-full h-12 font-pixel text-xs bg-primary text-primary-foreground hover:bg-primary/90">🏠 Home</Button>
            <Button variant="outline" onClick={() => window.location.reload()} className="w-full h-12 font-body font-semibold border-border text-foreground">🔄 Go Again</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative overflow-hidden flex flex-col">
      {/* Top 60%: Monster + battle scene */}
      <div className="relative" style={{ flex: '0 0 60%' }}>
        <img src={battleBgForest} alt="" className="absolute inset-0 w-full h-full object-cover" />

        {/* Close button */}
        <button onClick={handleEndSession} className="absolute top-5 right-3 z-30 w-10 h-10 rounded-full bg-muted/80 flex items-center justify-center">
          <span className="text-foreground text-lg">✕</span>
        </button>

        {/* Phase indicator + timer */}
        <div className="absolute top-4 left-3 right-14 z-20 flex items-center justify-between gap-2">
          <div className="game-panel px-3 py-1.5 flex items-center gap-2">
            <span className="text-lg">{currentPhase.emoji}</span>
            <span className="font-pixel text-[10px] text-primary">{currentPhase.label}</span>
          </div>
          <div className="game-panel px-3 py-1.5">
            <span className="font-pixel text-xs text-foreground">{phaseTimeLeft}s</span>
          </div>
        </div>

        {/* Phase progress dots */}
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex gap-2">
          {WORKOUT_PHASES.map((_, i) => (
            <div key={i} className={`w-3 h-3 rounded-full border-2 ${
              i < phaseIndex ? 'bg-primary border-primary' :
              i === phaseIndex ? 'bg-primary/50 border-primary animate-pulse' :
              'bg-muted border-border'
            }`} />
          ))}
        </div>

        {/* HP Bar - above everything */}
        <div className="absolute top-20 left-3 right-3 z-30">
          <HPBar current={monsterHP} max={MONSTER_MAX_HP} name="Brawler Bunny" />
        </div>

        {/* Monster */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none" style={{ marginTop: '10px' }}>
          <MonsterDisplay imageKey="monster-tutorial" isHit={isHit} />
        </div>

        {/* Damage text */}
        {damageText && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full z-20 animate-bounce">
            <span className="font-pixel text-2xl text-destructive game-text-shadow drop-shadow-lg">{damageText}</span>
          </div>
        )}

        {/* Combo text */}
        {comboText && (
          <div className="absolute top-36 left-1/2 -translate-x-1/2 z-20 animate-bounce">
            <span className="font-pixel text-lg text-secondary game-text-shadow drop-shadow-lg">{comboText}</span>
          </div>
        )}

        {/* Monster defeated overlay */}
        {monsterDefeated && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/40">
            <span className="font-pixel text-2xl text-primary game-text-shadow animate-bounce">💥 DEFEATED!</span>
          </div>
        )}

        {/* Bottom stats */}
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between z-20">
          <div className="flex items-center gap-2"><span className="text-xl">💪</span><span className="font-pixel text-sm text-foreground game-text-shadow">{displayState.repCount}</span></div>
          <div className="flex items-center gap-2"><span className="text-xl">🔥</span><span className="font-pixel text-sm text-foreground game-text-shadow">{streak}</span></div>
          <div className="flex items-center gap-2"><span className="text-xs">🔥</span><span className="font-pixel text-[10px] text-muted-foreground game-text-shadow">{calories} kcal</span></div>
          <div className="flex items-center gap-1.5"><img src={coinImg} alt="coins" className="w-6 h-6" /><span className="font-pixel text-xs text-game-gold game-text-shadow">{coins}G</span></div>
        </div>
      </div>

      {/* Bottom 40%: Camera with AR overlay */}
      <div className="relative flex-1 bg-black">
        <CameraOverlay stream={stream} landmarks={landmarks} />
        <div className="absolute bottom-3 left-3 right-3 z-20">
          {!gameActive && (
            <div className="p-3 rounded-xl bg-background/80 backdrop-blur-sm border border-border text-center">
              <p className="font-pixel text-[10px] text-primary mb-1">CALIBRATING</p>
              <p className="font-body text-xs text-foreground mb-2">{displayState.feedback}</p>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${displayState.calibrationProgress ?? 0}%` }} />
              </div>
            </div>
          )}
          {gameActive && (
            <div className={`p-2 rounded-xl text-center backdrop-blur-sm ${
              displayState.formQuality === 'good' ? 'bg-green-500/20 border border-green-500/40' :
              displayState.formQuality === 'needs_work' ? 'bg-yellow-500/20 border border-yellow-500/40' :
              'bg-background/60 border border-border'
            }`}>
              <p className="font-body text-xs font-semibold text-foreground game-text-shadow">{displayState.feedback}</p>
            </div>
          )}
        </div>
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-spin">⏳</div>
            <p className="font-pixel text-xs text-foreground">Starting camera…</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/90">
          <div className="text-center px-4">
            <div className="text-4xl mb-4">❌</div>
            <p className="font-pixel text-xs text-destructive mb-2">Camera Error</p>
            <p className="font-body text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={handleStart} className="bg-primary text-primary-foreground">Retry</Button>
          </div>
        </div>
      )}
    </div>
  );
}
