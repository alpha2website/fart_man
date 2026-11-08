'use client';

// ============================================================
// FART MAN: THE ULTIMATE GAS ESCAPE — Main Page
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { GameEngine, EngineState } from '@/components/game/GameEngine';
import { AudioManager } from '@/components/game/AudioManager';
import { PeerConnection } from '@/lib/peerConnection';
import { PlayerCountTracker } from '@/lib/playerCount';
import { SKINS, SkinDef } from '@/lib/gameConfig';

const GameCanvas    = dynamic(() => import('@/components/game/GameCanvas'),    { ssr: false });
const MainMenu      = dynamic(() => import('@/components/ui/MainMenu'),        { ssr: false });
const GameHUD       = dynamic(() => import('@/components/ui/GameHUD'),         { ssr: false });
const PauseScreen   = dynamic(() => import('@/components/ui/PauseScreen'),     { ssr: false });
const GameOverScreen = dynamic(() => import('@/components/ui/GameOver'),       { ssr: false });
const FaceUploader  = dynamic(() => import('@/components/face/FaceUploader'),  { ssr: false });
const MultiplayerLobby = dynamic(() => import('@/components/multiplayer/MultiplayerLobby'), { ssr: false });
const MultiplayerGame  = dynamic(() => import('@/components/multiplayer/MultiplayerGame'),  { ssr: false });

type Screen = 'menu' | 'game' | 'gameover' | 'multiplayer-lobby' | 'multiplayer-game';

