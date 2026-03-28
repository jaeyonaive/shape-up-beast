interface BodySilhouetteProps {
  visible: boolean;
  bodyDetected: boolean;
  kneesVisible: boolean;
}

export function BodySilhouette({ visible, bodyDetected, kneesVisible }: BodySilhouetteProps) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <svg
        viewBox="0 0 200 440"
        className="h-[75%] opacity-40"
        fill="none"
        stroke={bodyDetected ? 'hsl(145, 80%, 50%)' : 'hsl(0, 0%, 70%)'}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Head */}
        <circle cx="100" cy="40" r="22" strokeDasharray={bodyDetected ? "0" : "6 4"} />
        {/* Neck */}
        <line x1="100" y1="62" x2="100" y2="80" />
        {/* Shoulders */}
        <line x1="60" y1="100" x2="140" y2="100" />
        {/* Torso left */}
        <line x1="100" y1="80" x2="60" y2="100" />
        <line x1="100" y1="80" x2="140" y2="100" />
        {/* Arms */}
        <line x1="60" y1="100" x2="42" y2="170" />
        <line x1="42" y1="170" x2="35" y2="220" />
        <line x1="140" y1="100" x2="158" y2="170" />
        <line x1="158" y1="170" x2="165" y2="220" />
        {/* Torso body */}
        <line x1="60" y1="100" x2="70" y2="210" />
        <line x1="140" y1="100" x2="130" y2="210" />
        {/* Hips */}
        <line x1="70" y1="210" x2="130" y2="210" />
        {/* Legs - highlight if knees not visible */}
        <line
          x1="70" y1="210" x2="65" y2="310"
          stroke={!kneesVisible ? 'hsl(0, 80%, 60%)' : undefined}
          strokeWidth={!kneesVisible ? "3.5" : undefined}
        />
        <line
          x1="130" y1="210" x2="135" y2="310"
          stroke={!kneesVisible ? 'hsl(0, 80%, 60%)' : undefined}
          strokeWidth={!kneesVisible ? "3.5" : undefined}
        />
        {/* Knee circles */}
        <circle
          cx="65" cy="310" r="6"
          stroke={!kneesVisible ? 'hsl(0, 80%, 60%)' : undefined}
          strokeWidth={!kneesVisible ? "3" : undefined}
          strokeDasharray={!kneesVisible ? "4 3" : "0"}
        />
        <circle
          cx="135" cy="310" r="6"
          stroke={!kneesVisible ? 'hsl(0, 80%, 60%)' : undefined}
          strokeWidth={!kneesVisible ? "3" : undefined}
          strokeDasharray={!kneesVisible ? "4 3" : "0"}
        />
        {/* Lower legs */}
        <line x1="65" y1="316" x2="60" y2="400" />
        <line x1="135" y1="316" x2="140" y2="400" />
        {/* Feet */}
        <line x1="60" y1="400" x2="45" y2="410" />
        <line x1="140" y1="400" x2="155" y2="410" />
      </svg>
    </div>
  );
}
