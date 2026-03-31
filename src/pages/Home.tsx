import { useNavigate } from 'react-router-dom';
import titleBg from '@/assets/title-screen-bg.png';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen relative overflow-hidden bg-black">
      {/* Base background image — the user's exact design, preserved at original aspect ratio */}
      <img
        src={titleBg}
        alt="Fitnasia"
        className="absolute inset-0 w-full h-full object-cover title-entrance"
      />

      {/* Animated cloud overlays — pixel-art style, slow horizontal drift */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-[1]">
        <div className="cloud-drift-1 absolute" style={{ top: '6%', width: '25vw', height: '12vh', opacity: 0.6 }}>
          <div className="w-full h-full bg-white/30 rounded-full blur-[2px]" style={{ imageRendering: 'pixelated' }} />
        </div>
        <div className="cloud-drift-2 absolute" style={{ top: '14%', width: '18vw', height: '9vh', opacity: 0.4 }}>
          <div className="w-full h-full bg-white/25 rounded-full blur-[2px]" style={{ imageRendering: 'pixelated' }} />
        </div>
      </div>

      {/* Subtle grass sway overlay at the bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-[15vh] pointer-events-none z-[2] grass-sway" />

      {/* Invisible tap target over existing PLAY button in the design (~55-60% from top) */}
      <button
        onClick={() => navigate('/battle/0')}
        className="absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2 w-[45vw] h-[8vh] z-10 active:scale-95 transition-transform duration-150"
        aria-label="Start Game"
      />
      {/* Invisible tap target for "How to Play" — below the play button */}
      <button
        onClick={() => navigate('/tutorial')}
        className="absolute left-1/2 top-[65%] -translate-x-1/2 -translate-y-1/2 w-[40vw] h-[6vh] z-10 active:scale-95 transition-transform duration-150"
        aria-label="How to Play"
      />
    </div>
  );
}
