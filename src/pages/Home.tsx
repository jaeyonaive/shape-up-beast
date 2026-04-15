import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import titleBg from '@/assets/title-screen-bg.png';
import { startBgMusic } from '@/lib/bgMusic';
import { StatsOverlay } from '@/components/StatsOverlay';

export default function Home() {
  const navigate = useNavigate();
  const [showStats, setShowStats] = useState(false);

  return (
    <div className="min-h-screen relative overflow-hidden bg-black">
      {/* Background image — covers full screen, preserving design */}
      <img
        src={titleBg}
        alt="Fitnasia"
        className="absolute inset-0 w-full h-full object-cover title-entrance"
      />

      {/* Animated cloud overlays — subtle pixel-art drift */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-[1]">
        <div className="cloud-drift-1 absolute" style={{ top: '8%', width: '22vw', height: '10vh', opacity: 0.45 }}>
          <div className="w-full h-full bg-white/30 rounded-full blur-sm" />
        </div>
        <div className="cloud-drift-2 absolute" style={{ top: '15%', width: '16vw', height: '7vh', opacity: 0.35 }}>
          <div className="w-full h-full bg-white/25 rounded-full blur-sm" />
        </div>
      </div>

      {/* Grass sway overlay at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-[12vh] pointer-events-none z-[2] grass-sway" />

      {/* Play button overlay — positioned over the red PLAY button in the design */}
      <button
        onClick={() => { startBgMusic(); navigate('/battle/0'); }}
        className="absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2 w-[42vw] h-[7vh] z-10 active:scale-95 transition-transform duration-150 rounded-full"
        aria-label="Start Game"
      />

      {/* Stats button — bottom-right corner, unobtrusive */}
      <button
        onClick={() => setShowStats(true)}
        className="absolute bottom-4 right-4 z-10 font-pixel text-[9px] text-white/60 hover:text-white/90 active:scale-95 transition-all"
        aria-label="View Stats"
      >
        📊 STATS
      </button>

      {showStats && <StatsOverlay onClose={() => setShowStats(false)} />}
    </div>
  );
}
