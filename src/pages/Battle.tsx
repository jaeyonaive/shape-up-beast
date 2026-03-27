import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePoseDetection } from '@/hooks/usePoseDetection';
import { detectSquat, createInitialSquatState, type SquatState } from '@/lib/squat-detection';
import { MONSTERS, loadGameState, saveGameState } from '@/lib/game-data';
import { HPBar } from '@/components/game/HPBar';
import { Button } from '@/components/ui/button';
import battleBg from '@/assets/battle-bg.jpg';
import coinImg from '@/assets/coin.png';
import monsterTutorial from '@/assets/monster-tutorial.png';
import monsterBoss from '@/assets/monster-boss.png';

const monsterImages: Record<string, string> = {
  'monster-tutorial': monsterTutorial,
  'monster-boss': monsterBoss,
};

export default function Battle() {
  const { monsterId } = useParams();
  const navigate = useNavigate();
  const monsterIndex = parseInt(monsterId || '0', 10);
  const monster = MONSTERS[monsterIndex];

  const { landmarks, isLoading, error, cameraActive, startCamera, stopCamera } = usePoseDetection();

  const [hp, setHp] = useState(monster?.maxHp || 100);
  const [timeLeft, setTimeLeft] = useState(monster?.timeLimit || 60);
  const [coins, setCoins] = useState(0);
  const [streak, setStreak] = useState(0);
  const [isHit, setIsHit] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [victory, setVictory] = useState(false);
  const [started, setStarted] = useState(false);
  const [gameActive, setGameActive] = useState(false); // true after calibration

  const squatStateRef = useRef<SquatState>(createInitialSquatState());
  const [displayState, setDisplayState] = useState<SquatState>(squatStateRef.current);
  const prevRepRef = useRef(0);

  // Timer — only runs after calibration
  useEffect(() => {
    if (!gameActive || gameOver || victory) return;
    if (timeLeft <= 0) {
      setGameOver(true);
      return;
    }
    const interval = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(interval);
  }, [gameActive, timeLeft, gameOver, victory]);

  // Pose detection -> squat detection
  useEffect(() => {
    if (!landmarks || !started || gameOver || victory) return;

    const newState = detectSquat(landmarks, squatStateRef.current);
    squatStateRef.current = newState;
    setDisplayState({ ...newState });

    // Start game timer once calibrated
    if (newState.calibrated && !gameActive) {
      setGameActive(true);
    }

    // Check for new rep
    if (newState.repCount > prevRepRef.current && gameActive) {
      prevRepRef.current = newState.repCount;
      const damagePerRep = monster.maxHp / monster.repsToKill;
      setHp(prev => {
        const newHp = Math.max(0, prev - damagePerRep);
        if (newHp <= 0) {
          setVictory(true);
          setCoins(monster.goldReward);
          const state = loadGameState();
          state.totalCoins += monster.goldReward;
          state.totalReps += newState.repCount;
          if (!state.completedMonsters.includes(monster.id)) {
            state.completedMonsters.push(monster.id);
          }
          saveGameState(state);
        }
        return newHp;
      });
      setIsHit(true);
      setStreak(s => s + 1);
      setTimeout(() => setIsHit(false), 300);
    }
  }, [landmarks, started, gameOver, victory, monster, gameActive]);

  const handleStart = useCallback(async () => {
    await startCamera();
    setStarted(true);
  }, [startCamera]);

  if (!monster) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="font-pixel text-sm text-foreground">Monster not found</p>
      </div>
    );
  }

  // Pre-start screen
  if (!started) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <img src={monsterImages[monster.image]} alt={monster.name} className="w-56 h-56 object-contain drop-shadow-2xl monster-float" />
        <div className="relative z-20 mt-64 text-center">
          <h2 className="font-pixel text-lg text-foreground game-text-shadow mb-2">{monster.name}</h2>
          <p className="font-body text-sm text-muted-foreground mb-2">
            {monster.isBoss ? '🐉 BOSS BATTLE' : '⚔️ Battle'} — {monster.exercise}
          </p>
          <p className="font-body text-sm text-muted-foreground mb-6">
            {monster.repsToKill} reps to defeat • {monster.timeLimit}s time limit
          </p>
          <Button
            onClick={handleStart}
            className="h-14 px-8 font-pixel text-xs bg-primary text-primary-foreground hover:bg-primary/90 pulse-glow"
          >
            📷 Start Camera & Fight!
          </Button>
        </div>
      </div>
    );
  }

  // Victory / Game Over
  if (victory || gameOver) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <div className="game-panel p-8 max-w-sm w-full text-center slide-up">
          <div className="text-6xl mb-4">{victory ? '🎉' : '💀'}</div>
          <h2 className="font-pixel text-lg text-foreground game-text-shadow mb-2">
            {victory ? 'Victory!' : 'Time\'s Up!'}
          </h2>
          <p className="font-body text-sm text-muted-foreground mb-4">
            {victory ? `You defeated ${monster.name}!` : `${monster.name} survived! Try again!`}
          </p>
          <div className="space-y-2 mb-6">
            <p className="font-body text-sm text-foreground">
              Reps: <span className="font-pixel text-primary">{displayState.repCount}</span>
            </p>
            <p className="font-body text-sm text-foreground">
              Form: <span className="font-pixel" style={{
                color: displayState.formScore >= 80 ? 'hsl(var(--game-success))' :
                       displayState.formScore >= 50 ? 'hsl(var(--game-gold))' :
                       'hsl(var(--game-warning))'
              }}>{displayState.formScore}%</span>
            </p>
            {victory && (
              <p className="font-body text-sm text-game-gold">+{monster.goldReward}G earned!</p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={() => navigate('/')} className="w-full h-12 font-pixel text-xs bg-primary text-primary-foreground hover:bg-primary/90">🏠 Home</Button>
            {!victory && <Button variant="outline" onClick={() => window.location.reload()} className="w-full h-12 font-body font-semibold border-border text-foreground">🔄 Retry</Button>}
            {victory && monsterIndex < MONSTERS.length - 1 && (
              <Button variant="outline" onClick={() => navigate(`/battle/${monsterIndex + 1}`)} className="w-full h-12 font-pixel text-[10px] border-secondary text-secondary">⚔️ Next Monster</Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── MAIN GAME SCREEN (no camera visible) ──────────────────────────
  return (
    <div className="h-screen w-screen relative overflow-hidden flex flex-col">
      {/* Video + canvas are created programmatically by usePoseDetection */}

      {/* Full-screen battle background */}
      <img
        src={battleBg}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Back button */}
      <button
        onClick={() => { stopCamera(); navigate('/'); }}
        className="absolute top-5 right-3 z-30 w-10 h-10 rounded-full bg-muted/80 flex items-center justify-center"
      >
        <span className="text-foreground text-lg">✕</span>
      </button>

      {/* HP Bar */}
      <div className="absolute top-4 left-3 right-14 z-20">
        <HPBar current={hp} max={monster.maxHp} name={monster.name} />
      </div>

      {/* Monster - centered */}
      <div className="flex-1 flex items-center justify-center z-10 pointer-events-none">
        <img
          src={monsterImages[monster.image]}
          alt="Monster"
          className={`w-72 h-72 object-contain drop-shadow-2xl ${isHit ? 'monster-hit' : 'monster-float'}`}
        />
      </div>

      {/* Bottom HUD */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pb-6 px-4">
        {/* Calibration overlay */}
        {!gameActive && (
          <div className="mb-4 p-4 rounded-2xl bg-background/80 backdrop-blur-sm border border-border text-center">
            <p className="font-pixel text-xs text-primary mb-2">CALIBRATING</p>
            <p className="font-body text-sm text-foreground mb-2">{displayState.feedback}</p>
            {/* Progress bar */}
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${displayState.calibrationProgress ?? 0}%` }}
              />
            </div>
            <p className="font-body text-xs text-muted-foreground mt-1">
              {displayState.calibrationProgress ?? 0}%
            </p>
          </div>
        )}

        {/* Game stats bar */}
        {gameActive && (
          <div className="space-y-3">
            {/* Feedback */}
            <div className={`p-3 rounded-xl text-center backdrop-blur-sm ${
              displayState.formQuality === 'good' ? 'bg-green-500/20 border border-green-500/40' :
              displayState.formQuality === 'needs_work' ? 'bg-yellow-500/20 border border-yellow-500/40' :
              'bg-background/60 border border-border'
            }`}>
              <p className="font-body text-sm font-semibold text-foreground game-text-shadow">
                {displayState.feedback}
              </p>
            </div>

            {/* Stats row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">💪</span>
                <span className="font-pixel text-lg text-foreground game-text-shadow">{displayState.repCount}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-2xl">⏱</span>
                <span className="font-pixel text-lg text-foreground game-text-shadow">{timeLeft}s</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-2xl">🔥</span>
                <span className="font-pixel text-lg text-foreground game-text-shadow">{streak}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <img src={coinImg} alt="coins" className="w-7 h-7" />
                <span className="font-pixel text-sm text-game-gold game-text-shadow">{coins}G</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-spin">⏳</div>
            <p className="font-pixel text-xs text-foreground">Loading pose detection...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
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
