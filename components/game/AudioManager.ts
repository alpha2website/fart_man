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
   * Synthesise a funny fart sound using noise + filter + envelope.
   * Cycles through 5 variants each call.
   */
  playFartSFX(): void {
    if (this.muted) return;
    const ctx = this.getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return; }

    this.fartVariant = (this.fartVariant + 1) % 5;
    const v = this.fartVariant;

    // Noise buffer (0.4 – 0.9 seconds)
    const duration = 0.35 + v * 0.08;
    const sampleRate = ctx.sampleRate;
    const bufferSize = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter centred on a low rumble frequency
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const baseFreq = 60 + v * 25;   // 60–160 Hz rumble
    filter.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(baseFreq * 0.4, ctx.currentTime + duration);
    filter.Q.value = 0.6 + v * 0.3;

    // Second high-pass for the "squeaky" top end
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = v % 2 === 0 ? 200 : 400;

    // Amplitude envelope
    const gain = ctx.createGain();
    const peakGain = (0.45 + v * 0.06) * this.volume;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(peakGain, ctx.currentTime + 0.04);
    gain.gain.setValueAtTime(peakGain, ctx.currentTime + duration * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    // Pitch modulation via playback rate
    source.playbackRate.setValueAtTime(0.9 + v * 0.15, ctx.currentTime);
    source.playbackRate.linearRampToValueAtTime(0.4 + v * 0.05, ctx.currentTime + duration);

    source.connect(filter);
    filter.connect(hpf);
    hpf.connect(gain);
    gain.connect(ctx.destination);

    source.start(ctx.currentTime);
    source.stop(ctx.currentTime + duration);
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
      if (name === 'gameplay') audio.loop = true;
      audio.addEventListener('error', (e) => {
        // Only warn on genuine network/404 errors, not autoplay-policy blocks
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
    if (this.currentTrack === name && name === 'gameplay') return;
    this.stopAllTracks(name);
    const audio = this.getTrack(name);
    if (!audio) return;
    audio.volume = this.muted ? 0 : this.volume;
    if (name === 'gameover') { audio.loop = false; audio.currentTime = 0; }
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
