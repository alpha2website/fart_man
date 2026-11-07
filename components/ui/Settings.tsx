'use client';

// ============================================================
// FART MAN — Settings Panel
// ============================================================

interface SettingsProps {
  isMuted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
}

export default function Settings({ isMuted, onToggleMute, onClose }: SettingsProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        className="w-full max-w-xs rounded-3xl overflow-hidden border-2"
        style={{
          background: 'linear-gradient(180deg, #1E3A8A 0%, #1E293B 100%)',
          borderColor: '#60A5FA',
          boxShadow: '0 0 30px rgba(96,165,250,0.3)',
        }}
      >
        <div className="bg-gradient-to-r from-blue-500 to-blue-700 py-3 text-center">
          <span className="text-xl font-black text-white">⚙️ SETTINGS</span>
        </div>

        <div className="p-5 space-y-4">
          {/* Sound toggle */}
          <div className="flex items-center justify-between bg-black/30 rounded-2xl px-4 py-3 border border-white/10">
            <span className="text-white font-bold">🔊 Sound Effects</span>
            <button
              onClick={onToggleMute}
              className={`w-12 h-6 rounded-full transition-all ${isMuted ? 'bg-gray-600' : 'bg-green-500'}`}
              aria-label="Toggle sound"
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${isMuted ? 'translate-x-0.5' : 'translate-x-6'}`}
              />
            </button>
          </div>

          {/* Privacy note */}
          <div className="bg-black/30 rounded-2xl p-4 border border-green-500/20">
            <div className="text-green-400 font-bold text-sm mb-2">🔒 Privacy</div>
            <ul className="text-gray-400 text-xs space-y-1">
              <li>✅ No accounts required</li>
              <li>✅ No data collected</li>
              <li>✅ No cookies or tracking</li>
              <li>✅ Photos stay in your browser</li>
              <li>✅ Scores reset on page refresh</li>
            </ul>
          </div>

          {/* Credits */}
          <div className="text-center text-gray-500 text-xs">
            <div className="font-bold text-gray-400">FART MAN: THE ULTIMATE GAS ESCAPE</div>
            <div className="mt-1">&ldquo;When the pressure rises, the hero flies!&rdquo;</div>
          </div>
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl font-bold text-white transition-all active:scale-95"
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
