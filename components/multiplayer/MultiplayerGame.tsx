'use client';

// ============================================================
// FART MAN — Multiplayer Arena Game
// Renders the arena, handles input, syncs with PeerConnection.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { PeerConnection, NetMessage, PlayerSnap, ProjSnap } from '@/lib/peerConnection';
import { MultiplayerEngine } from './MultiplayerEngine';
import { AudioManager } from '@/components/game/AudioManager';
import { GAME_CONFIG } from '@/lib/gameConfig';

const ARENA_W = 900;
const ARENA_H = 560;

interface MultiplayerGameProps {
  connRef: React.MutableRefObject<PeerConnection | null>;
  audioRef: React.MutableRefObject<AudioManager | null>;
  onExit: () => void;
}

export default function MultiplayerGame({ connRef, audioRef, onExit }: MultiplayerGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MultiplayerEngine | null>(null);
  const [matchOver, setMatchOver] = useState(false);
  const [winnerName, setWinnerName] = useState('');
  const [showControls, setShowControls] = useState(false);

  // Joystick state (mobile)
  const joyRef = useRef<{ active: boolean; cx: number; cy: number; dx: number; dy: number }>({
    active: false, cx: 0, cy: 0, dx: 0, dy: 0,
  });

  // Input state — attackHeld/specialHeld track button hold state
  const inputRef = useRef({ moveX: 0, moveY: 0, facing: 1, attack: false, special: false });
  const attackHeld = useRef(false);
  const specialHeld = useRef(false);

  const updateInput = useCallback(() => {
    let mx = 0, my = 0;

    // Keyboard
    if (keysRef.current.w || keysRef.current.arrowup) my -= 1;
    if (keysRef.current.s || keysRef.current.arrowdown) my += 1;
    if (keysRef.current.a || keysRef.current.arrowleft) mx -= 1;
    if (keysRef.current.d || keysRef.current.arrowright) mx += 1;

    // Joystick (mobile) overrides keyboard if active
    if (joyRef.current.active) {
      mx = joyRef.current.dx;
      my = joyRef.current.dy;
    }

    // Normalize
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }

    const facing = mx !== 0 ? (mx > 0 ? 1 : -1) : inputRef.current.facing;

    // Attack fires while button is held (respecting cooldown in engine)
    inputRef.current = {
      moveX: mx,
      moveY: my,
      facing,
      attack: attackHeld.current,
      special: specialHeld.current,
    };

    engineRef.current?.setLocalInput(inputRef.current);
  }, []);

  // Keyboard state
  const keysRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','shift'].includes(k)) {
        e.preventDefault();
      }
      if (k === ' ') attackHeld.current = down;
      if (k === 'shift') specialHeld.current = down;
      if (['w','a','s','d'].includes(k)) keysRef.current[k] = down;
      if (['arrowup','arrowdown','arrowleft','arrowright'].includes(k)) keysRef.current[k] = down;
      updateInput();
    };

    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, [updateInput]);

  // Continuous input update — sends held button state every frame
  useEffect(() => {
    const interval = setInterval(() => {
      updateInput();
    }, 50);
    return () => clearInterval(interval);
  }, [updateInput]);

  // Init engine + wire networking
  useEffect(() => {
    const canvas = canvasRef.current;
    const conn = connRef.current;
    if (!canvas || !conn) return;

    // Setup canvas — fill entire screen (object-fit: cover style)
    const resize = () => {
      const container = canvas.parentElement;
      if (!container) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      const ctx2 = canvas.getContext('2d')!;
      // Scale arena to cover full screen — centered, clips overflow
      const scale = Math.max(cw / ARENA_W, ch / ARENA_H) * dpr;
      const offsetX = (cw * dpr - ARENA_W * scale) / 2;
      const offsetY = (ch * dpr - ARENA_H * scale) / 2;
      ctx2.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', resize);

    // Create engine
    const audio = audioRef.current ?? new AudioManager();
    const engine = new MultiplayerEngine(canvas, conn, audio);
    engineRef.current = engine;

    // Initialize match with current player list
    const playerInfos = conn.playerList.map(p => ({
      id: p.id, name: p.name, skinId: p.skinId,
      faceDataUrl: p.faceDataUrl, isHost: p.isHost,
    }));
    engine.initMatch(playerInfos);

    // Wire networking messages
    const unsub = conn.onMessage((msg, fromSlot) => {
      switch (msg.t) {
        case 'input':
          if (fromSlot !== undefined) {
            engine.onRemoteInput(fromSlot, {
              moveX: msg.moveX, moveY: msg.moveY,
              facing: msg.facing, attack: msg.attack, special: msg.special,
            });
          }
          break;
        case 'state':
          engine.applyState(msg);
          break;
        case 'eliminated':
          break;
        case 'matchOver':
          engine.applyMatchOver(msg.winnerSlot);
          setMatchOver(true);
          setWinnerName(msg.winnerName);
          break;
      }
    });

    // Start game audio
    audio.startGameplay();

    // Start engine
    engine.start();

    // Set my slot
    engine['conn'] = conn; // ensure reference
    if (conn.isHost) {
      conn.setSlot(0);
    }

    return () => {
      unsub();
      engine.stop();
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [connRef, audioRef]);

  // ── Touch controls (mobile joystick + buttons) ──
  // No preventDefault — touchAction:'none' CSS handles scroll prevention

  const handleAttackStart = () => { attackHeld.current = true; updateInput(); };
  const handleAttackEnd = () => { attackHeld.current = false; updateInput(); };
  const handleSpecialStart = () => { specialHeld.current = true; updateInput(); };
  const handleSpecialEnd = () => { specialHeld.current = false; updateInput(); };

  const handleJoyStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    joyRef.current = {
      active: true,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      dx: 0, dy: 0,
    };
  };

  const handleJoyMove = (e: React.TouchEvent) => {
    if (!joyRef.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - joyRef.current.cx;
    const dy = t.clientY - joyRef.current.cy;
    const maxR = 50;
    const len = Math.hypot(dx, dy);
    const cl = len > maxR ? maxR / len : 1;
    joyRef.current.dx = (dx * cl) / maxR;
    joyRef.current.dy = (dy * cl) / maxR;
    updateInput();
  };

  const handleJoyEnd = () => {
    joyRef.current = { active: false, cx: 0, cy: 0, dx: 0, dy: 0 };
    updateInput();
  };

  // Detect mobile
  useEffect(() => {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setShowControls(isTouch);
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black overflow-hidden" style={{ touchAction: 'none' }}>
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex justify-between items-center px-4 py-2 z-30">
        <button
          onClick={onExit}
          className="px-3 py-1.5 rounded-lg bg-gray-800/80 text-white text-sm font-bold border border-white/20 hover:bg-gray-700 transition-colors"
        >
          ← Exit
        </button>
        <div className="text-white text-sm font-bold bg-black/50 rounded-lg px-3 py-1.5 border border-white/10">
          💨 FART BATTLE ARENA
        </div>
      </div>

      {/* Canvas */}
      <div className="relative w-full h-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          style={{
            imageRendering: 'auto',
            touchAction: 'none',
          }}
        />

        {/* Mobile touch controls */}
        {showControls && !matchOver && (
          <>
            {/* Virtual joystick — bottom left */}
            <div
              onTouchStart={handleJoyStart}
              onTouchMove={handleJoyMove}
              onTouchEnd={handleJoyEnd}
              className="absolute bottom-8 left-6 w-28 h-28 rounded-full bg-white/10 border-2 border-white/30 z-30 flex items-center justify-center"
              style={{ touchAction: 'none' }}
            >
              <div className="w-12 h-12 rounded-full bg-white/30 border-2 border-white/50" />
            </div>

            {/* Attack button — bottom right (hold to fire) */}
            <button
              onTouchStart={handleAttackStart}
              onTouchEnd={handleAttackEnd}
              onTouchCancel={handleAttackEnd}
              className="absolute bottom-8 right-24 w-24 h-24 rounded-full bg-green-600/70 border-2 border-green-400 z-30 flex items-center justify-center text-3xl font-black text-white active:scale-90 transition-transform"
              style={{ touchAction: 'none' }}
            >
              💨
            </button>

            {/* Special button — bottom right (hold to fire) */}
            <button
              onTouchStart={handleSpecialStart}
              onTouchEnd={handleSpecialEnd}
              onTouchCancel={handleSpecialEnd}
              className="absolute bottom-8 right-6 w-20 h-20 rounded-full bg-purple-600/70 border-2 border-purple-400 z-30 flex items-center justify-center text-2xl font-black text-white active:scale-90 transition-transform"
              style={{ touchAction: 'none' }}
            >
              💣
            </button>
          </>
        )}

        {/* Desktop hint */}
        {!showControls && !matchOver && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-xs bg-black/50 rounded-lg px-3 py-1.5 z-30">
            WASD: Move &nbsp;|&nbsp; Space: Fart Blast &nbsp;|&nbsp; Shift: Gas Bomb
          </div>
        )}
      </div>

      {/* Match over overlay */}
      {matchOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-gradient-to-b from-yellow-900 to-gray-900 border-2 border-yellow-400 rounded-3xl w-full max-w-xs mx-4 overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 py-4 text-center">
              <span className="text-2xl font-black text-black">🏆 MATCH OVER!</span>
            </div>
            <div className="p-6 text-center space-y-4">
              <div className="text-4xl">🎉</div>
              <div className="text-white text-2xl font-black">{winnerName}</div>
              <div className="text-green-400 font-bold">is the GAS MASTER!</div>
              <div className="space-y-2 pt-2">
                <button
                  onClick={onExit}
                  className="w-full py-3 rounded-2xl font-black text-white transition-all active:scale-95"
                  style={{ background: 'linear-gradient(135deg,#22C55E,#16A34A)', boxShadow: '0 4px 0 #14532D' }}
                >
                  ← Back to Menu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
