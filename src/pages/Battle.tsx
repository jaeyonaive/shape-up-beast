import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MonsterDisplay } from '@/components/game/MonsterDisplay';
import { CalibrationScreen } from '@/components/game/CalibrationScreen';
import { useNavigate } from 'react-router-dom';
import { usePoseDetection } from '@/hooks/usePoseDetection';
import {
  createExerciseState, detectExercise, DAMAGE_MAP, CALORIES_PER_REP,
  type ExerciseState,
} from '@/lib/exercise-detection';
import { PhaseTransitionOverlay } from '@/components/game/PhaseTransitionOverlay';
import {
  WORKOUT_PHASES, MONSTER_MAX_HP, loadGameState, saveGameState,
  BASE_POINTS_PER_REP, COINS_PER_REP, COMBO_TIMEOUT_MS,
  getComboMultiplier, getComboLabel,
} from '@/lib/game-data';
import { Button } from '@/components/ui/button';
import battleBgForest from '@/assets/gameplay-custom-bg.jpg';

export default function Battle() {
  const navigate = useNavigate();
  const { landmarks, isLoading, error, cameraActive, cameraStatus, startCamera, stopCamera, stream } = usePoseDetection();

  const [phaseIndex, setPhaseIndex] = useState(0);
  const [phaseTimeLeft, setPhaseTimeLeft] = useState(WORKOUT_PHASES[0].duration);
  const [workoutComplete, setWorkoutComplete] = useState(false);

  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [streak, setStreak] = useState(0);
  const [calories, setCalories] = useState(0);
  const [totalReps, setTotalReps] = useState(0);
  const [monsterHP, setMonsterHP] = useState(MONSTER_MAX_HP);
  const [isHit, setIsHit] = useState(false);
  const [damageText, setDamageText] = useState<string | null>(null);
  const [comboText, setComboText] = useState<string | null>(null);
  const [gameMessage, setGameMessage] = useState<string | null>(null);
  const gameMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [started, setStarted] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [sessionOver, setSessionOver] = useState(false);
  const [monsterDefeated, setMonsterDefeated] = useState(false);
  const [phaseTransition, setPhaseTransition] = useState<{ label: string; emoji: string } | null>(null);

  const exerciseStateRef = useRef<ExerciseState>(createExerciseState(WORKOUT_PHASES[0].exercise));
  const [displayState, setDisplayState] = useState<ExerciseState>(exerciseStateRef.current);
  const prevRepRef = useRef(0);
  const lastRepTimeRef = useRef(Date.now());
  const streakRef = useRef(0);

  // Use ref so rep-counting effect always has latest gameActive without stale closure
  const gameActiveRef = useRef(false);
  useEffect(() => {
    gameActiveRef.current = gameActive;
  }, [gameActive]);

  // Phase timer
  useEffect(() => {
    if (!gameActive || sessionOver || workoutComplete) return;
    const interval = setInterval(() => {
      setPhaseTimeLeft(t => {
        if (t <= 1) {
          const nextIdx = phaseIndex + 1;
          if (nextIdx >= WORKOUT_PHASES.length) {
            setWorkoutComplete(true);
            return 0;
          }
          const nextPhase = WORKOUT_PHASES[nextIdx];
          setPhaseTransition({ label: nextPhase.label, emoji: nextPhase.emoji });
          setTimeout(() => {
            setPhaseIndex(nextIdx);
            const newExState = createExerciseState(nextPhase.exercise);
            // Carry over calibration data so user doesn't re-calibrate
            newExState.calibrated = true;
            newExState.bodyDetected = true;
            newExState.calibrationProgress = 100;
            switch (nextPhase.exercise) {
              case 'squats': newExState.phase = 'standing'; break;
              case 'jumping_jacks': newExState.phase = 'closed'; break;
              case 'lunges': newExState.phase = 'lunge_standing'; break;
            }
            newExState._standingHipY = exerciseStateRef.current._standingHipY;
            newExState._squatHipY = exerciseStateRef.current._squatHipY;
            newExState._threshold = exerciseStateRef.current._threshold;
            newExState._squatDropRatio = exerciseStateRef.current._squatDropRatio;
            exerciseStateRef.current = newExState;
            prevRepRef.current = 0;
            setDisplayState({ ...newExState });
            setPhaseTransition(null);
          }, 3000);
          return nextPhase.duration;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameActive, sessionOver, workoutComplete, phaseIndex]);

  // End session when workout complete
  useEffect(() => {
    if (workoutComplete && !sessionOver) handleEndSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutComplete]);

  // Combo streak timeout
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

  // Pose detection → exercise state → rep counting
  // IMPORTANT: uses gameActiveRef (not gameActive) to avoid stale-closure bug
  // where first rep after calibration wouldn't trigger damage.
  useEffect(() => {
    if (!landmarks || !started || sessionOver || workoutComplete) return;

    const newState = detectExercise(landmarks, exerciseStateRef.current);
    exerciseStateRef.current = newState;
    setDisplayState({ ...newState });

    // Activate game as soon as calibration completes
    if (newState.calibrated && !gameActiveRef.current) {
      setGameActive(true);
      gameActiveRef.current = true;
    }

    // Count rep if repCount increased AND game is active (use ref to avoid stale closure)
    if (newState.repCount > prevRepRef.current && gameActiveRef.current) {
      prevRepRef.current = newState.repCount;
      lastRepTimeRef.current = Date.now();

      const exType = newState.exerciseType;
      const damage = DAMAGE_MAP[exType];
      const calPerRep = CALORIES_PER_REP[exType];

      const newStreak = streakRef.current + 1;
      streakRef.current = newStreak;
      setStreak(newStreak);

      const multiplier = getComboMultiplier(newStreak);
      setScore(s => s + BASE_POINTS_PER_REP * multiplier);
      setCoins(c => c + COINS_PER_REP * multiplier);
      setCalories(cal => +(cal + calPerRep).toFixed(1));
      setTotalReps(r => r + 1);

      setMonsterHP(hp => {
        const newHP = Math.max(0, hp - damage);
        if (newHP <= 0) setMonsterDefeated(true);
        return newHP;
      });

      const label = getComboLabel(newStreak);
      if (label) setComboText(label);

      setIsHit(true);
      setDamageText(`-${damage}`);

      const exerciseEmoji = exType === 'squats' ? '🏋️' : exType === 'jumping_jacks' ? '⭐' : '🦵';
      const messages = [
        `${exerciseEmoji} Rep ${newState.repCount}! -${damage} HP`,
        `💥 You dealt ${damage} damage!`,
        `⚔️ Critical hit! ${damage} damage!`,
        `💪 Nice rep! Monster took ${damage}!`,
      ];
      const msg = messages[Math.floor(Math.random() * messages.length)];
      if (gameMessageTimer.current) clearTimeout(gameMessageTimer.current);
      setGameMessage(msg);
      gameMessageTimer.current = setTimeout(() => setGameMessage(null), 1800);

      setTimeout(() => { setIsHit(false); setDamageText(null); }, 400);
    }
  }, [landmarks, started, sessionOver, workoutComplete]);

  // Monster defeat reset
  useEffect(() => {
    if (monsterDefeated) {
      setTimeout(() => { setMonsterHP(MONSTER_MAX_HP); setMonsterDefeated(false); }, 1500);
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

  useEffect(() => { handleStart(); }, [handleStart]);

  // ── Session over screen ──
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

  // ── Calibration screen ──
  if (started && !gameActive) {
    return (
      <CalibrationScreen
        stream={stream}
        landmarks={landmarks}
        feedback={displayState.feedback}
        calibrationProgress={displayState.calibrationProgress}
        formQuality={displayState.formQuality}
        bodyDetected={displayState.bodyDetected}
        isLoading={isLoading}
        cameraActive={cameraActive}
        cameraStatus={cameraStatus}
        error={error}
        onRetry={handleStart}
      />
    );
  }

  const hpPercent = Math.max(0, (monsterHP / MONSTER_MAX_HP) * 100);

  // ── Main gameplay screen ──
  // z-index layers:
  //   z-0  background image
  //   z-10 monster (centre)
  //   z-20 damage/combo floating text
  //   z-30 monster-defeated overlay
  //   z-40 HUD (rep counter, HP bar, timer, bottom message)
  //   z-50 phase transition overlay

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      {/* Background */}
      <img src={battleBgForest} alt="" className="absolute inset-0 w-full h-full object-cover z-0" />

      {/* Monster */}
      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
        <MonsterDisplay imageKey="monster-tutorial" isHit={isHit} />
      </div>

      {/* HP bar — above monster, always visible */}
      <div className="absolute top-3 left-3 right-3 z-40">
        <div className="flex items-center gap-2">
          <span className="font-pixel text-xs text-foreground game-text-shadow shrink-0">HP</span>
          <div className="flex-1 h-5 border-[3px] border-foreground bg-black">
            <div
              className={`h-full transition-all duration-300 ${hpPercent < 30 ? 'bg-hp-low' : 'bg-hp-bar'}`}
              style={{ width: `${hpPercent}%` }}
            />
          </div>
          <span className="font-pixel text-[9px] text-foreground game-text-shadow shrink-0">
            {Math.ceil(monsterHP)}/{MONSTER_MAX_HP}
          </span>
        </div>
      </div>

      {/* Rep counter — top left, below HP bar */}
      <div className="absolute top-12 left-3 z-40">
        <span className="font-pixel text-xs text-foreground game-text-shadow whitespace-nowrap">
          REP: <span className="text-primary">{String(displayState.repCount).padStart(3, '0')}</span>
        </span>
      </div>

      {/* Timer — right side, vertically centred */}
      <div
        className="absolute right-3 z-40 text-right"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      >
        <span className="font-pixel text-[10px] text-game-gold game-text-shadow block leading-tight">TIME</span>
        <span className="font-pixel text-5xl text-game-gold game-text-shadow italic leading-none">{phaseTimeLeft}</span>
      </div>

      {/* Floating damage text */}
      {damageText && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-20 animate-bounce pointer-events-none">
          <span className="font-pixel text-3xl text-destructive game-text-shadow drop-shadow-lg">{damageText}</span>
        </div>
      )}

      {/* Combo text */}
      {comboText && (
        <div className="absolute top-[42%] left-1/2 -translate-x-1/2 z-20 animate-bounce pointer-events-none">
          <span className="font-pixel text-lg text-secondary game-text-shadow drop-shadow-lg">{comboText}</span>
        </div>
      )}

      {/* Monster defeated overlay */}
      {monsterDefeated && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/40 pointer-events-none">
          <span className="font-pixel text-2xl text-primary game-text-shadow animate-bounce">💥 DEFEATED!</span>
        </div>
      )}

      {/* Bottom feedback message — fixed above safe area, never overlapping timer */}
      <div className="absolute bottom-4 left-3 z-40" style={{ right: '4.5rem' }}>
        <AnimatePresence>
          {gameMessage && (
            <motion.div
              key={gameMessage}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="bg-black/75 backdrop-blur-sm rounded-lg px-3 py-2"
            >
              <span className="font-pixel text-[10px] text-primary game-text-shadow">{gameMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Exercise feedback — bottom centre, above game message */}
      {displayState.feedback && displayState.feedback !== `Rep ${displayState.repCount}!` && (
        <div className="absolute bottom-16 left-3 z-40 pointer-events-none" style={{ right: '4.5rem' }}>
          <div className="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-1.5 inline-block">
            <span className={`font-body text-xs font-semibold game-text-shadow ${
              displayState.formQuality === 'good' ? 'text-primary' :
              displayState.formQuality === 'needs_work' ? 'text-yellow-400' :
              'text-foreground'
            }`}>
              {displayState.feedback}
            </span>
          </div>
        </div>
      )}

      {/* Phase transition overlay */}
      {phaseTransition && (
        <PhaseTransitionOverlay emoji={phaseTransition.emoji} label={phaseTransition.label} />
      )}
    </div>
  );
}
