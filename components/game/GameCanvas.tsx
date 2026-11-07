'use client';

// ============================================================
// FART MAN — GameCanvas.tsx
// Owns the canvas element and GameEngine lifecycle.
// ============================================================

import { useEffect, useRef, useCallback } from 'react';
import { GameEngine, EngineState } from './GameEngine';
import { AudioManager } from './AudioManager';
import { SkinDef } from '@/lib/gameConfig';
import { GAME_CONFIG } from '@/lib/gameConfig';

interface GameCanvasProps {
  engineRef: React.MutableRefObject<GameEngine | null>;
  audioRef: React.MutableRefObject<AudioManager | null>;
  skinDef: SkinDef;
  faceImage: HTMLImageElement | null;
  onScoreChange: (score: number) => void;
  onBestChange: (best: number) => void;
  onGasMeterChange: (fill: number) => void;
  onBoostChange: (active: boolean, remaining: number) => void;
  onGameOver: (score: number) => void;
  onStateChange: (state: EngineState) => void;
}

export default function GameCanvas({
  engineRef,
  audioRef,
  skinDef,
  faceImage,
  onScoreChange,
  onBestChange,
  onGasMeterChange,
  onBoostChange,
  onGameOver,
  onStateChange,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Scale canvas to fill container while preserving aspect ratio
  const scaleCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const gameAR = GAME_CONFIG.CANVAS_WIDTH / GAME_CONFIG.CANVAS_HEIGHT;
    const containerAR = cw / ch;

    let displayW: number;
    let displayH: number;

    if (containerAR > gameAR) {
      displayH = ch;
      displayW = ch * gameAR;
    } else {
      displayW = cw;
      displayH = cw / gameAR;
    }

    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;
  }, []);

  // Initialize engine once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set internal resolution
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    canvas.width = GAME_CONFIG.CANVAS_WIDTH * dpr;
    canvas.height = GAME_CONFIG.CANVAS_HEIGHT * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // Build audio manager once
    if (!audioRef.current) {
      audioRef.current = new AudioManager();
    }

    const engine = new GameEngine(canvas, {
      onScoreChange,
      onBestChange,
      onGasMeterChange,
      onBoostChange,
      onGameOver,
      onStateChange,
    }, audioRef.current);

    engine.setSkin(skinDef);
    engine.setFaceImage(faceImage);
    engineRef.current = engine;

    scaleCanvas();

    const ro = new ResizeObserver(scaleCanvas);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', scaleCanvas);

    return () => {
      engine.destroy();
      engineRef.current = null;
      ro.disconnect();
      window.removeEventListener('resize', scaleCanvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync skin changes
  useEffect(() => {
    engineRef.current?.setSkin(skinDef);
  }, [skinDef, engineRef]);

  // Sync face image changes
  useEffect(() => {
    engineRef.current?.setFaceImage(faceImage);
  }, [faceImage, engineRef]);

  // Input handling — keyboard, mouse, touch
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        engineRef.current?.fart();
      }
    };

    const handleTouch = (e: TouchEvent) => {
      e.preventDefault();
      engineRef.current?.fart();
    };

    const handleClick = () => {
      engineRef.current?.fart();
    };

    const canvas = canvasRef.current;
    window.addEventListener('keydown', handleKey);
    canvas?.addEventListener('touchstart', handleTouch, { passive: false });
    canvas?.addEventListener('mousedown', handleClick);

    return () => {
      window.removeEventListener('keydown', handleKey);
      canvas?.removeEventListener('touchstart', handleTouch);
      canvas?.removeEventListener('mousedown', handleClick);
    };
  }, [engineRef]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center overflow-hidden"
      style={{ touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          imageRendering: 'pixelated',
          cursor: 'pointer',
          borderRadius: '12px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
        aria-label="Fart Man game canvas"
      />
    </div>
  );
}
