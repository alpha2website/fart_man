'use client';

// ============================================================
// FART MAN — Game Over Screen
// ============================================================

import { useState, useEffect } from 'react';
import { FUNNY_GAMEOVER_MESSAGES, SCORE_MESSAGES } from '@/lib/gameConfig';

interface GameOverProps {
  score: number;
  bestScore: number;
  onPlayAgain: () => void;
  onMainMenu: () => void;
  onCustomizeFace: () => void;
}

export default function GameOver({
  score,
  bestScore,
  onPlayAgain,
  onMainMenu,
  onCustomizeFace,
}: GameOverProps) {
  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);

  // Animate in
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    setIsNewBest(score > 0 && score >= bestScore);
    return () => clearTimeout(t);
  }, [score, bestScore]);

  // Pick a funny message based on score
  const message = FUNNY_GAMEOVER_MESSAGES[score % FUNNY_GAMEOVER_MESSAGES.length];
  const scoreMsg = [...SCORE_MESSAGES].reverse().find((m) => score >= m.min)?.message ?? '';

  const shareText = `I scored ${score} in FART MAN: THE ULTIMATE GAS ESCAPE! 💨 Can you beat me?`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'FART MAN', text: shareText });
        return;
      } catch {
        // fallback
      }
    }
    setShowShare(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-xs mx-4 rounded-3xl overflow-hidden border-2 transition-all duration-300"
        style={{
          background: 'linear-gradient(180deg, #7F1D1D 0%, #1C1917 100%)',
          borderColor: '#F87171',
          boxShadow: '0 0 40px rgba(248,113,113,0.3)',
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(30px)',
          opacity: visible ? 1 : 0,
        }}
      >
        {/* Header */}
        <div
          className="py-3 text-center"
          style={{ background: 'linear-gradient(135deg, #DC2626, #B91C1C)' }}
        >
          <div className="text-3xl font-black text-white">💥 GAME OVER!</div>
          {isNewBest && (
            <div className="text-yellow-400 font-black text-sm mt-0.5 animate-bounce">
              🏆 NEW BEST SCORE! 🏆
            </div>
          )}
        </div>

        {/* Scores */}
        <div className="flex justify-center gap-4 py-4 px-4">
          <div className="flex-1 text-center bg-black/30 rounded-2xl py-3 border border-white/10">
            <div className="text-white/50 text-[9px] font-bold tracking-widest">SCORE</div>
            <div
              className="font-black text-white mt-1"
              style={{ fontSize: 'clamp(28px, 8vw, 40px)', textShadow: '2px 2px 0 rgba(0,0,0,0.5)' }}
            >
              {score}
            </div>
          </div>
          <div className="flex-1 text-center bg-black/30 rounded-2xl py-3 border border-yellow-400/30">
            <div className="text-yellow-400/70 text-[9px] font-bold tracking-widest">BEST</div>
            <div
              className="font-black text-yellow-400 mt-1"
              style={{ fontSize: 'clamp(28px, 8vw, 40px)', textShadow: '2px 2px 0 rgba(0,0,0,0.5)' }}
            >
              {bestScore}
            </div>
          </div>
        </div>

        {/* Funny messages */}
        <div className="px-4 text-center space-y-1 pb-3">
          <div className="text-orange-300 font-bold text-sm">&ldquo;{message}&rdquo;</div>
          {scoreMsg && (
            <div className="text-white/50 text-xs">{scoreMsg}</div>
          )}
        </div>

        {/* Share panel */}
        {showShare && (
          <div className="mx-4 mb-3 bg-black/40 rounded-xl p-3 border border-white/10">
            <p className="text-white/80 text-xs mb-2">{shareText}</p>
            <button
              onClick={handleCopy}
              className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-colors"
            >
              {copied ? '✅ Copied!' : '📋 Copy to Clipboard'}
            </button>
          </div>
        )}

        {/* Buttons */}
        <div className="px-4 pb-5 space-y-2.5">
          <button
            onClick={onPlayAgain}
            className="w-full py-3.5 rounded-2xl font-black text-lg text-white transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #22C55E, #16A34A)',
              boxShadow: '0 4px 0 #14532D',
            }}
          >
            💨 PLAY AGAIN!
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onMainMenu}
              className="py-2.5 rounded-2xl font-bold text-sm text-white transition-all active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #6B7280, #4B5563)',
                boxShadow: '0 3px 0 #374151',
              }}
            >
              🏠 Menu
            </button>

            <button
              onClick={handleShare}
              className="py-2.5 rounded-2xl font-bold text-sm text-white transition-all active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                boxShadow: '0 3px 0 #1D4ED8',
              }}
            >
              📤 Share
            </button>
          </div>

          <button
            onClick={onCustomizeFace}
            className="w-full py-2.5 rounded-2xl font-bold text-xs text-black transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #FBBF24, #F59E0B)',
              boxShadow: '0 3px 0 #92400E',
            }}
          >
            🎭 Customize Character
          </button>
        </div>
      </div>
    </div>
  );
}
