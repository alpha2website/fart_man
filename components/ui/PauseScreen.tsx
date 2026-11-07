'use client';

// ============================================================
// FART MAN — Pause Screen
// ============================================================

interface PauseScreenProps {
  score: number;
  isMuted: boolean;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onToggleMute: () => void;
}

export default function PauseScreen({
  score,
  isMuted,
  onResume,
  onRestart,
  onMainMenu,
  onToggleMute,
}: PauseScreenProps) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-xs mx-4 rounded-3xl overflow-hidden border-2"
        style={{
          background: 'linear-gradient(180deg, #1E3A8A 0%, #1E293B 100%)',
          borderColor: '#FDE047',
          boxShadow: '0 0 40px rgba(253,224,71,0.3)',
        }}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-yellow-400 to-orange-500 py-3 text-center">
          <span className="text-2xl font-black text-black">⏸ PAUSED</span>
        </div>

        {/* Score display */}
        <div className="flex justify-center py-4">
          <div className="text-center bg-black/30 rounded-2xl px-8 py-2 border border-white/10">
            <div className="text-white/60 text-xs font-bold tracking-widest">CURRENT SCORE</div>
            <div className="text-4xl font-black text-white mt-1">{score}</div>
          </div>
        </div>

        {/* Buttons */}
        <div className="px-5 pb-5 space-y-3">
          <button
            onClick={onResume}
            className="w-full py-3.5 rounded-2xl font-black text-lg text-white transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #22C55E, #16A34A)',
              boxShadow: '0 4px 0 #14532D',
            }}
          >
            ▶️ Resume
          </button>

          <button
            onClick={onRestart}
            className="w-full py-3 rounded-2xl font-bold text-base text-white transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
              boxShadow: '0 3px 0 #1D4ED8',
            }}
          >
            🔄 Restart
          </button>

          <button
            onClick={onMainMenu}
            className="w-full py-3 rounded-2xl font-bold text-base text-white transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #6B7280, #4B5563)',
              boxShadow: '0 3px 0 #374151',
            }}
          >
            🏠 Main Menu
          </button>

          {/* Sound toggle */}
          <button
            onClick={onToggleMute}
            className="w-full py-2.5 rounded-2xl font-bold text-sm text-white transition-all active:scale-95 border border-white/20"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            {isMuted ? '🔇 Sound: OFF' : '🔊 Sound: ON'}
          </button>
        </div>
      </div>
    </div>
  );
}
