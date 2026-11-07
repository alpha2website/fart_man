'use client';

// ============================================================
// FART MAN — Multiplayer Lobby
// Create or join a room, wait for players, start the match.
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { PeerConnection, PlayerNetInfo } from '@/lib/peerConnection';
import { SKINS, SkinDef } from '@/lib/gameConfig';

interface MultiplayerLobbyProps {
  connRef: React.MutableRefObject<PeerConnection | null>;
  skin: SkinDef;
  faceDataUrl: string | null;
  playerName: string;
  onMatchStart: () => void;
  onBack: () => void;
}

export default function MultiplayerLobby({
  connRef,
  skin,
  faceDataUrl,
  playerName,
  onMatchStart,
  onBack,
}: MultiplayerLobbyProps) {
  const [mode, setMode] = useState<'choose' | 'hosting' | 'joining' | 'waiting' | 'error'>('choose');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [players, setPlayers] = useState<PlayerNetInfo[]>([]);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [matchStarting, setMatchStarting] = useState(false);
  const [statusText, setStatusText] = useState('');
  const countdownRef = useRef<number>(0);

  // Subscribe to messages from the connection
  useEffect(() => {
    const conn = connRef.current;
    if (!conn) return;

    const unsubMsg = conn.onMessage((msg) => {
      if (msg.t === 'joinAck') {
        if (msg.yourSlot < 0) {
          setError('Room is full (max 5 players)!');
          setMode('error');
          return;
        }
        conn.setSlot(msg.yourSlot);
        setPlayers(msg.players);
        setMode('waiting');
      } else if (msg.t === 'lobbyUpdate') {
        setPlayers(msg.players);
      } else if (msg.t === 'startMatch') {
        setMatchStarting(true);
        setTimeout(() => onMatchStart(), 500);
      } else if (msg.t === 'left') {
        // lobbyUpdate will handle the player list
      }
    });

    return () => { unsubMsg(); };
  }, [connRef, onMatchStart]);

  const handleCreate = async () => {
    setError('');
    setConnecting(true);
    setStatusText('Loading networking library…');
    try {
      if (!connRef.current) connRef.current = new PeerConnection();
      connRef.current.setMyInfo(playerName, skin.id, faceDataUrl);
      const code = await connRef.current.hostRoom((s) => setStatusText(s));
      setRoomCode(code);
      setMode('waiting');
      setPlayers(connRef.current.playerList);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create room');
      setMode('error');
    } finally {
      setConnecting(false);
    }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) { setError('Enter a room code!'); return; }
    setError('');
    setConnecting(true);
    setStatusText('Starting…');
    try {
      if (!connRef.current) connRef.current = new PeerConnection();
      connRef.current.setMyInfo(playerName, skin.id, faceDataUrl);
      await connRef.current.joinRoom(joinCode.trim().toUpperCase(), (s) => setStatusText(s));
      setRoomCode(joinCode.trim().toUpperCase());
      // Wait for joinAck — mode will switch to 'waiting' in message handler
    } catch (e: any) {
      setError(e?.type === 'peer-unavailable'
        ? 'Room not found. Check the code and try again.'
        : (e?.message ?? 'Failed to join room'));
      setMode('error');
    } finally {
      setConnecting(false);
    }
  };

  const handleStartMatch = () => {
    if (!connRef.current?.isHost) return;
    if (players.length < 2) { setError('Need at least 2 players to start!'); return; }
    connRef.current.startMatch(900, 560);
    setMatchStarting(true);
    setTimeout(() => onMatchStart(), 500);
  };

  const handleBack = () => {
    connRef.current?.destroy();
    connRef.current = null;
    onBack();
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(roomCode).catch(() => {});
  };

  // ── Choose screen ──
  if (mode === 'choose') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
        <div className="bg-gradient-to-b from-blue-900 to-gray-900 border-2 border-yellow-400 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
          <div className="bg-gradient-to-r from-yellow-400 to-orange-500 py-4 text-center">
            <span className="text-2xl font-black text-black">⚔️ FIGHT WITH A FRIEND</span>
          </div>
          <div className="p-6 space-y-4">
            <button
              onClick={handleCreate}
              disabled={connecting}
              className="w-full py-4 rounded-2xl font-black text-lg text-white transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#22C55E,#16A34A)', boxShadow: '0 4px 0 #14532D' }}
            >
              🏠 Create Room
            </button>
            <div className="text-center text-gray-500 text-sm">— OR —</div>
            <div className="space-y-2">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter Room Code"
                maxLength={6}
                className="w-full px-4 py-3 rounded-xl bg-gray-800 text-white font-bold text-center text-lg tracking-widest border border-white/20 focus:border-yellow-400 focus:outline-none"
                onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
              />
              <button
                onClick={handleJoin}
                disabled={connecting || !joinCode.trim()}
                className="w-full py-4 rounded-2xl font-black text-lg text-white transition-all active:scale-95"
                style={{ background: 'linear-gradient(135deg,#3B82F6,#2563EB)', boxShadow: '0 4px 0 #1D4ED8' }}
              >
                🚪 Join Room
              </button>
            </div>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            {connecting && (
              <div className="text-center space-y-2 py-2">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-yellow-400 text-sm font-bold">{statusText || 'Connecting…'}</span>
                </div>
                <div className="text-gray-500 text-xs px-4">
                  Multiplayer uses P2P WebRTC. On some networks this can take up to 25 seconds.<br />
                  Make sure the host has created the room and is still waiting.
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-gray-800 p-4">
            <button onClick={handleBack} className="w-full py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold transition-colors">
              ← Back to Menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Error screen ──
  if (mode === 'error') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
        <div className="bg-gray-900 border-2 border-red-500 rounded-3xl w-full max-w-sm overflow-hidden">
          <div className="bg-red-600 py-4 text-center">
            <span className="text-2xl font-black text-white">⚠️ Connection Failed</span>
          </div>
          <div className="p-6 text-center space-y-4">
            <p className="text-white text-sm">{error}</p>
            {statusText && <p className="text-gray-500 text-xs">Last status: {statusText}</p>}
            <div className="space-y-2">
              {joinCode.trim() && (
                <button
                  onClick={() => { setMode('choose'); setError(''); handleJoin(); }}
                  className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold transition-colors"
                >
                  🔄 Retry Join Room
                </button>
              )}
              <button
                onClick={() => { setMode('choose'); setError(''); }}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors"
              >
                Enter Different Code
              </button>
              <button onClick={handleBack} className="w-full py-3 rounded-xl bg-gray-700 text-white font-bold">
                Back to Menu
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Waiting room ──
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
      <div className="bg-gradient-to-b from-blue-900 to-gray-900 border-2 border-yellow-400 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-yellow-400 to-orange-500 py-3 text-center">
          <span className="text-xl font-black text-black">⏳ WAITING ROOM</span>
        </div>

        <div className="p-6 space-y-4">
          {/* Room code */}
          <div className="bg-black/40 rounded-2xl p-4 text-center border border-white/10">
            <div className="text-gray-400 text-xs font-bold tracking-widest mb-1">ROOM CODE</div>
            <div className="flex items-center justify-center gap-2">
              <span className="text-3xl font-black text-yellow-400 tracking-widest">{roomCode}</span>
              <button onClick={copyCode} className="ml-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg px-2 py-1 text-white transition-colors">
                📋 Copy
              </button>
            </div>
            <p className="text-gray-500 text-xs mt-1">Share this code with friends to invite them!</p>
          </div>

          {/* Player list */}
          <div className="space-y-2">
            <div className="text-white text-sm font-bold flex items-center justify-between">
              <span>Players ({players.length}/5)</span>
              <span className={`text-xs ${players.length >= 2 ? 'text-green-400' : 'text-gray-500'}`}>
                {players.length >= 2 ? '✓ Ready to start!' : 'Waiting for players…'}
              </span>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {players.map((p) => {
                const skin = SKINS.find(s => s.id === p.skinId);
                return (
                  <div key={p.id} className="flex items-center gap-3 bg-white/5 rounded-xl p-2.5">
                    <div className="w-10 h-10 rounded-full overflow-hidden border-2 flex-shrink-0"
                      style={{ borderColor: skin?.suitColor ?? '#2563EB', background: skin?.bodyColor ?? '#FFDEA0' }}>
                      {p.faceDataUrl ? (
                        <img src={p.faceDataUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg">
                          {skin?.emoji ?? '💨'}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-bold text-sm truncate">{p.name}</div>
                      <div className="text-gray-500 text-xs">
                        P{p.id + 1} {p.isHost && '👑 Host'}
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Empty slots */}
              {Array.from({ length: Math.max(0, 5 - players.length) }).map((_, i) => (
                <div key={`empty-${i}`} className="flex items-center gap-3 bg-white/5 rounded-xl p-2.5 opacity-40">
                  <div className="w-10 h-10 rounded-full border-2 border-dashed border-gray-600 flex-shrink-0" />
                  <div className="text-gray-600 text-sm">Waiting…</div>
                </div>
              ))}
            </div>
          </div>

          {/* Your character preview */}
          <div className="flex items-center gap-2 bg-white/5 rounded-xl p-2">
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 flex-shrink-0"
              style={{ borderColor: skin.suitColor, background: skin.bodyColor }}>
              {faceDataUrl ? (
                <img src={faceDataUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm">{skin.emoji}</div>
              )}
            </div>
            <span className="text-white text-sm font-bold">You: {playerName}</span>
          </div>

          {/* Start button (host only) */}
          {connRef.current?.isHost ? (
            <button
              onClick={handleStartMatch}
              disabled={players.length < 2 || matchStarting}
              className="w-full py-4 rounded-2xl font-black text-lg text-white transition-all active:scale-95 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#EF4444,#DC2626)', boxShadow: '0 4px 0 #991B1B' }}
            >
              {matchStarting ? 'Starting…' : '⚔️ START BATTLE!'}
            </button>
          ) : (
            <div className="text-center text-gray-400 text-sm py-3 bg-white/5 rounded-xl">
              {matchStarting ? '⚔️ Match starting…' : 'Waiting for host to start the match…'}
            </div>
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          {/* Leave button */}
          <button onClick={handleBack} className="w-full py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-bold text-sm transition-colors">
            ← Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}
