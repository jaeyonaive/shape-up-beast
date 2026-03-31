import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import titleBg from '@/assets/title-screen-bg.png';

export default function Home() {
  const navigate = useNavigate();
  const [pressing, setPressing] = useState<string | null>(null);

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center">
      {/* Full-screen background from user's design */}
      <img
        src={titleBg}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Overlay to darken slightly for button readability */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Buttons positioned in center-lower area */}
      <div className="relative z-10 flex flex-col items-center gap-4 mt-[55%]">
        {/* Start Game button - styled like the red "PLAY" button in the design */}
        <button
          onClick={() => navigate('/battle/0')}
          onPointerDown={() => setPressing('start')}
          onPointerUp={() => setPressing(null)}
          onPointerLeave={() => setPressing(null)}
          className={`
            px-10 py-4 rounded-full font-pixel text-sm text-foreground
            bg-gradient-to-b from-destructive to-destructive/80
            border-4 border-destructive/60
            shadow-lg shadow-destructive/40
            transition-all duration-150
            hover:scale-105 hover:shadow-xl hover:shadow-destructive/50
            active:scale-95
            ${pressing === 'start' ? 'scale-95 brightness-90' : ''}
          `}
          style={{
            textShadow: '2px 2px 0px rgba(0,0,0,0.5)',
          }}
        >
          START GAME
        </button>

        {/* Secondary buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/tutorial')}
            onPointerDown={() => setPressing('how')}
            onPointerUp={() => setPressing(null)}
            onPointerLeave={() => setPressing(null)}
            className={`
              px-5 py-2.5 rounded-lg font-pixel text-[8px] text-foreground
              bg-muted/80 backdrop-blur-sm border-2 border-border
              transition-all duration-150
              hover:scale-105 hover:bg-muted
              active:scale-95
              ${pressing === 'how' ? 'scale-95' : ''}
            `}
          >
            HOW TO PLAY
          </button>
        </div>
      </div>
    </div>
  );
}
