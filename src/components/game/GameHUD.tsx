import coinImg from '@/assets/coin.png';

interface GameHUDProps {
  timeLeft: number;
  streak: number;
  coins: number;
  reps: number;
  feedback: string;
  formQuality: 'good' | 'needs_work' | 'neutral';
}

export function GameHUD({ timeLeft, streak, coins, reps, feedback, formQuality }: GameHUDProps) {
  return (
    <>
      {/* Left side HUD */}
      <div className="absolute top-32 left-3 flex flex-col gap-2 z-20">
        {/* Timer */}
        <div className="flex items-center gap-1.5">
          <div className="w-8 h-8 rounded-full bg-game-timer flex items-center justify-center">
            <span className="font-pixel text-[8px] text-foreground">⏱</span>
          </div>
          <span className="font-pixel text-sm text-foreground game-text-shadow">{timeLeft}s</span>
        </div>

        {/* Streak */}
        <div className="flex items-center gap-1.5">
          <span className="text-2xl">🔥</span>
          <span className="font-pixel text-sm text-foreground game-text-shadow">{streak}</span>
        </div>

        {/* Reps */}
        <div className="flex items-center gap-1.5">
          <span className="text-2xl">💪</span>
          <span className="font-pixel text-sm text-foreground game-text-shadow">{reps}</span>
        </div>
      </div>

      {/* Coins - bottom left */}
      <div className="absolute bottom-6 left-3 flex items-center gap-1.5 z-20">
        <img src={coinImg} alt="coins" className="w-8 h-8" />
        <span className="font-pixel text-sm text-game-gold game-text-shadow">{coins}G</span>
      </div>

      {/* Feedback - bottom center */}
      {feedback && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
          <div className={`game-panel px-4 py-2 ${
            formQuality === 'good' ? 'border-game-success' :
            formQuality === 'needs_work' ? 'border-game-warning' :
            'border-border'
          }`} style={
            formQuality === 'good' ? { borderColor: 'hsl(var(--game-success))' } :
            formQuality === 'needs_work' ? { borderColor: 'hsl(var(--game-warning))' } :
            {}
          }>
            <p className="font-body text-sm font-semibold text-foreground text-center game-text-shadow">
              {feedback}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
