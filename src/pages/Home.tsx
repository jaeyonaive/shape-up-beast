import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { loadGameState, MONSTERS } from '@/lib/game-data';
import monsterTutorial from '@/assets/monster-tutorial.png';
import monsterBoss from '@/assets/monster-boss.png';
import coinImg from '@/assets/coin.png';
import battleBg from '@/assets/battle-bg.jpg';

export default function Home() {
  const navigate = useNavigate();
  const gameState = loadGameState();

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 z-0">
        <img src={battleBg} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0" style={{ background: 'hsl(var(--game-overlay))' }} />
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center px-4 pt-12 pb-8">
        {/* Title */}
        <h1 className="font-pixel text-2xl text-primary game-text-shadow mb-2 text-center">
          FitMon
        </h1>
        <p className="font-pixel text-[10px] text-foreground game-text-shadow mb-8 text-center">
          Battle Monsters with Fitness!
        </p>

        {/* Monster preview */}
        <div className="relative mb-8">
          <img
            src={monsterTutorial}
            alt="Tutorial Monster"
            className="w-40 h-40 object-contain monster-float drop-shadow-2xl"
          />
        </div>

        {/* Stats */}
        <div className="game-panel px-6 py-4 mb-8 w-full max-w-xs">
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
          <div className="flex justify-between items-center">
            <span className="font-body text-sm text-muted-foreground">Monsters Defeated</span>
            <span className="font-pixel text-xs text-primary">{gameState.completedMonsters.length}</span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <Button
            onClick={() => navigate('/tutorial')}
            className="w-full h-14 font-pixel text-xs bg-primary text-primary-foreground hover:bg-primary/90 pulse-glow"
          >
            ⚔️ Start Battle
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/battle/1')}
            className="w-full h-12 font-pixel text-[10px] border-secondary text-secondary hover:bg-secondary/20"
            disabled={!gameState.completedMonsters.includes('bunny')}
          >
            🐉 Boss Battle
          </Button>
        </div>

        {/* Instructions */}
        <div className="mt-auto pt-8">
          <p className="font-body text-xs text-muted-foreground text-center">
            Perform exercises to damage monsters!<br />
            Camera tracks your body movements.
          </p>
        </div>
      </div>
    </div>
  );
}
