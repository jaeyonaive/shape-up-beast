import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import monsterTutorial from '@/assets/monster-tutorial.png';

const STEPS = [
  {
    title: 'Welcome, Fighter!',
    body: 'Fitnasia uses your phone camera to track your exercises. Each correct rep damages the monster!',
    icon: '⚔️',
  },
  {
    title: 'How Squats Work',
    body: 'Stand facing the camera. Bend your knees and lower your hips until your thighs are parallel to the ground. Then stand back up. That\'s 1 rep!',
    icon: '🏋️',
  },
  {
    title: 'Camera Tips',
    body: 'Make sure your full body is visible in the camera. Stand about 6 feet away. Good lighting helps detection!',
    icon: '📷',
  },
  {
    title: 'Ready to Fight?',
    body: 'Defeat Brawler Bunny by doing 10 squats! You have 60 seconds. Let\'s go!',
    icon: '🔥',
  },
];

export default function Tutorial() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const current = STEPS[step];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 pt-12 pb-8">
      {/* Progress dots */}
      <div className="flex gap-2 mb-8">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full transition-colors ${
              i === step ? 'bg-primary' : 'bg-muted'
            }`}
          />
        ))}
      </div>

      {/* Icon */}
      <div className="text-6xl mb-6">{current.icon}</div>

      {/* Monster image on last step */}
      {step === STEPS.length - 1 && (
        <img
          src={monsterTutorial}
          alt="Brawler Bunny"
          className="w-32 h-32 object-contain monster-float mb-4"
        />
      )}

      {/* Content */}
      <div className="game-panel p-6 w-full max-w-sm mb-8 slide-up">
        <h2 className="font-pixel text-sm text-primary mb-4 text-center game-text-shadow">
          {current.title}
        </h2>
        <p className="font-body text-base text-foreground text-center leading-relaxed">
          {current.body}
        </p>
      </div>

      {/* Navigation */}
      <div className="flex gap-3 w-full max-w-sm mt-auto">
        {step > 0 && (
          <Button
            variant="outline"
            onClick={() => setStep(step - 1)}
            className="flex-1 h-12 font-body font-semibold border-border text-foreground"
          >
            Back
          </Button>
        )}
        <Button
          onClick={() => {
            if (step < STEPS.length - 1) {
              setStep(step + 1);
            } else {
              navigate('/battle/0');
            }
          }}
          className="flex-1 h-12 font-pixel text-xs bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {step < STEPS.length - 1 ? 'Next' : '⚔️ Fight!'}
        </Button>
      </div>
    </div>
  );
}
