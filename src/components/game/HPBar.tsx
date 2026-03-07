import { cn } from '@/lib/utils';

interface HPBarProps {
  current: number;
  max: number;
  name: string;
}

export function HPBar({ current, max, name }: HPBarProps) {
  const percentage = Math.max(0, (current / max) * 100);
  const isLow = percentage < 30;

  return (
    <div className="game-panel px-4 py-3 slide-up">
      <p className="font-pixel text-xs text-center text-foreground mb-2 game-text-shadow">{name}</p>
      <div className="flex items-center gap-2">
        <span className="font-pixel text-[10px] text-foreground game-text-shadow">HP</span>
        <div className="flex-1 h-5 rounded-sm bg-hp-bg border-2 border-border overflow-hidden">
          <div
            className={cn(
              'h-full hp-bar-animate rounded-sm',
              isLow ? 'bg-hp-low' : 'bg-hp-bar'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
