'use client';

// ============================================================
// FART MAN — Main Menu
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { SKINS, SkinDef } from '@/lib/gameConfig';

interface MainMenuProps {
  bestScore: number;
  isMuted: boolean;
  playerCount: number;
  onPlay: () => void;
  onCustomizeFace: () => void;
  onToggleMute: () => void;
  onMultiplayer: () => void;
  selectedSkin: SkinDef;
  onSkinChange: (skin: SkinDef) => void;
}

export default function MainMenu({
  bestScore,
  isMuted,
  playerCount,
  onPlay,
  onCustomizeFace,
  onToggleMute,
  onMultiplayer,
  selectedSkin,
  onSkinChange,
}: MainMenuProps) {
  const [showHowTo, setShowHowTo] = useState(false);
  const [showSkins, setShowSkins] = useState(false);
  const [bounce, setBounce] = useState(false);
  const [cloudOffset, setCloudOffset] = useState(0);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef(0);

  // Animate clouds and character bounce
  useEffect(() => {
    let offset = 0;
    const animate = (t: number) => {
      const dt = Math.min(t - lastTimeRef.current, 50);
      lastTimeRef.current = t;
      offset += dt * 0.02;
      setCloudOffset(offset % 100);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // Pulsing play button
  useEffect(() => {
    const id = setInterval(() => setBounce((b) => !b), 800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-between overflow-hidden select-none"
      style={{
        background: 'linear-gradient(180deg, #1E3A8A 0%, #1D4ED8 40%, #2563EB 70%, #374151 90%, #1F2937 100%)',
      }}
    >
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Stars */}
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: `${2 + (i % 3)}px`,
              height: `${2 + (i % 3)}px`,
              top: `${(i * 17) % 60}%`,
              left: `${(i * 13) % 95}%`,
              opacity: 0.4 + (i % 5) * 0.1,
            }}
          />
        ))}
        {/* Moving clouds */}
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/20"
            style={{
              width: `${80 + i * 40}px`,
              height: `${30 + i * 10}px`,
              top: `${15 + i * 12}%`,
              left: `${((cloudOffset * (0.5 + i * 0.3) + i * 33) % 110) - 10}%`,
              filter: 'blur(4px)',
            }}
          />
        ))}
        {/* City silhouette */}
        <div className="absolute bottom-0 left-0 right-0 flex items-end gap-0.5 px-2">
          {[60, 90, 50, 110, 70, 80, 45, 100, 65, 85, 55, 95, 40, 75].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t"
              style={{
                height: `${h}px`,
                background: i % 3 === 0 ? '#0F172A' : i % 3 === 1 ? '#1E293B' : '#111827',
              }}
            />
          ))}
        </div>
      </div>

      {/* Top bar */}
      <div className="relative z-10 w-full flex justify-between items-center px-4 pt-4">
        <div className="flex items-center gap-2 bg-black/40 rounded-xl px-3 py-1.5 border border-green-500/30">
          <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-green-400 text-xs font-black">{playerCount}</span>
          <span className="text-green-300/70 text-xs font-bold">LIVE PLAYERS</span>
        </div>
        <button
          onClick={onToggleMute}
          className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-xl transition-colors border border-white/20"
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* Logo area */}
      <div className="relative z-10 flex flex-col items-center gap-2 mt-2">
        {/* Animated fart man mascot (CSS version for menu) */}
        <div className="relative" style={{ width: 100, height: 120 }}>
          <MenuCharacter skinId={selectedSkin.id} bounce={bounce} />
        </div>

        {/* Title */}
        <div className="text-center">
          <div className="text-5xl font-black leading-none" style={{
            color: '#FDE047',
            textShadow: '3px 3px 0 #92400E, 0 0 20px rgba(253,224,71,0.5)',
            letterSpacing: '-1px',
          }}>
            FART MAN
          </div>
          <div className="text-sm font-bold tracking-widest mt-1" style={{
            color: '#FB923C',
            textShadow: '1px 1px 0 #7C2D12',
          }}>
            THE ULTIMATE GAS ESCAPE
          </div>
          <div className="text-xs text-yellow-200/70 mt-1 italic">
            &ldquo;When the pressure rises, the hero flies!&rdquo;
          </div>
        </div>

        {/* Best score */}
        {bestScore > 0 && (
          <div className="bg-black/40 border border-yellow-400/50 rounded-full px-5 py-1 flex items-center gap-2">
            <span className="text-yellow-400">🏆</span>
            <span className="text-white font-bold text-sm">Best: {bestScore}</span>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="relative z-10 w-full max-w-xs px-4 space-y-3 mb-4">

        {/* PLAY */}
        <button
          onClick={onPlay}
          className="w-full py-4 rounded-2xl font-black text-xl transition-all active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #22C55E, #16A34A)',
            color: '#fff',
            boxShadow: '0 4px 0 #14532D, 0 0 20px rgba(34,197,94,0.4)',
            transform: bounce ? 'translateY(-3px)' : 'translateY(0)',
            transition: 'transform 0.3s ease',
          }}
        >
          💨 PLAY NOW!
        </button>

        {/* FIGHT WITH A FRIEND — Multiplayer */}
        <button
          onClick={onMultiplayer}
          className="w-full py-3.5 rounded-2xl font-black text-base transition-all active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #EF4444, #DC2626)',
            color: '#fff',
            boxShadow: '0 4px 0 #991B1B, 0 0 16px rgba(239,68,68,0.3)',
          }}
        >
          ⚔️ FIGHT WITH A FRIEND!
        </button>

        {/* SKIN SELECTOR */}
        <button
          onClick={() => setShowSkins((s) => !s)}
          className="w-full py-3 rounded-2xl font-black text-sm transition-all active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
            color: '#fff',
            boxShadow: '0 3px 0 #4C1D95',
          }}
        >
          {selectedSkin.emoji} {selectedSkin.name} — Change Hero
        </button>

        {/* Skin picker */}
        {showSkins && (
          <div className="grid grid-cols-3 gap-2 bg-black/50 rounded-2xl p-3 border border-purple-500/40">
            {SKINS.map((skin) => (
              <button
                key={skin.id}
                onClick={() => { onSkinChange(skin); setShowSkins(false); }}
                className="flex flex-col items-center gap-1 py-2 rounded-xl transition-all"
                style={{
                  background: selectedSkin.id === skin.id
                    ? 'rgba(253,224,71,0.2)'
                    : 'rgba(255,255,255,0.05)',
                  border: selectedSkin.id === skin.id ? '2px solid #FDE047' : '2px solid transparent',
                }}
              >
                <span className="text-2xl">{skin.emoji}</span>
                <span className="text-white text-xs font-bold leading-tight text-center">{skin.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* FACE */}
        <button
          onClick={onCustomizeFace}
          className="w-full py-3 rounded-2xl font-black text-sm transition-all active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            color: '#000',
            boxShadow: '0 3px 0 #92400E',
          }}
        >
          🎭 PUT YOUR FACE ON FART MAN!
        </button>

        {/* HOW TO PLAY */}
        <button
          onClick={() => setShowHowTo((h) => !h)}
          className="w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-95"
          style={{
            background: 'rgba(255,255,255,0.1)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
          }}
        >
          {showHowTo ? '▲ Hide' : '❓ How to Play'}
        </button>

        {/* How to play panel */}
        {showHowTo && (
          <div className="bg-black/60 border border-white/20 rounded-2xl p-4 text-sm text-white space-y-2">
            <div className="flex items-start gap-2">
              <span>💨</span>
              <span><strong className="text-yellow-400">Tap / Click / Space</strong> to fart and jump!</span>
            </div>
            <div className="flex items-start gap-2">
              <span>🏃</span>
              <span>Fart Man <strong className="text-green-400">runs across rooftops</strong> automatically</span>
            </div>
            <div className="flex items-start gap-2">
              <span>⚫</span>
              <span>Fart over the <strong className="text-red-400">gaps between buildings</strong> — fall in and it&apos;s over!</span>
            </div>
            <div className="flex items-start gap-2">
              <span>⭐</span>
              <span>Collect <strong className="text-yellow-400">beans, chillies, gas bottles</strong> for bonus points</span>
            </div>
            <div className="flex items-start gap-2">
              <span>⚡</span>
              <span>Fill the <strong className="text-green-400">GAS METER</strong> to activate SUPER FART MODE!</span>
            </div>
            <div className="flex items-start gap-2">
              <span>📱</span>
              <span>On mobile: <strong className="text-blue-400">tap anywhere</strong> to fart &amp; jump</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Mini character for menu (pure CSS/SVG)
function MenuCharacter({ skinId, bounce }: { skinId: string; bounce: boolean }) {
  const skin = SKINS.find((s) => s.id === skinId) ?? SKINS[0];
  const floatY = bounce ? -6 : 0;

  return (
    <svg
      width="100"
      height="120"
      viewBox="0 0 100 120"
      style={{ transition: 'transform 0.4s ease', transform: `translateY(${floatY}px)` }}
    >
      {/* Glow */}
      {skin.glowColor && (
        <ellipse cx="50" cy="75" rx="30" ry="8" fill={skin.glowColor} opacity="0.3" />
      )}
      {/* Cape */}
      <path d="M62 38 Q80 45 82 65 Q76 75 68 70 Q64 55 62 50Z" fill={skin.capeColor} />
      {/* Body */}
      <rect x="28" y="48" width="44" height="36" rx="10" fill={skin.suitColor} />
      {/* Belt */}
      <rect x="30" y="72" width="40" height="8" rx="3" fill={skin.beltColor} />
      <rect x="45" y="73" width="10" height="6" rx="2" fill="#F59E0B" />
      {/* Head */}
      <circle cx="50" cy="38" r="22" fill={skin.bodyColor} />
      {/* Mask */}
      <rect x="36" y="28" width="28" height="8" rx="4" fill="#DC2626" />
      {/* Eyes */}
      <circle cx="43" cy="33" r="5" fill="white" />
      <circle cx="57" cy="33" r="5" fill="white" />
      <circle cx="44" cy="34" r="2.5" fill="#1a1a1a" />
      <circle cx="58" cy="34" r="2.5" fill="#1a1a1a" />
      <circle cx="45" cy="33" r="1" fill="white" />
      <circle cx="59" cy="33" r="1" fill="white" />
      {/* Smile */}
      <path d="M44 44 Q50 50 56 44" stroke="#5D3A1A" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Arms */}
      <rect x="16" y="50" width="12" height="22" rx="6" fill={skin.suitColor} />
      <rect x="72" y="50" width="12" height="22" rx="6" fill={skin.suitColor} />
      {/* Legs */}
      <rect x="32" y="82" width="14" height="20" rx="5" fill={skin.suitColor} />
      <rect x="54" y="82" width="14" height="20" rx="5" fill={skin.suitColor} />
      {/* Boots */}
      <rect x="30" y="98" width="16" height="8" rx="4" fill="#DC2626" />
      <rect x="54" y="98" width="16" height="8" rx="4" fill="#DC2626" />
      {/* Fart clouds */}
      <circle cx="12" cy="90" r="8" fill="#86EFAC" opacity="0.7" />
      <circle cx="4" cy="84" r="6" fill="#4ADE80" opacity="0.5" />
      <circle cx="18" cy="98" r="5" fill="#BBF7D0" opacity="0.6" />
    </svg>
  );
}
