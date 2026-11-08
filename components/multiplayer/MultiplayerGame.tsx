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
  // Default to showing controls — hide them for desktop after mount
  const [isMobile, setIsMobile] = useState(true);

  // Joystick knob visual — use a DOM ref to avoid React re-render on every touchmove
  const knobRef = useRef<HTMLDivElement>(null);

  // ── Input refs ────────────────────────────────────────────
  const keysRef     = useRef<Record<string, boolean>>({});
  const attackHeld  = useRef(false);
  const specialHeld = useRef(false);
  const joyRef      = useRef({ active: false, cx: 0, cy: 0, dx: 0, dy: 0 });
  const facingRef   = useRef<1 | -1>(1);
  const lastSerial  = useRef('');

  // Dead zone: ignore joystick movement smaller than this fraction of maxR
  const DEAD_ZONE = 0.18;

  const flush = useCallback(() => {
    let mx = 0, my = 0;
    const k = keysRef.current;
    if (k.a || k.arrowleft)  mx -= 1;
    if (k.d || k.arrowright) mx += 1;
    if (k.w || k.arrowup)    my -= 1;
    if (k.s || k.arrowdown)  my += 1;

    if (joyRef.current.active) {
      const rawX = joyRef.current.dx;
      const rawY = joyRef.current.dy;
      const mag  = Math.hypot(rawX, rawY);
      // Apply dead zone: if magnitude < threshold, treat as zero
      if (mag > DEAD_ZONE) {
        // Rescale so dead zone edge = 0, outer edge = 1 (smooth gradient)
        const scaled = (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
        mx = (rawX / mag) * scaled;
        my = (rawY / mag) * scaled;
      }
    }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    if (mx > 0.1) facingRef.current = 1;
    else if (mx < -0.1) facingRef.current = -1;

    const inp: InputState = {
      moveX:   Math.round(mx * 100) / 100,
      moveY:   Math.round(my * 100) / 100,
      facing:  facingRef.current,
      attack:  attackHeld.current,
      special: specialHeld.current,
    };

    // Skip send if nothing changed
    const serial = `${inp.moveX},${inp.moveY},${inp.facing},${inp.attack},${inp.special}`;
    if (serial === lastSerial.current) return;
    lastSerial.current = serial;
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

  // ── Polling loop — sends held state, 50ms on mobile / 33ms desktop ─────────────────
  useEffect(() => {
    const interval = isMobile ? 50 : 33;
    const id = setInterval(flush, interval);
    return () => clearInterval(id);
  }, [flush, isMobile]);

  // ── Detect mobile — default true, hide for desktop after mount ─────────────────
  useEffect(() => {
    // Only hide controls if user has a fine pointer (mouse) AND no touch
    const hasTouch  = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hasMouse  = window.matchMedia('(pointer: fine)').matches;
    setIsMobile(hasTouch || !hasMouse);
  }, []);

  // ── Canvas + engine setup ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const conn   = connRef.current;
    if (!canvas || !conn) return;

    // Size canvas to fill the container, preserving arena aspect ratio
    // Simple approach: fit canvas inside screen (letterbox), no clipping
    const fit = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const cw = parent.clientWidth;
      const ch = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);

      // Fit (not cover) — arena always fully visible
      const ar = ARENA_W / ARENA_H;
      let drawW: number, drawH: number;
      if (cw / ch > ar) {
        drawH = ch;
        drawW = Math.round(ch * ar);
      } else {
        drawW = cw;
        drawH = Math.round(cw / ar);
      }

      // Position canvas centred
      canvas.style.width    = `${drawW}px`;
      canvas.style.height   = `${drawH}px`;
      canvas.style.position = 'absolute';
      canvas.style.left     = `${Math.round((cw - drawW) / 2)}px`;
      canvas.style.top      = `${Math.round((ch - drawH) / 2)}px`;

      // Internal pixel buffer — reset clears transform so set it after
      canvas.width  = drawW * dpr;
      canvas.height = drawH * dpr;

      const ctx2 = canvas.getContext('2d')!;
      // Scale from ARENA coords to screen pixels
      const scale = (drawW / ARENA_W) * dpr;
      ctx2.setTransform(scale, 0, 0, scale, 0, 0);
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
  const MAX_R = 48; // joystick radius in px

  // Move knob directly via DOM — avoids React re-render on every touchmove
  const setKnobPos = (x: number, y: number) => {
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${x}px, ${y}px)`;
    }
  };

  const onJoyStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    joyRef.current = { active: true, cx: t.clientX, cy: t.clientY, dx: 0, dy: 0 };
    setKnobPos(0, 0);
  };
  const onJoyMove = (e: React.TouchEvent) => {
    if (!joyRef.current.active) return;
    const t = e.touches[0];
    const rawDx = t.clientX - joyRef.current.cx;
    const rawDy = t.clientY - joyRef.current.cy;
    const len   = Math.hypot(rawDx, rawDy);
    // Clamp knob to MAX_R
    const cl  = len > MAX_R ? MAX_R / len : 1;
    const kx  = rawDx * cl;
    const ky  = rawDy * cl;
    // Store normalised (-1..1)
    joyRef.current.dx = kx / MAX_R;
    joyRef.current.dy = ky / MAX_R;
    // Move knob visually (direct DOM — no React re-render)
    setKnobPos(kx, ky);
    flush();
  };
  const onJoyEnd = () => {
    joyRef.current = { active: false, cx: 0, cy: 0, dx: 0, dy: 0 };
    setKnobPos(0, 0);
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
          {/* Virtual joystick — bottom left with moving knob */}
          <div
            className="absolute bottom-6 left-5 w-32 h-32 rounded-full bg-white/10 border-2 border-white/30 z-40 flex items-center justify-center"
            style={{ touchAction: 'none' }}
            onTouchStart={onJoyStart}
            onTouchMove={onJoyMove}
            onTouchEnd={onJoyEnd}
            onTouchCancel={onJoyEnd}
          >
            {/* Knob — position updated via direct DOM ref, no React re-render */}
            <div
              ref={knobRef}
              className="w-14 h-14 rounded-full bg-white/50 border-2 border-white/80 shadow-lg"
              style={{ transition: 'transform 0.08s ease-out', willChange: 'transform' }}
            />
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
