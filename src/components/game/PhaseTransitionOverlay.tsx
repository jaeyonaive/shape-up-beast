import { useState, useEffect } from 'react';

interface PhaseTransitionOverlayProps {
  emoji: string;
  label: string;
}

export function PhaseTransitionOverlay({ emoji, label }: PhaseTransitionOverlayProps) {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(interval);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
      <div className="text-center animate-in fade-in zoom-in duration-300">
        <p className="font-pixel text-xs text-muted-foreground mb-2 tracking-widest uppercase">Next up</p>
        <div className="text-6xl mb-4 animate-bounce">{emoji}</div>
        <h2 className="font-pixel text-2xl text-primary game-text-shadow mb-6">{label}</h2>
        {countdown > 0 ? (
          <div className="relative">
            <span className="font-pixel text-6xl text-foreground game-text-shadow animate-pulse">
              {countdown}
            </span>
          </div>
        ) : (
          <span className="font-pixel text-3xl text-primary game-text-shadow animate-bounce">GO!</span>
        )}
      </div>
    </div>
  );
}
