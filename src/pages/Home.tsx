import { useNavigate } from 'react-router-dom';
import titleBg from '@/assets/title-screen-bg.png';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* The entire title screen IS the user's image — it contains the PLAY button already */}
      <img
        src={titleBg}
        alt="Fitnasia"
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Invisible tap target over the existing PLAY button in the design (centered, ~45-55% from top) */}
      <button
        onClick={() => navigate('/battle/0')}
        className="absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2 w-40 h-16 z-10"
        aria-label="Start Game"
      />
      {/* Invisible tap target for "How to Play" — below the play button area */}
      <button
        onClick={() => navigate('/tutorial')}
        className="absolute left-1/2 top-[58%] -translate-x-1/2 -translate-y-1/2 w-40 h-10 z-10 opacity-0"
        aria-label="How to Play"
      />
    </div>
  );
}
