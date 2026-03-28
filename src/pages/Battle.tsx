import { useState, useEffect, useRef, useCallback } from 'react';
import { CameraOverlay } from '@/components/game/CameraOverlay';
import { useNavigate } from 'react-router-dom';
import { usePoseDetection } from '@/hooks/usePoseDetection';
import { detectSquat, createInitialSquatState, type SquatState } from '@/lib/squat-detection';
import {
  MONSTER, loadGameState, saveGameState,
  CALORIES_PER_SQUAT, BASE_POINTS_PER_SQUAT, COINS_PER_SQUAT,
  COMBO_TIMEOUT_MS, getComboMultiplier, getComboLabel,
} from '@/lib/game-data';
import { Button } from '@/components/ui/button';
import battleBgForest from '@/assets/battle-bg-forest.jpg';
import coinImg from '@/assets/coin.png';
import monsterTutorial from '@/assets/monster-tutorial.png';

export default function Battle() {
  const navigate = useNavigate();
  const monster = MONSTER;

  const { landmarks, isLoading, error, startCamera, stopCamera, stream } = usePoseDetection();

  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [streak, setStreak] = useState(0);
  const [calories, setCalories] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [isHit, setIsHit] = useState(false);
  const [comboText, setComboText] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [sessionOver, setSessionOver] = useState(false);

  const squatStateRef = useRef<SquatState>(createInitialSquatState());
  const [displayState, setDisplayState] = useState<SquatState>(squatStateRef.current);
  const prevRepRef = useRef(0);
  const lastRepTimeRef = useRef(Date.now());
  const streakRef = useRef(0);

  // Timer
  useEffect(() => {
    if (!gameActive || sessionOver) return;
    const interval = setInterval(() => setElapsed(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [gameActive, sessionOver]);

  // Combo timeout checker
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

  // Pose detection & squat counting
  useEffect(() => {
    if (!landmarks || !started || sessionOver) return;
    const newState = detectSquat(landmarks, squatStateRef.current);
    squatStateRef.current = newState;
    setDisplayState({ ...newState });

    if (newState.calibrated && !gameActive) setGameActive(true);

    if (newState.repCount > prevRepRef.current && gameActive) {
      prevRepRef.current = newState.repCount;
      lastRepTimeRef.current = Date.now();

      // Update streak
      const newStreak = streakRef.current + 1;
      streakRef.current = newStreak;
      setStreak(newStreak);

      const multiplier = getComboMultiplier(newStreak);
      const points = BASE_POINTS_PER_SQUAT * multiplier;
      const earnedCoins = COINS_PER_SQUAT * multiplier;

      setScore(s => s + points);
      setCoins(c => c + earnedCoins);
      setCalories(cal => +(cal + CALORIES_PER_SQUAT).toFixed(1));

      const label = getComboLabel(newStreak);
      if (label) setComboText(label);

      // Monster hit effect
      setIsHit(true);
      setTimeout(() => setIsHit(false), 400);
    }
  }, [landmarks, started, sessionOver, gameActive]);

  const handleStart = useCallback(async () => {
    setStarted(true);
    await startCamera();
  }, [startCamera]);

  const handleEndSession = useCallback(() => {
    setSessionOver(true);
    stopCamera();
    const state = loadGameState();
    state.totalCoins += coins;
    state.totalReps += displayState.repCount;
    state.totalCalories = +(state.totalCalories + calories).toFixed(1);
    if (score > state.highScore) state.highScore = score;
    if (streak > state.bestStreak) state.bestStreak = streak;
    saveGameState(state);
  }, [coins, calories, score, streak, displayState.repCount, stopCamera]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  if (!started) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 gap-6">
        <img src={monsterTutorial} alt={monster.name} className="w-48 h-48 object-contain drop-shadow-2xl monster-float" />
        <div className="text-center">
          <h2 className="font-pixel text-lg text-foreground game-text-shadow mb-2">Endless Squat Mode</h2>
          <p className="font-body text-sm text-muted-foreground mb-2">
            🏋️ Squat to score points!
          </p>
          <p className="font-body text-xs text-muted-foreground mb-6">
            Build combos • Earn coins • Burn calories
          </p>
          <Button onClick={handleStart} disabled={isLoading} className="h-14 px-8 font-pixel text-xs bg-primary text-primary-foreground hover:bg-primary/90 pulse-glow">
            {isLoading ? '⏳ Loading...' : '📷 Start Camera & Go!'}
          </Button>
        </div>
      </div>
    );
  }

  if (sessionOver) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <div className="game-panel p-8 max-w-sm w-full text-center slide-up">
          <div className="text-6xl mb-4">🏆</div>
          <h2 className="font-pixel text-lg text-foreground game-text-shadow mb-2">Session Complete!</h2>
          <div className="space-y-2 mb-6">
            <p className="font-body text-sm text-foreground">Score: <span className="font-pixel text-primary">{score}</span></p>
            <p className="font-body text-sm text-foreground">Reps: <span className="font-pixel text-primary">{displayState.repCount}</span></p>
            <p className="font-body text-sm text-foreground">Best Combo: <span className="font-pixel text-secondary">x{streak}</span></p>
            <p className="font-body text-sm text-foreground">Time: <span className="font-pixel text-foreground">{formatTime(elapsed)}</span></p>
            <p className="font-body text-sm text-foreground">Calories (est.): <span className="font-pixel text-game-gold">{calories} kcal</span></p>
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

        {/* Score & Timer - top bar */}
        <div className="absolute top-4 left-3 right-14 z-20 flex items-center justify-between">
          <div className="game-panel px-3 py-1.5">
            <span className="font-pixel text-xs text-primary">{score} pts</span>
          </div>
          <div className="game-panel px-3 py-1.5">
            <span className="font-pixel text-xs text-foreground">{formatTime(elapsed)}</span>
          </div>
        </div>

        {/* Monster */}
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="relative">
            <img
              src={monsterTutorial}
              alt="Monster"
              className={`w-80 h-80 object-contain drop-shadow-2xl ${isHit ? '' : 'monster-float'}`}
              style={isHit ? { filter: 'brightness(2) hue-rotate(30deg)', transform: 'scale(1.1)' } : {}}
            />
          </div>
        </div>

        {/* Combo text */}
        {comboText && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 animate-bounce">
            <span className="font-pixel text-lg text-secondary game-text-shadow drop-shadow-lg">{comboText}</span>
          </div>
        )}

        {/* Bottom stats bar */}
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
