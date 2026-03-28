import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { loadGameState } from '@/lib/game-data';
import monsterTutorial from '@/assets/monster-tutorial.png';
import coinImg from '@/assets/coin.png';
import battleBg from '@/assets/battle-bg.jpg';

export default function Home() {
  const navigate = useNavigate();
  const gameState = loadGameState();

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img src={battleBg} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0" style={{ background: 'hsl(var(--game-overlay))' }} />
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center px-4 pt-12 pb-8">
        <h1 className="font-pixel text-2xl text-primary game-text-shadow mb-2 text-center">Fitnasia</h1>
        <p className="font-pixel text-[10px] text-foreground game-text-shadow mb-8 text-center">
          Squat Your Way to Glory!
        </p>

        <div className="relative mb-8">
          <img src={monsterTutorial} alt="Brawler Bunny" className="w-40 h-40 object-contain monster-float drop-shadow-2xl" />
        </div>

        <div className="game-panel px-6 py-4 mb-8 w-full max-w-xs">
          <div className="flex justify-between items-center mb-3">
            <span className="font-body text-sm text-muted-foreground">High Score</span>
            <span className="font-pixel text-xs text-primary">{gameState.highScore}</span>
          </div>
          <div className="flex justify-between items-center mb-3">
            <span className="font-body text-sm text-muted-foreground">Total Coins</span>
            <div className="flex items-center gap-1">
              <img src={coinImg} alt="coins" className="w-5 h-5" />
              <span className="font-pixel text-xs text-game-gold">{gameState.totalCoins}G</span>
            </div>
          </div>
          <div className="flex justify-between items-center mb-3">
            <span className="font-body text-sm text-muted-foreground">Total Reps</span>
            <span className="font-pixel text-xs text-foreground">{gameState.totalReps}</span>
          </div>
          <div className="flex justify-between items-center mb-3">
            <span className="font-body text-sm text-muted-foreground">Best Streak</span>
            <span className="font-pixel text-xs text-secondary">{gameState.bestStreak}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-body text-sm text-muted-foreground">Calories Burned</span>
            <span className="font-pixel text-xs text-game-gold">{gameState.totalCalories} kcal</span>
          </div>
        </div>

        <Button
          onClick={() => navigate('/battle/0')}
          className="w-full max-w-xs h-14 font-pixel text-xs bg-primary text-primary-foreground hover:bg-primary/90 pulse-glow"
        >
          🏋️ Start Squat Session
        </Button>

        <div className="mt-auto pt-8">
          <p className="font-body text-xs text-muted-foreground text-center">
            Build combos for bonus points!<br />
            Camera tracks your body movements.
          </p>
        </div>
      </div>
    </div>
  );
}
