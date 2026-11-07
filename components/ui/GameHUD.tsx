'use client';

// ============================================================
// FART MAN — GameHUD  (with live player count)
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { GAME_CONFIG } from '@/lib/gameConfig';

interface GameHUDProps {
  score: number;
  bestScore: number;
  gasMeter: number;
  boostActive: boolean;
  boostRemaining: number;
  isMuted: boolean;
  playerCount: number;
  onPause: () => void;
  onToggleMute: () => void;
}

export default function GameHUD({
  score,
  bestScore,
  gasMeter,
  boostActive,
  boostRemaining,
  isMuted,
  playerCount,
  onPause,
  onToggleMute,
}: GameHUDProps) {
  const [scoreFlash, setScoreFlash] = useState(false);
  const prevScoreRef = useRef(score);

  useEffect(() => {
    if (score !== prevScoreRef.current) {
      prevScoreRef.current = score;
      setScoreFlash(true);
      const t = setTimeout(() => setScoreFlash(false), 300);
      return () => clearTimeout(t);
    }
  }, [score]);

  const gasPct   = (gasMeter / GAME_CONFIG.GAS_METER_MAX) * 100;
  const boostPct = boostActive
    ? (boostRemaining / GAME_CONFIG.GAS_BOOST_DURATION) * 100
    : 0;
  const nearFull = gasPct >= 80 && !boostActive;

  return (
    <div className="absolute inset-0 pointer-events-none select-none z-20">

      {/* ── Top bar ── */}
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between px-3 pt-3 gap-2">

        {/* Score */}
        <div className="flex flex-col items-center bg-black/50 backdrop-blur-sm rounded-2xl px-3 py-1 min-w-[58px] border border-white/10">
          <span className="text-white/60 text-[9px] font-bold tracking-widest">SCORE</span>
          <span
            className="font-black leading-none transition-all duration-150"
            style={{
              fontSize: 'clamp(20px, 5vw, 26px)',
              color:     scoreFlash ? '#FDE047' : '#fff',
              transform: scoreFlash ? 'scale(1.3)' : 'scale(1)',
              textShadow: '2px 2px 0 rgba(0,0,0,0.5)',
            }}
          >
            {score}
          </span>
        </div>

        {/* Gas meter */}
        <div className="flex-1 max-w-[130px]">
          <div className="bg-black/50 backdrop-blur-sm rounded-2xl px-2 py-1.5 border border-white/10">
            <div className="text-[9px] font-bold text-white/60 tracking-widest text-center mb-1">
              {boostActive ? '⚡ BOOST' : '💨 GAS'}
            </div>
            <div className="h-3 bg-black/50 rounded-full overflow-hidden border border-white/10">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${Math.min(100, boostActive ? boostPct : gasPct)}%`,
                  background: boostActive
                    ? 'linear-gradient(90deg,#A855F7,#EC4899)'
                    : nearFull
                    ? 'linear-gradient(90deg,#FBBF24,#F59E0B)'
                    : 'linear-gradient(90deg,#22C55E,#86EFAC)',
                  boxShadow: nearFull
                    ? '0 0 8px rgba(251,191,36,0.8)'
                    : boostActive
                    ? '0 0 8px rgba(168,85,247,0.8)'
                    : 'none',
                }}
              />
            </div>
            {nearFull && (
              <div className="text-yellow-400 text-[8px] font-bold text-center mt-0.5 animate-pulse">
                ALMOST READY!
              </div>
            )}
          </div>
        </div>

        {/* Right column: best + controls */}
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            <button
              onClick={onToggleMute}
              className="pointer-events-auto w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-sm border border-white/10 hover:bg-black/70 transition-colors"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            <button
              onClick={onPause}
              className="pointer-events-auto w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-sm border border-white/10 hover:bg-black/70 transition-colors"
              aria-label="Pause"
            >
              ⏸
            </button>
          </div>
          {bestScore > 0 && (
            <div className="bg-black/40 rounded-lg px-2 py-0.5 flex items-center gap-1 border border-yellow-400/30">
              <span className="text-yellow-400 text-[9px]">🏆</span>
              <span className="text-yellow-400 text-[10px] font-bold">{bestScore}</span>
            </div>
          )}
          {/* Live player count */}
          <div className="bg-green-900/60 rounded-lg px-2 py-0.5 flex items-center gap-1 border border-green-500/40">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-[9px] font-bold">{playerCount} LIVE</span>
          </div>
        </div>
      </div>

      {/* SUPER FART MODE banner */}
      {boostActive && (
        <div
          className="absolute left-1/2 -translate-x-1/2 px-4 py-2 rounded-2xl font-black text-sm border-2"
          style={{
            top: '64px',
            background: 'linear-gradient(135deg,rgba(168,85,247,0.92),rgba(236,72,153,0.92))',
            borderColor: '#FDE047',
            color: '#FDE047',
            boxShadow: '0 0 24px rgba(168,85,247,0.7)',
            animation: 'pulse 0.5s ease-in-out infinite alternate',
          }}
        >
          ⚡ SUPER FART MODE! ⚡
        </div>
      )}
    </div>
  );
}