export default function FartManGame() {
  const engineRef     = useRef<GameEngine | null>(null);
  const audioRef      = useRef<AudioManager | null>(null);
  const trackerRef    = useRef<any>(null);
  const connRef       = useRef<PeerConnection | null>(null);

  const [screen,        setScreen]        = useState<Screen>('menu');
  const [gameState,     setGameState]     = useState<EngineState>('idle');
  const [score,         setScore]         = useState(0);
  const [bestScore,     setBestScore]     = useState(0);
  const [gasMeter,      setGasMeter]      = useState(0);
  const [boostActive,   setBoostActive]   = useState(false);
  const [boostRemaining,setBoostRemaining]= useState(0);
  const [isMuted,       setIsMuted]       = useState(false);
  const [selectedSkin,  setSelectedSkin]  = useState<SkinDef>(SKINS[0]);
  const [faceImage,     setFaceImage]     = useState<HTMLImageElement | null>(null);
  const [showFaceUploader, setShowFaceUploader] = useState(false);
  const [finalScore,    setFinalScore]    = useState(0);
  const [playerCount,   setPlayerCount]   = useState(1);

  // Helper: get face data URL for networking
  const getFaceDataUrl = useCallback(() => {
    if (faceImage?.src && faceImage.src.startsWith('data:')) return faceImage.src;
    return null;
  }, [faceImage]);

  // ---- Live player count ----
  useEffect(() => {
    const tracker = new PlayerCountTracker();
    trackerRef.current = tracker;
    const unsub = tracker.subscribe((n: number) => setPlayerCount(n));
    return () => { unsub(); tracker.destroy(); };
  }, []);

  // ---- Menu audio ----
  useEffect(() => {
    const t = setTimeout(() => audioRef.current?.playMenu(), 500);
    return () => clearTimeout(t);
  }, []);

  // ---- Handlers ----

  const handlePlay = useCallback(() => {
    setScreen('game');
    setScore(0);
    setGasMeter(0);
    setBoostActive(false);
    setTimeout(() => engineRef.current?.start(), 120);
  }, []);

  const handleMultiplayer = useCallback(() => {
    setScreen('multiplayer-lobby');
  }, []);

  const handleMatchStart = useCallback(() => {
    setScreen('multiplayer-game');
  }, []);

  const handleMultiplayerExit = useCallback(() => {
    connRef.current?.destroy();
    connRef.current = null;
    setScreen('menu');
    audioRef.current?.playMenu();
  }, []);

  const handleStateChange = useCallback((s: EngineState) => setGameState(s), []);
  const handleScoreChange = useCallback((s: number) => setScore(s), []);
  const handleBestChange  = useCallback((b: number) => setBestScore(b), []);
  const handleGasMeterChange = useCallback((g: number) => setGasMeter(g), []);
  const handleBoostChange = useCallback((active: boolean, remaining: number) => {
    setBoostActive(active);
    setBoostRemaining(remaining);
  }, []);

  const handleGameOver = useCallback((s: number) => {
    setFinalScore(s);
    setTimeout(() => setScreen('gameover'), 800);
  }, []);

  const handlePause   = useCallback(() => engineRef.current?.pause(),  []);
  const handleResume  = useCallback(() => engineRef.current?.resume(), []);

  const handleRestart = useCallback(() => {
    setScreen('game');
    setScore(0);
    setGasMeter(0);
    setBoostActive(false);
    engineRef.current?.restart();
  }, []);

  const handleMainMenu = useCallback(() => {
    engineRef.current?.stop();
    setScreen('menu');
    setGameState('idle');
    setScore(0);
    setGasMeter(0);
    setBoostActive(false);
    audioRef.current?.playMenu();
  }, []);

  const handleToggleMute = useCallback(() => {
    const newMuted = audioRef.current?.toggleMute() ?? false;
    setIsMuted(newMuted);
  }, []);

  const handleSkinChange = useCallback((skin: SkinDef) => {
    setSelectedSkin(skin);
    engineRef.current?.setSkin(skin);
  }, []);

  const handleFaceConfirmed = useCallback((img: HTMLImageElement) => {
    setFaceImage(img);
    engineRef.current?.setFaceImage(img);
    setShowFaceUploader(false);
  }, []);

  const handleRemoveFace = useCallback(() => {
    setFaceImage(null);
    engineRef.current?.setFaceImage(null);
    setShowFaceUploader(false);
  }, []);

  const handlePlayAgain = useCallback(() => {
    setScreen('game');
    setScore(0);
    setGasMeter(0);
    setBoostActive(false);
    setTimeout(() => engineRef.current?.restart(), 120);
  }, []);

  // Stable player name — generated once on client, never changes
  const playerNameRef = useRef('');
  if (!playerNameRef.current && typeof window !== 'undefined') {
    playerNameRef.current = `Player${Math.floor(Math.random() * 999) + 1}`;
  }
  const isPaused = gameState === 'paused';

  return (
    <main className="fixed inset-0 overflow-hidden" style={{ background: '#000', touchAction: 'none' }}>

      {/* Canvas layer — always mounted so engine persists */}
      <div className="absolute inset-0" style={{ display: screen === 'menu' ? 'none' : 'block' }}>
        <GameCanvas
          engineRef={engineRef}
          audioRef={audioRef}
          skinDef={selectedSkin}
          faceImage={faceImage}
          onScoreChange={handleScoreChange}
          onBestChange={handleBestChange}
          onGasMeterChange={handleGasMeterChange}
          onBoostChange={handleBoostChange}
          onGameOver={handleGameOver}
          onStateChange={handleStateChange}
        />

        {screen === 'game' && (
          <GameHUD
            score={score}
            bestScore={bestScore}
            gasMeter={gasMeter}
            boostActive={boostActive}
            boostRemaining={boostRemaining}
            isMuted={isMuted}
            playerCount={playerCount}
            onPause={handlePause}
            onToggleMute={handleToggleMute}
          />
        )}

        {screen === 'game' && isPaused && (
          <PauseScreen
            score={score}
            isMuted={isMuted}
            onResume={handleResume}
            onRestart={handleRestart}
            onMainMenu={handleMainMenu}
            onToggleMute={handleToggleMute}
          />
        )}

        {screen === 'gameover' && (
          <GameOverScreen
            score={finalScore}
            bestScore={bestScore}
            onPlayAgain={handlePlayAgain}
            onMainMenu={handleMainMenu}
            onCustomizeFace={() => {
              handleMainMenu();
              setTimeout(() => setShowFaceUploader(true), 300);
            }}
          />
        )}
      </div>

      {/* Main Menu */}
      {screen === 'menu' && (
        <div className="absolute inset-0">
          <MainMenu
            bestScore={bestScore}
            isMuted={isMuted}
            playerCount={playerCount}
            onPlay={handlePlay}
            onCustomizeFace={() => setShowFaceUploader(true)}
            onToggleMute={handleToggleMute}
            onMultiplayer={handleMultiplayer}
            selectedSkin={selectedSkin}
            onSkinChange={handleSkinChange}
          />
        </div>
      )}

      {/* Multiplayer Lobby */}
      {screen === 'multiplayer-lobby' && (
        <MultiplayerLobby
          connRef={connRef}
          skin={selectedSkin}
          faceDataUrl={getFaceDataUrl()}
          playerName={playerNameRef.current}
          onMatchStart={handleMatchStart}
          onBack={handleMultiplayerExit}
        />
      )}

      {/* Multiplayer Arena Game */}
      {screen === 'multiplayer-game' && (
        <MultiplayerGame
          connRef={connRef}
          audioRef={audioRef}
          onExit={handleMultiplayerExit}
        />
      )}

      {/* Face Uploader modal */}
      {showFaceUploader && (
        <FaceUploader
          currentFace={faceImage}
          onFaceConfirmed={handleFaceConfirmed}
          onRemoveFace={handleRemoveFace}
          onClose={() => setShowFaceUploader(false)}
        />
      )}
    </main>
  );
}
