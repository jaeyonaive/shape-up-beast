interface BodySilhouetteProps {
  visible: boolean;
  bodyDetected: boolean;
  kneesVisible: boolean;
  proximityHint?: string | null;
}

export function BodySilhouette({ visible, bodyDetected, kneesVisible, proximityHint }: BodySilhouetteProps) {
  if (!visible) return null;

  const strokeColor = bodyDetected
    ? 'hsl(145, 80%, 50%)'
    : 'hsl(0, 0%, 70%)';

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      {/* Bounding box guide */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: '50%', height: '85%' }}
      >
        {/* Corner markers */}
        <div className="absolute inset-0">
          {/* Top-left */}
          <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 rounded-tl-md" style={{ borderColor: strokeColor }} />
          {/* Top-right */}
          <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 rounded-tr-md" style={{ borderColor: strokeColor }} />
          {/* Bottom-left */}
          <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 rounded-bl-md" style={{ borderColor: strokeColor }} />
          {/* Bottom-right */}
          <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 rounded-br-md" style={{ borderColor: strokeColor }} />
        </div>

        {/* Silhouette */}
        <svg
          viewBox="0 0 200 440"
          className="h-[70%] opacity-30"
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="100" cy="40" r="22" strokeDasharray={bodyDetected ? "0" : "6 4"} />
          <line x1="100" y1="62" x2="100" y2="80" />
          <line x1="60" y1="100" x2="140" y2="100" />
          <line x1="100" y1="80" x2="60" y2="100" />
          <line x1="100" y1="80" x2="140" y2="100" />
          <line x1="60" y1="100" x2="42" y2="170" />
          <line x1="42" y1="170" x2="35" y2="220" />
          <line x1="140" y1="100" x2="158" y2="170" />
          <line x1="158" y1="170" x2="165" y2="220" />
          <line x1="60" y1="100" x2="70" y2="210" />
          <line x1="140" y1="100" x2="130" y2="210" />
          <line x1="70" y1="210" x2="130" y2="210" />
          <line x1="70" y1="210" x2="65" y2="310"
            stroke={!kneesVisible ? 'hsl(0, 80%, 60%)' : undefined}
            strokeWidth={!kneesVisible ? "3.5" : undefined}
          />
          <line x1="130" y1="210" x2="135" y2="310"
            stroke={!kneesVisible ? 'hsl(0, 80%, 60%)' : undefined}
            strokeWidth={!kneesVisible ? "3.5" : undefined}
          />
          <circle cx="65" cy="310" r="6"
            stroke={!kneesVisible ? 'hsl(0, 80%, 60%)' : undefined}
            strokeDasharray={!kneesVisible ? "4 3" : "0"}
          />
          <circle cx="135" cy="310" r="6"
            stroke={!kneesVisible ? 'hsl(0, 80%, 60%)' : undefined}
            strokeDasharray={!kneesVisible ? "4 3" : "0"}
          />
          <line x1="65" y1="316" x2="60" y2="400" />
          <line x1="135" y1="316" x2="140" y2="400" />
          <line x1="60" y1="400" x2="45" y2="410" />
          <line x1="140" y1="400" x2="155" y2="410" />
        </svg>
      </div>

      {/* Proximity / positioning hint */}
      {proximityHint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-background/80 backdrop-blur-sm border border-border rounded-lg px-4 py-2">
          <p className="font-body text-xs text-foreground text-center">{proximityHint}</p>
        </div>
      )}
    </div>
  );
}
