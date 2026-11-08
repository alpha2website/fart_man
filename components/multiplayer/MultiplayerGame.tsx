'use client';

// ============================================================
// FART MAN — Multiplayer Arena Game
// Mobile: D-pad buttons (up/down/left/right + attack + bomb)
// Desktop: WASD/Arrows + Space/Shift
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { PeerConnection, NetMessage } from '@/lib/peerConnection';
import { MultiplayerEngine, InputState } from './MultiplayerEngine';
import { AudioManager } from '@/components/game/AudioManager';

const ARENA_W = 900;
const ARENA_H = 540;

interface Props {
  connRef:  React.MutableRefObject<PeerConnection | null>;
  audioRef: React.MutableRefObject<AudioManager | null>;
  onExit:   () => void;
}

export default function MultiplayerGame({ connRef, audioRef, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MultiplayerEngine | null>(null);
  const [matchOver,  setMatchOver]  = useState(false);
  const [winnerName, setWinnerName] = useState('');
  const [isMobile,   setIsMobile]   = useState(true);

  // ── D-pad / keyboard direction state ─────────────────────
  // Each direction is either held (true) or not (false).
  // We store this in a plain object ref — zero React state.
  const dir = useRef({ up: false, down: false, left: false, right: false });
  const atk = useRef(false);
  const spc = useRef(false);
  const lastSerial = useRef('');

  // Compute and send input from current dir state
  const send = useCallback(() => {
    const mx = (dir.current.right ? 1 : 0) - (dir.current.left ? 1 : 0);
    const my = (dir.current.down  ? 1 : 0) - (dir.current.up   ? 1 : 0);
    const len = Math.hypot(mx, my);
    const nx  = len > 0 ? mx / len : 0;
    const ny  = len > 0 ? my / len : 0;
    const facing = nx > 0 ? 1 : nx < 0 ? -1 : (engineRef.current?.getFacing() ?? 1);

    const inp: InputState = {
      moveX:   nx, moveY: ny,
      facing:  facing as 1 | -1,
      attack:  atk.current,
      special: spc.current,
    };

    // Deduplicate — only send when something changed
    const serial = `${nx.toFixed(2)},${ny.toFixed(2)},${facing},${atk.current},${spc.current}`;
    if (serial === lastSerial.current) return;
    lastSerial.current = serial;
    engineRef.current?.setLocalInput(inp);
  }, []);

  // ── Keyboard ─────────────────────────────────────────────
  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w','a','s','d',' ','shift','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) e.preventDefault();
      if (k === 'w' || k === 'arrowup')    dir.current.up    = true;
      if (k === 's' || k === 'arrowdown')  dir.current.down  = true;
      if (k === 'a' || k === 'arrowleft')  dir.current.left  = true;
      if (k === 'd' || k === 'arrowright') dir.current.right = true;
      if (k === ' ')     atk.current = true;
      if (k === 'shift') spc.current = true;
      send();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup')    dir.current.up    = false;
      if (k === 's' || k === 'arrowdown')  dir.current.down  = false;
      if (k === 'a' || k === 'arrowleft')  dir.current.left  = false;
      if (k === 'd' || k === 'arrowright') dir.current.right = false;
      if (k === ' ')     atk.current = false;
      if (k === 'shift') spc.current = false;
      send();
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup',   up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, [send]);

  // Periodic flush keeps held state streaming to host @20Hz
  useEffect(() => {
    const id = setInterval(send, 50);
    return () => clearInterval(id);
  }, [send]);

  // ── Detect mobile ─────────────────────────────────────────
  useEffect(() => {
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const hasMouse = window.matchMedia('(pointer: fine)').matches;
    setIsMobile(hasTouch || !hasMouse);
  }, []);

  // ── Canvas + engine setup ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const conn   = connRef.current;
    if (!canvas || !conn) return;

    const fit = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const cw = parent.clientWidth;
      const ch = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      const ar  = ARENA_W / ARENA_H;
      let drawW: number, drawH: number;
      if (cw / ch > ar) { drawH = ch; drawW = Math.round(ch * ar); }
      else               { drawW = cw; drawH = Math.round(cw / ar); }

      canvas.style.width  = `${drawW}px`;
      canvas.style.height = `${drawH}px`;
      canvas.style.position = 'absolute';
      canvas.style.left = `${Math.round((cw - drawW) / 2)}px`;
      canvas.style.top  = `${Math.round((ch - drawH) / 2)}px`;

      canvas.width  = drawW * dpr;
      canvas.height = drawH * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform((drawW / ARENA_W) * dpr, 0, 0, (drawW / ARENA_W) * dpr, 0, 0);
    };

    fit();
    const ro = new ResizeObserver(fit);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', fit);

    const audio  = audioRef.current ?? new AudioManager();
    const engine = new MultiplayerEngine(canvas, conn, audio);
    engineRef.current = engine;

    engine.initMatch(conn.playerList.map(p => ({
      id: p.id, name: p.name, skinId: p.skinId,
      faceDataUrl: p.faceDataUrl, isHost: p.isHost,
    })));

    const unsub = conn.onMessage((msg, fromSlot) => {
      if (!engineRef.current) return;
      switch (msg.t) {
        case 'input':
          if (fromSlot !== undefined) engineRef.current.onRemoteInput(fromSlot, msg as any);
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

    return () => { unsub(); engine.stop(); ro.disconnect(); window.removeEventListener('resize', fit); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── D-pad button helpers ──────────────────────────────────
  const press   = (d: keyof typeof dir.current) => () => { dir.current[d] = true;  send(); };
  const release = (d: keyof typeof dir.current) => () => { dir.current[d] = false; send(); };
  const atkDown  = () => { atk.current = true;  send(); };
  const atkUp    = () => { atk.current = false; send(); };
  const spcDown  = () => { spc.current = true;  send(); };
  const spcUp    = () => { spc.current = false; send(); };

  // Shared touch props for each D-pad button
  const tp = (d: keyof typeof dir.current) => ({
    onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); press(d)(); },
    onTouchEnd:   (e: React.TouchEvent) => { e.preventDefault(); release(d)(); },
    onTouchCancel:(e: React.TouchEvent) => { e.preventDefault(); release(d)(); },
    onMouseDown:   press(d),
    onMouseUp:     release(d),
    onMouseLeave:  release(d),
    style: { touchAction: 'none', userSelect: 'none' as const },
  });

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-40 bg-black overflow-hidden" style={{ touchAction: 'none' }}>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-30 flex justify-between items-center px-3 py-2 pointer-events-none">
        <button className="pointer-events-auto px-3 py-1.5 rounded-lg bg-black/70 text-white text-sm font-bold border border-white/20" onClick={onExit}>
          ✕ Exit
        </button>
        <span className="text-white/60 text-xs bg-black/40 rounded px-2 py-1">
          💨 FART BATTLE
        </span>
      </div>

      {/* Canvas */}
      <div className="absolute inset-0">
        <canvas ref={canvasRef} style={{ imageRendering: 'auto', touchAction: 'none' }} />
      </div>

      {/* ── Mobile D-pad + action buttons ── */}
      {isMobile && !matchOver && (
        <div
          className="absolute bottom-0 left-0 right-0 z-40 flex justify-between items-end px-4 pb-5"
          style={{ pointerEvents: 'none' }}
        >
          {/* LEFT: D-pad */}
          <div className="relative w-36 h-36" style={{ pointerEvents: 'auto' }}>
            {/* UP */}
            <button
              className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center text-white text-xl font-black active:bg-white/40"
              {...tp('up')}
            >▲</button>
            {/* DOWN */}
            <button
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-12 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center text-white text-xl font-black active:bg-white/40"
              {...tp('down')}
            >▼</button>
            {/* LEFT */}
            <button
              className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center text-white text-xl font-black active:bg-white/40"
              {...tp('left')}
            >◀</button>
            {/* RIGHT */}
            <button
              className="absolute right-0 top-1/2 -translate-y-1/2 w-12 h-12 rounded-xl bg-white/20 border border-white/40 flex items-center justify-center text-white text-xl font-black active:bg-white/40"
              {...tp('right')}
            >▶</button>
            {/* Centre dot */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-5 h-5 rounded-full bg-white/10 border border-white/20" />
            </div>
          </div>

          {/* RIGHT: Action buttons */}
          <div className="flex flex-col gap-3" style={{ pointerEvents: 'auto' }}>
            {/* BLAST */}
            <button
              className="w-20 h-20 rounded-2xl flex flex-col items-center justify-center text-3xl font-black border-2 border-green-400 active:scale-90"
              style={{ background: 'rgba(34,197,94,0.65)', touchAction: 'none', userSelect: 'none' }}
              onTouchStart={(e) => { e.preventDefault(); atkDown(); }}
              onTouchEnd={(e)   => { e.preventDefault(); atkUp(); }}
              onTouchCancel={(e)=> { e.preventDefault(); atkUp(); }}
              onMouseDown={atkDown} onMouseUp={atkUp} onMouseLeave={atkUp}
            >
              💨
              <span className="text-white text-[9px] font-bold mt-0.5">BLAST</span>
            </button>
            {/* BOMB */}
            <button
              className="w-20 h-20 rounded-2xl flex flex-col items-center justify-center text-3xl font-black border-2 border-purple-400 active:scale-90"
              style={{ background: 'rgba(168,85,247,0.65)', touchAction: 'none', userSelect: 'none' }}
              onTouchStart={(e) => { e.preventDefault(); spcDown(); }}
              onTouchEnd={(e)   => { e.preventDefault(); spcUp(); }}
              onTouchCancel={(e)=> { e.preventDefault(); spcUp(); }}
              onMouseDown={spcDown} onMouseUp={spcUp} onMouseLeave={spcUp}
            >
              💣
              <span className="text-white text-[9px] font-bold mt-0.5">BOMB</span>
            </button>
          </div>
        </div>
      )}

      {/* Desktop hint */}
      {!isMobile && !matchOver && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-white/40 text-xs bg-black/40 rounded px-3 py-1 z-30 pointer-events-none">
          WASD/Arrows: Move &nbsp;•&nbsp; Space: Blast &nbsp;•&nbsp; Shift: Bomb
        </div>
      )}

      {/* Match over */}
      {matchOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75">
          <div className="w-full max-w-xs mx-4 rounded-3xl overflow-hidden border-2 border-yellow-400" style={{ background: 'linear-gradient(180deg,#78350F,#1C1917)' }}>
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 py-4 text-center">
              <span className="text-2xl font-black text-black">🏆 MATCH OVER!</span>
            </div>
            <div className="p-6 text-center space-y-3">
              <div className="text-4xl">🎉</div>
              <div className="text-white text-2xl font-black">{winnerName}</div>
              <div className="text-green-400 font-bold">is the GAS MASTER!</div>
              <button onClick={onExit} className="w-full py-3 rounded-2xl font-black text-white mt-4" style={{ background: 'linear-gradient(135deg,#22C55E,#16A34A)' }}>
                ← Back to Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
