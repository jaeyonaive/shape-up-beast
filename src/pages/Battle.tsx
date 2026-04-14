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
import {
  WORKOUT_PHASES, MONSTER_MAX_HP, loadGameState, saveGameState,
  BASE_POINTS_PER_REP, COINS_PER_REP, COMBO_TIMEOUT_MS,
  getComboMultiplier, getComboLabel, CRIT_CHANCE, CRIT_MULTIPLIER,
  getRank, getRepMessage, calculatePerformanceScore, RHYTHM_BONUS_MULTIPLIER,
} from '@/lib/game-data';
import { Button } from '@/components/ui/button';
import battleBgForest from '@/assets/gameplay-custom-bg.jpg';
import { startBgMusic, stopBgMusic } from '@/lib/bgMusic';

export default function Battle() {
  const navigate = useNavigate();
  const { landmarks, isLoading, error, cameraActive, cameraStatus, startCamera, stopCamera, videoRef } = usePoseDetection();

  const [phaseTimeLeft, setPhaseTimeLeft] = useState(WORKOUT_PHASES[0].duration);
  const [workoutComplete, setWorkoutComplete] = useState(false);

  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [streak, setStreak] = useState(0);
  const [calories, setCalories] = useState(0);
  const [totalReps, setTotalReps] = useState(0);
  const [totalDamage, setTotalDamage] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [monsterHP, setMonsterHP] = useState(MONSTER_MAX_HP);
  const [isHit, setIsHit] = useState(false);
  const [isCrit, setIsCrit] = useState(false);
  const [damageText, setDamageText] = useState<string | null>(null);
  const [comboText, setComboText] = useState<string | null>(null);
  const [gameMessage, setGameMessage] = useState<string | null>(null);
  const gameMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [started, setStarted] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [sessionOver, setSessionOver] = useState(false);
  const [monsterDefeated, setMonsterDefeated] = useState(false);

  // ── Background music ────────────────────────────────────────────────────────
  // Fallback for "Go Again" (full page reload) where no gesture fires on Home.
  // The first touch on the Battle page re-triggers the audio in gesture context.
  useEffect(() => {
    const unlock = () => { startBgMusic(); };
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('click',      unlock, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click',      unlock);
    };
  }, []);

  const exerciseStateRef = useRef<ExerciseState>(createExerciseState(WORKOUT_PHASES[0].exercise));
  const [displayState, setDisplayState] = useState<ExerciseState>(exerciseStateRef.current);
  const prevRepRef = useRef(0);
  const lastRepTimeRef = useRef(Date.now());
  const streakRef = useRef(0);
  const bestComboRef = useRef(0);
  const phaseTimeLeftRef = useRef(WORKOUT_PHASES[0].duration);

  // Accuracy tracking
  const [accuracy, setAccuracy] = useState(100);
  const accuracyRef = useRef({ goodReps: 0, partialAttempts: 0 });
  const prevPartialAttemptsRef = useRef(0);

  // Rhythm tracking
  const repTimestampsRef = useRef<number[]>([]);
  const rhythmActiveRef = useRef(false);

  useEffect(() => {
    if (!gameActive || sessionOver || workoutComplete) return;
    const interval = setInterval(() => {
      setPhaseTimeLeft(t => {
        phaseTimeLeftRef.current = t - 1;
        if (t <= 1) {
          setWorkoutComplete(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameActive, sessionOver, workoutComplete]);

  useEffect(() => {
    if (workoutComplete && !sessionOver) handleEndSession();
  }, [workoutComplete]);

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

  useEffect(() => {
    if (!gameActive || sessionOver) return;
    if (displayState.feedback === 'No body detected') {
      setComboText(prev => (prev?.startsWith('x') ? prev : 'No body detected'));
      return;
    }
    if (displayState.feedback === 'Tracking active') {
      setComboText(prev => (prev?.startsWith('x') ? prev : 'Tracking active'));
      return;
    }
    setComboText(prev => (prev === 'No body detected' || prev === 'Tracking active' ? null : prev));
  }, [displayState.feedback, gameActive, sessionOver]);

  useEffect(() => {
    if (!landmarks || !started || sessionOver || workoutComplete) return;
    const newState = detectExercise(landmarks, exerciseStateRef.current);
    exerciseStateRef.current = newState;
    setDisplayState({ ...newState });

    if (newState.calibrated && !gameActive) setGameActive(true);

    const isActive = gameActive || newState.calibrated;
    // Track partial squat attempts for accuracy (before overwriting exerciseStateRef)
    if (newState._partialAttempts > exerciseStateRef.current._partialAttempts) {
      const delta = newState._partialAttempts - exerciseStateRef.current._partialAttempts;
      accuracyRef.current.partialAttempts += delta;
      prevPartialAttemptsRef.current = newState._partialAttempts;
    }

    if (newState.repCount > prevRepRef.current && isActive) {
      // ── Rhythm system ────────────────────────────────────────────────────
      const repNow = Date.now();
      const interval = repNow - lastRepTimeRef.current;
      let rhythmMult = 1.0;
      if (prevRepRef.current > 0 && interval > 0) {
        const timestamps = [...repTimestampsRef.current, repNow].slice(-6);
        repTimestampsRef.current = timestamps;
        if (timestamps.length >= 4) {
          const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
          const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
          const cv = Math.sqrt(variance) / mean;
          const inRhythm = cv < 0.25 && mean >= 300 && mean <= 3000;
          rhythmActiveRef.current = inRhythm;
          if (inRhythm) rhythmMult = 1 + RHYTHM_BONUS_MULTIPLIER;
        }
      } else {
        repTimestampsRef.current = [repNow];
      }

      prevRepRef.current = newState.repCount;
      lastRepTimeRef.current = repNow;

      // ── Accuracy tracking ────────────────────────────────────────────────
      accuracyRef.current.goodReps += 1;
      const totalAttempts = accuracyRef.current.goodReps + accuracyRef.current.partialAttempts;
      setAccuracy(Math.round((accuracyRef.current.goodReps / totalAttempts) * 100));

      const exType = newState.exerciseType;
      const baseDamage = DAMAGE_MAP[exType];
      const calPerRep = CALORIES_PER_REP[exType];

      const newStreak = streakRef.current + 1;
      streakRef.current = newStreak;
      setStreak(newStreak);
      if (newStreak > bestComboRef.current) {
        bestComboRef.current = newStreak;
        setBestCombo(newStreak);
      }

      const critRoll = Math.random() < CRIT_CHANCE;
      const multiplier = getComboMultiplier(newStreak);
      const damage = Math.round(baseDamage * multiplier * (critRoll ? CRIT_MULTIPLIER : 1) * rhythmMult);

      setScore(s => s + Math.round(BASE_POINTS_PER_REP * multiplier * (critRoll ? CRIT_MULTIPLIER : 1) * rhythmMult));
      setCoins(c => c + COINS_PER_REP * multiplier);
      setCalories(cal => +(cal + calPerRep).toFixed(1));
      setTotalReps(r => r + 1);
      setTotalDamage(d => d + damage);

      setMonsterHP(hp => {
        const newHP = Math.max(0, hp - damage);
        if (newHP <= 0) setMonsterDefeated(true);
        return newHP;
      });

      const label = getComboLabel(newStreak);
      if (label) setComboText(label);

      setIsCrit(critRoll);
      setIsHit(true);
      setDamageText(critRoll ? `💥 -${damage}` : `-${damage}`);

      const msg = getRepMessage(damage, newStreak, critRoll, phaseTimeLeftRef.current, rhythmMult > 1);
      if (gameMessageTimer.current) clearTimeout(gameMessageTimer.current);
      setGameMessage(msg);
      gameMessageTimer.current = setTimeout(() => setGameMessage(null), 1800);

      setTimeout(() => { setIsHit(false); setDamageText(null); setIsCrit(false); }, 400);
    }
  }, [landmarks, started, sessionOver, gameActive, workoutComplete]);

  // Called by MonsterDisplay once the defeat video + CSS fall finish
  const handleDefeatEnd = useCallback(() => {
    setTimeout(() => { setMonsterHP(MONSTER_MAX_HP); setMonsterDefeated(false); }, 1000);
  }, []);

  // Safety fallback: respawn at most 6 s after defeat in case onEnded never fires
  useEffect(() => {
    if (!monsterDefeated) return;
    const fallback = setTimeout(() => { setMonsterHP(MONSTER_MAX_HP); setMonsterDefeated(false); }, 6000);
    return () => clearTimeout(fallback);
  }, [monsterDefeated]);

  const handleStart = useCallback(async () => {
    // Always reset exercise state before (re)starting the camera.
    // If this is a retry, exerciseStateRef may hold a stale _calibStartTime,
    // _standingHipY, _hipYHistory, etc.  The calibration timer uses
    //   elapsed = now - _calibStartTime
    // so a stale timestamp from a previous attempt makes elapsed huge on the
    // very first frame, causing the calibration timeout to fire immediately
    // and skip to gameplay with zero valid baseline values.
    const freshState = createExerciseState(WORKOUT_PHASES[0].exercise);
    exerciseStateRef.current = freshState;
    prevRepRef.current  = 0;
    streakRef.current   = 0;
    lastRepTimeRef.current = Date.now();
    setDisplayState({ ...freshState });
    setGameActive(false);
    setStarted(true);
    await startCamera();
  }, [startCamera]);

  const handleEndSession = useCallback(() => {
    setSessionOver(true);
    stopCamera();
    stopBgMusic();
    const state = loadGameState();
    state.totalCoins += coins;
    state.totalReps += totalReps;
    state.totalCalories = +(state.totalCalories + calories).toFixed(1);
    if (score > state.highScore) state.highScore = score;
    if (bestComboRef.current > state.bestStreak) state.bestStreak = bestComboRef.current;
    saveGameState(state);
  }, [coins, calories, score, totalReps, stopCamera]);

  const [showInstructions, setShowInstructions] = useState(true);

  const handleStartFromInstructions = useCallback(() => {
    startBgMusic(); // called directly in the tap handler — satisfies iOS gesture requirement
    setShowInstructions(false);
    handleStart();
  }, [handleStart]);

  if (sessionOver) {
    const performanceScore = calculatePerformanceScore(totalReps, accuracy, bestCombo);
    const rank = getRank(performanceScore);
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <div className="game-panel p-8 max-w-sm w-full text-center slide-up">
          <div className="text-5xl mb-1">{rank.emoji}</div>
          <p className="font-pixel text-xs text-secondary game-text-shadow mb-1">{rank.label}</p>
          <h2 className="font-pixel text-lg text-foreground game-text-shadow mb-4">Workout Complete!</h2>
          <div className="space-y-2 mb-6">
            <p className="font-body text-sm text-foreground">Performance: <span className="font-pixel text-secondary">{performanceScore}/100</span></p>
            <p className="font-body text-sm text-foreground">Score: <span className="font-pixel text-primary">{score}</span></p>
            <p className="font-body text-sm text-foreground">Reps: <span className="font-pixel text-primary">{totalReps}</span></p>
            <p className="font-body text-sm text-foreground">Accuracy: <span className="font-pixel text-primary">{accuracy}%</span></p>
            <p className="font-body text-sm text-foreground">Damage: <span className="font-pixel text-destructive">{totalDamage}</span></p>
            <p className="font-body text-sm text-foreground">Best Combo: <span className="font-pixel text-secondary">x{bestCombo}</span></p>
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

  if (showInstructions) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background/95 px-6 fade-in">
        <div className="game-panel p-8 max-w-xs w-full text-center">
          <h1 className="font-pixel text-sm text-primary game-text-shadow mb-6 leading-relaxed">
            HOW TO PLAY
          </h1>
          <ul className="space-y-4 mb-8 text-left">
            {[
              ['👤', 'Stand where your full body is visible'],
              ['🦵', 'Do squats to attack the monster'],
              ['💥', 'One full squat = one hit'],
              ['⏱️', 'Defeat the monster before time runs out'],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-start gap-3">
                <span className="text-xl shrink-0">{icon}</span>
                <span className="font-body text-sm text-foreground leading-snug">{text}</span>
              </li>
            ))}
          </ul>
          <Button
            onClick={handleStartFromInstructions}
            className="w-full h-12 font-pixel text-xs bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-transform"
          >
            START
          </Button>
        </div>
      </div>
    );
  }

  if (started && !gameActive) {
    return (
      <>
        <CalibrationScreen
          videoRef={videoRef}
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
      </>
    );
  }

  const hpPercent = Math.max(0, (monsterHP / MONSTER_MAX_HP) * 100);

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <img src={battleBgForest} alt="" className="absolute inset-0 w-full h-full object-cover" />

      <div className="absolute top-3 left-3 z-50">
        <span className="font-pixel text-xs text-foreground game-text-shadow whitespace-nowrap">
          REP:{String(displayState.repCount).padStart(3, '0')}
        </span>
      </div>

      <div className="absolute top-[11vh] left-1/2 -translate-x-1/2 z-40 w-[min(82vw,24rem)] px-2">
        <div className="flex items-center gap-2">
          <span className="font-pixel text-xs text-foreground game-text-shadow">HP</span>
          <div className="flex-1 h-6 border-[3px] border-foreground bg-black">
            <div
              className={`h-full transition-all duration-300 ${hpPercent < 30 ? 'bg-hp-low' : 'bg-hp-bar'}`}
              style={{ width: `${hpPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
        <MonsterDisplay imageKey="monster-tutorial" isHit={isHit} hpPercent={hpPercent} isCrit={isCrit} isDefeated={monsterDefeated} onDefeatEnd={handleDefeatEnd} />
      </div>

      {damageText && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 z-30 animate-bounce">
          <span className="font-pixel text-3xl text-destructive game-text-shadow drop-shadow-lg">{damageText}</span>
        </div>
      )}

      {comboText && (
        <div className="absolute top-[40%] left-1/2 -translate-x-1/2 z-30 animate-bounce">
          <span className="font-pixel text-lg text-secondary game-text-shadow drop-shadow-lg">{comboText}</span>
        </div>
      )}

      {/* DEFEATED text — floats above the monster without covering it */}
      {monsterDefeated && (
        <div className="absolute top-[28%] left-1/2 -translate-x-1/2 z-40 pointer-events-none"
             style={{ animation: 'fadeIn 0.3s ease-out 0.2s both' }}>
          <span className="font-pixel text-2xl text-primary game-text-shadow drop-shadow-lg">💥 DEFEATED!</span>
        </div>
      )}

      {/* Gamified bottom message */}
      <div className="absolute bottom-16 left-4 right-20 z-40">
        <AnimatePresence>
          {gameMessage && (
            <motion.div
              key={gameMessage}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 text-center"
            >
              <span className="font-pixel text-[10px] text-primary game-text-shadow">{gameMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div
        className="timer-hud absolute right-4 z-40 text-right"
        style={{ top: '60%', transform: 'translateY(-50%)', maxWidth: '120px' }}
      >
        <span className="font-pixel text-xs text-game-gold game-text-shadow block">TIME</span>
        <span
          className={`font-pixel text-5xl game-text-shadow italic block ${
            phaseTimeLeft <= 5
              ? 'text-destructive timer-critical'
              : phaseTimeLeft <= 10
              ? 'text-game-warning timer-urgent'
              : 'text-game-gold'
          }`}
        >
          {phaseTimeLeft}
        </span>
      </div>

    </div>
  );
}
