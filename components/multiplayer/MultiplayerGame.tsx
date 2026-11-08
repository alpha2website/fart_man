'use client';

// ============================================================
// FART MAN — Multiplayer Arena Game
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { PeerConnection, NetMessage } from '@/lib/peerConnection';
import { MultiplayerEngine, InputState } from './MultiplayerEngine';
import { AudioManager } from '@/components/game/AudioManager';

const ARENA_W = 900;
const ARENA_H = 540;

interface MultiplayerGameProps {
  connRef:  React.MutableRefObject<PeerConnection | null>;
  audioRef: React.MutableRefObject<AudioManager | null>;
  onExit:   () => void;
}

export default function MultiplayerGame({ connRef, audioRef, onExit }: MultiplayerGameProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const engineRef  = useRef<MultiplayerEngine | null>(null);
  const [matchOver,   setMatchOver]   = useState(false);
  const [winnerName,  setWinnerName]  = useState('');
  const [isMobile,    setIsMobile]    = useState(false);

  // ── Input refs ────────────────────────────────────────────
  const keysRef      = useRef<Record<string, boolean>>({});
  const attackHeld   = useRef(false);
  const specialHeld  = useRef(false);
  const joyRef       = useRef({ active: false, cx: 0, cy: 0, dx: 0, dy: 0 });
  const facingRef    = useRef<1 | -1>(1);

  const flush = useCallback(() => {
    let mx = 0, my = 0;
    const k = keysRef.current;
    if (k.a || k.arrowleft)  mx -= 1;
    if (k.d || k.arrowright) mx += 1;
    if (k.w || k.arrowup)    my -= 1;
    if (k.s || k.arrowdown)  my += 1;

    if (joyRef.current.active) {
      mx = joyRef.current.dx;
      my = joyRef.current.dy;
    }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    if (mx !== 0) facingRef.current = mx > 0 ? 1 : -1;

    const inp: InputState = {
      moveX:   mx,
      moveY:   my,
      facing:  facingRef.current,
      attack:  attackHeld.current,
      special: specialHeld.current,
    };
    engineRef.current?.setLocalInput(inp);
  }, []);

  // ── Keyboard ─────────────────────────────────────────────
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ([' ','shift','w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k))
        e.preventDefault();
      if (k === ' ')     attackHeld.current  = true;
      if (k === 'shift') specialHeld.current = true;
      keysRef.current[k] = true;
      flush();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === ' ')     attackHeld.current  = false;
      if (k === 'shift') specialHeld.current = false;
      keysRef.current[k] = false;
      flush();
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup',   up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, [flush]);

  // ── Polling loop — sends held state @30Hz ─────────────────
  useEffect(() => {
    const id = setInterval(flush, 33);
    return () => clearInterval(id);
  }, [flush]);

  // ── Detect mobile ─────────────────────────────────────────
  useEffect(() => {
    setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  // ── Canvas + engine setup ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const conn   = connRef.current;
    if (!canvas || !conn) return;

    // Size canvas to fill the container, preserving arena aspect ratio
    // but allowing full-screen fill (cover mode)
    const fit = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const cw = parent.clientWidth;
      const ch = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);

      // Cover: scale so the arena fills the container edge-to-edge
      const scale    = Math.max(cw / ARENA_W, ch / ARENA_H);
      const drawW    = Math.round(ARENA_W * scale);
      const drawH    = Math.round(ARENA_H * scale);

      canvas.style.width  = `${drawW}px`;
      canvas.style.height = `${drawH}px`;
      canvas.style.position = 'absolute';
      canvas.style.left = `${Math.round((cw - drawW) / 2)}px`;
      canvas.style.top  = `${Math.round((ch - drawH) / 2)}px`;

      // Internal resolution
      canvas.width  = drawW * dpr;
      canvas.height = drawH * dpr;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    };

    fit();
    const ro = new ResizeObserver(fit);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', fit);

    // Create & start engine
    const audio  = audioRef.current ?? new AudioManager();
    const engine = new MultiplayerEngine(canvas, conn, audio);
    engineRef.current = engine;

    engine.initMatch(conn.playerList.map(p => ({
      id: p.id, name: p.name, skinId: p.skinId,
      faceDataUrl: p.faceDataUrl, isHost: p.isHost,
    })));

    // Wire messages from conn → engine
    const unsub = conn.onMessage((msg, fromSlot) => {
      if (!engineRef.current) return;
      switch (msg.t) {
        case 'input':
          if (fromSlot !== undefined) {
            engineRef.current.onRemoteInput(fromSlot, {
              moveX: msg.moveX, moveY: msg.moveY, facing: msg.facing,
              attack: msg.attack, special: msg.special,
            });
          }
          break;
        case 'state':
          engineRef.current.applyState(msg);
          break;
        case 'matchOver':
          engineRef.current.applyMatchOver(msg.winnerSlot);
          setMatchOver(true);
          setWinnerName(msg.winnerName);
          break;
      }
    });

    audio.startGameplay();
    engine.start();

    return () => {
      unsub();
      engine.stop();
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Touch controls ────────────────────────────────────────
  // Joystick
  const onJoyStart = (e: React.TouchEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    joyRef.current = { active: true, cx: r.left + r.width / 2, cy: r.top + r.height / 2, dx: 0, dy: 0 };
  };
  const onJoyMove = (e: React.TouchEvent) => {
    if (!joyRef.current.active) return;
    const t = e.touches[0];
    const dx = t.clientX - joyRef.current.cx;
    const dy = t.clientY - joyRef.current.cy;
    const maxR = 48;
    const len  = Math.hypot(dx, dy);
    const cl   = len > maxR ? maxR / len : 1;
    joyRef.current.dx = (dx * cl) / maxR;
    joyRef.current.dy = (dy * cl) / maxR;
    flush();
  };
  const onJoyEnd = () => {
    joyRef.current = { active: false, cx: 0, cy: 0, dx: 0, dy: 0 };
    flush();
  };

  // Attack / Special
  const onAtkStart  = () => { attackHeld.current  = true;  flush(); };
  const onAtkEnd    = () => { attackHeld.current  = false; flush(); };
  const onSpcStart  = () => { specialHeld.current = true;  flush(); };
  const onSpcEnd    = () => { specialHeld.current = false; flush(); };

  // ── Render ─────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-40 bg-black overflow-hidden"
      style={{ touchAction: 'none' }}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-30 flex justify-between items-center px-3 py-2 pointer-events-none">
        <button
          className="pointer-events-auto px-3 py-1.5 rounded-lg bg-black/70 text-white text-sm font-bold border border-white/20 hover:bg-gray-700 transition-colors"
          onClick={onExit}
        >
          ✕ Exit
        </button>
        <span className="text-white/70 text-xs font-bold bg-black/40 rounded px-2 py-1">
          💨 FART BATTLE  {isMobile ? '  WASD / Joy: Move • 💨 Blast • 💣 Bomb' : '  WASD: Move • Space: Blast • Shift: Bomb'}
        </span>
      </div>

      {/* Canvas container — fills entire screen */}
      <div className="absolute inset-0">
        <canvas
          ref={canvasRef}
          style={{ imageRendering: 'auto', touchAction: 'none' }}
        />
      </div>

      {/* Mobile touch controls — always shown on touch devices */}
      {isMobile && !matchOver && (
        <>
          {/* Virtual joystick — bottom left */}
          <div
            className="absolute bottom-6 left-5 w-32 h-32 rounded-full bg-white/10 border-2 border-white/30 z-40 flex items-center justify-center"
            style={{ touchAction: 'none' }}
            onTouchStart={onJoyStart}
            onTouchMove={onJoyMove}
            onTouchEnd={onJoyEnd}
            onTouchCancel={onJoyEnd}
          >
            <div className="w-14 h-14 rounded-full bg-white/25 border-2 border-white/40" />
          </div>

          {/* Attack — bottom right, larger for easy tap */}
          <button
            className="absolute bottom-6 right-28 w-28 h-28 rounded-full z-40 flex flex-col items-center justify-center text-4xl font-black border-4 border-green-400 active:scale-90 select-none"
            style={{ background: 'rgba(34,197,94,0.55)', touchAction: 'none' }}
            onTouchStart={onAtkStart}
            onTouchEnd={onAtkEnd}
            onTouchCancel={onAtkEnd}
          >
            💨
            <span className="text-white text-[10px] font-bold mt-0.5">BLAST</span>
          </button>

          {/* Special — bottom right */}
          <button
            className="absolute bottom-6 right-3 w-24 h-24 rounded-full z-40 flex flex-col items-center justify-center text-3xl font-black border-4 border-purple-400 active:scale-90 select-none"
            style={{ background: 'rgba(168,85,247,0.55)', touchAction: 'none' }}
            onTouchStart={onSpcStart}
            onTouchEnd={onSpcEnd}
            onTouchCancel={onSpcEnd}
          >
            💣
            <span className="text-white text-[10px] font-bold mt-0.5">BOMB</span>
          </button>
        </>
      )}

      {/* Desktop hint */}
      {!isMobile && !matchOver && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-white/45 text-xs bg-black/40 rounded px-3 py-1 z-30 pointer-events-none">
          WASD / Arrows: Move &nbsp;•&nbsp; Space: Fart Blast &nbsp;•&nbsp; Shift: Gas Bomb
        </div>
      )}

      {/* Match-over overlay */}
      {matchOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75">
          <div
            className="w-full max-w-xs mx-4 rounded-3xl overflow-hidden border-2 border-yellow-400"
            style={{ background: 'linear-gradient(180deg,#78350F,#1C1917)' }}
          >
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 py-4 text-center">
              <span className="text-2xl font-black text-black">🏆 MATCH OVER!</span>
            </div>
            <div className="p-6 text-center space-y-3">
              <div className="text-4xl">🎉</div>
              <div className="text-white text-2xl font-black">{winnerName}</div>
              <div className="text-green-400 font-bold">is the GAS MASTER!</div>
              <button
                onClick={onExit}
                className="w-full py-3 rounded-2xl font-black text-white mt-4"
                style={{ background: 'linear-gradient(135deg,#22C55E,#16A34A)', boxShadow: '0 4px 0 #14532D' }}
              >
                ← Back to Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
