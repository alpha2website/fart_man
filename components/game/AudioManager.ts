// ============================================================
// FART MAN — Audio Manager
// Handles background tracks + Web Audio fart SFX
// ============================================================

type TrackName = 'menu' | 'gameplay' | 'gameover';

export class AudioManager {
  private tracks: Map<TrackName, HTMLAudioElement> = new Map();
  private currentTrack: TrackName | null = null;
  private muted = false;
  private volume = 0.7;
  private userInteracted = false;
  private pendingTrack: TrackName | null = null;

  // Web Audio for fart SFX
  private audioCtx: AudioContext | null = null;
  private fartVariant = 0;

  constructor() {
    if (typeof window === 'undefined') return;
    this.loadTracks();

    const onInteract = () => {
      this.userInteracted = true;
      // Resume AudioContext if suspended (browser autoplay policy)
      if (this.audioCtx?.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      if (this.pendingTrack) {
        this.play(this.pendingTrack);
        this.pendingTrack = null;
      }
      window.removeEventListener('click', onInteract);
      window.removeEventListener('touchstart', onInteract);
      window.removeEventListener('keydown', onInteract);
    };
    window.addEventListener('click', onInteract);
    window.addEventListener('touchstart', onInteract);
    window.addEventListener('keydown', onInteract);
  }

  // ---- Fart SFX (Web Audio API — no file needed) ----

  private getAudioCtx(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    try {
      this.audioCtx = new AudioContext();
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  /**
   * Synthesise a funny, clearly audible fart sound.
   * Uses a low rumble + buzzing reed + noise burst for a cartoon "BRAAAP".
   * Cycles through 5 variants each call.
   */
  playFartSFX(): void {
    if (this.muted) return;
    const ctx = this.getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }

    this.fartVariant = (this.fartVariant + 1) % 5;
    const v = this.fartVariant;
    const now = ctx.currentTime;

    // Duration: 0.4 – 0.7s
    const duration = 0.4 + v * 0.06;

    // ── 1. Low rumble oscillator (the "BR" in BRAAP) ──
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const rumbleFreq = 50 + v * 15;  // 50–110 Hz
    osc.frequency.setValueAtTime(rumbleFreq, now);
    osc.frequency.exponentialRampToValueAtTime(rumbleFreq * 0.35, now + duration);

    // Sub-oscillator for extra body
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(rumbleFreq * 1.5, now);
    osc2.frequency.exponentialRampToValueAtTime(rumbleFreq * 0.5, now + duration);

    // ── 2. Noise burst (the "AAP" sputter) ──
    const sampleRate = ctx.sampleRate;
    const bufSize = Math.floor(sampleRate * duration);
    const noiseBuf = ctx.createBuffer(1, bufSize, sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      // Pulsing noise — simulates the "pffpffpff" of escaping gas
      const pulse = Math.sin((i / sampleRate) * (40 + v * 8) * Math.PI * 2);
      noiseData[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * pulse);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    // Lowpass on noise to make it sound like a muffled fart
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(800 + v * 100, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(200, now + duration);
    noiseFilter.Q.value = 1.5;

    // ── 3. Amplitude envelope — quick attack, slow decay ──
    const gain = ctx.createGain();
    const peak = 0.85 * this.volume;   // LOUD — clearly audible over music
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.02);           // fast attack
    gain.gain.setValueAtTime(peak, now + duration * 0.4);           // hold
    gain.gain.linearRampToValueAtTime(peak * 0.6, now + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);  // decay

    // ── Connect everything ──
    osc.connect(gain);
    osc2.connect(gain);
    noise.connect(noiseFilter);
    noiseFilter.connect(gain);
    gain.connect(ctx.destination);

    // ── Start / stop ──
    osc.start(now);
    osc2.start(now);
    noise.start(now);
    osc.stop(now + duration);
    osc2.stop(now + duration);
    noise.stop(now + duration);
  }

  // ---- Background Music Tracks ----

  private loadTracks(): void {
    const sources: Record<TrackName, string> = {
      menu: '/audio/menu.mp3',
      gameplay: '/audio/gameplay.mp3',
      gameover: '/audio/gameover.mp3',
    };
    (Object.entries(sources) as [TrackName, string][]).forEach(([name, src]) => {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = this.volume;
      // Both menu and gameplay loop continuously
      if (name === 'menu' || name === 'gameplay') audio.loop = true;
      // Re-apply loop on ended event as a safety net (some browsers reset it)
      audio.addEventListener('ended', () => {
        if (audio.loop) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
        }
      });
      audio.addEventListener('error', (e) => {
        const err = (e.target as HTMLAudioElement).error;
        if (err && err.code !== MediaError.MEDIA_ERR_ABORTED) {
          console.warn(`[AudioManager] Could not load: ${src} (code: ${err.code})`);
        }
      });
      this.tracks.set(name, audio);
    });
  }

  private getTrack(name: TrackName): HTMLAudioElement | undefined {
    return this.tracks.get(name);
  }

  private stopAllTracks(except?: TrackName): void {
    this.tracks.forEach((audio, name) => {
      if (name !== except) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  }

  play(name: TrackName): void {
    // Always allow restarting gameplay even if it was the current track
    if (this.currentTrack === name && name === 'gameplay' && !this.getTrack('gameplay')?.paused) {
      return;
    }
    this.stopAllTracks(name);
    const audio = this.getTrack(name);
    if (!audio) return;
    audio.volume = this.muted ? 0 : this.volume;
    // Ensure loop is set for gameplay and menu tracks
    if (name === 'gameplay' || name === 'menu') {
      audio.loop = true;
    } else {
      audio.loop = false;
      audio.currentTime = 0;
    }
    this.currentTrack = name;
    if (!this.userInteracted) { this.pendingTrack = name; return; }
    audio.play().catch(() => { this.pendingTrack = name; });
  }

  pauseGameplay(): void {
    this.getTrack('gameplay')?.pause();
  }

  resumeGameplay(): void {
    if (this.muted) return;
    this.getTrack('gameplay')?.play().catch(() => {});
  }

  playGameOver(): void {
    const gameplay = this.getTrack('gameplay');
    if (gameplay) { gameplay.pause(); gameplay.currentTime = 0; }
    const gameover = this.getTrack('gameover');
    if (gameover) {
      gameover.loop = false;
      gameover.currentTime = 0;
      gameover.volume = this.muted ? 0 : this.volume;
      if (this.userInteracted) gameover.play().catch(() => {});
    }
    this.currentTrack = 'gameover';
  }

  playMenu(): void { this.play('menu'); }
  startGameplay(): void { this.play('gameplay'); }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.tracks.forEach((a) => { a.volume = this.muted ? 0 : this.volume; });
    return this.muted;
  }

  get isMuted(): boolean { return this.muted; }

  setMuted(val: boolean): void {
    this.muted = val;
    this.tracks.forEach((a) => { a.volume = this.muted ? 0 : this.volume; });
  }

  destroy(): void {
    this.tracks.forEach((a) => { a.pause(); a.src = ''; });
    this.tracks.clear();
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }
}
