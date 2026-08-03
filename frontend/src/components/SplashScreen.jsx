import React, { useEffect, useState } from 'react';

/**
 * Génère le son "ta-dum" style Netflix via Web Audio API.
 * Deux notes graves avec un léger glissement de fréquence.
 */
const playTaDum = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    // Note 1 : "ta" — grave, courte
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(110, now);      // La1
    osc1.frequency.exponentialRampToValueAtTime(82.41, now + 0.15); // Mi1
    gain1.gain.setValueAtTime(0.4, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Note 2 : "dum" — plus grave, plus longue
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(82.41, now + 0.2); // Mi1
    osc2.frequency.exponentialRampToValueAtTime(55, now + 0.6); // La0
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(0.5, now + 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.2);
    osc2.stop(now + 0.7);

    // Sous-bass pour l'impact
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(55, now + 0.2);
    sub.frequency.exponentialRampToValueAtTime(30, now + 0.8);
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.setValueAtTime(0.35, now + 0.2);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    sub.connect(subGain).connect(ctx.destination);
    sub.start(now + 0.2);
    sub.stop(now + 0.8);

    // Fermer le contexte après le son
    setTimeout(() => ctx.close(), 1200);
  } catch {
    // Web Audio non supporté — pas grave
  }
};

/**
 * Splash screen style Netflix — s'affiche après connexion réussie.
 * Animation du logo DocuFlow avec fond flou et couleurs fidèles au site.
 *
 * @param {Function} onComplete - Callback appelé après l'animation (redirection dashboard)
 */
const SplashScreen = ({ onComplete }) => {
  const [phase, setPhase] = useState('zoom'); // zoom → fadeOut → done

  useEffect(() => {
    // Jouer le son "ta-dum" immédiatement
    playTaDum();

    // Phase 1 : Zoom (1.6s)
    const zoomTimer = setTimeout(() => {
      setPhase('fadeOut');
    }, 1600);

    // Phase 2 : Fade out (800ms) → done
    const fadeTimer = setTimeout(() => {
      setPhase('done');
      onComplete?.();
    }, 2400);

    return () => {
      clearTimeout(zoomTimer);
      clearTimeout(fadeTimer);
    };
  }, [onComplete]);

  if (phase === 'done') return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-800 ${
        phase === 'fadeOut' ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(24px)',
      }}
    >
      {/* Halo lumineux bleu DocuFlow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="w-[600px] h-[600px] rounded-full animate-pulse"
          style={{
            background: 'radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, rgba(59, 130, 246, 0.1) 40%, transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
      </div>

      <div
        className={phase === 'zoom' ? 'splash-zoom' : 'splash-visible'}
      >
        {/* Logo DocuFlow avec effets */}
        <div className="relative">
          {/* Halo derrière le texte */}
          <div
            className="absolute -inset-16 rounded-full animate-pulse"
            style={{
              background: 'radial-gradient(circle, rgba(59, 130, 246, 0.3) 0%, rgba(59, 130, 246, 0.15) 40%, transparent 70%)',
              filter: 'blur(30px)',
            }}
          />

          {/* Texte DocuFlow */}
          <div className="relative text-center">
            <h1
              className="font-black tracking-tighter"
              style={{
                fontSize: 'clamp(4rem, 15vw, 12rem)',
                color: '#ffffff',
                textShadow: '0 0 60px rgba(59, 130, 246, 0.6), 0 0 100px rgba(59, 130, 246, 0.4), 0 4px 20px rgba(0, 0, 0, 0.3)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                letterSpacing: '-0.05em',
                fontWeight: 900,
              }}
            >
              DocuFlow
            </h1>

            {/* Ligne dorée subtile */}
            <div
              className="mx-auto mt-4 h-1 rounded-full"
              style={{
                width: '80px',
                background: 'linear-gradient(90deg, transparent, #d4af37, transparent)',
              }}
            />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes netflixZoom {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .splash-zoom {
          animation: netflixZoom 1.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .splash-visible {
          transform: scale(1);
          opacity: 1;
        }
      `}</style>
    </div>
  );
};

export default SplashScreen;
